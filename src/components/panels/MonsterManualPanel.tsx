import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CreatureSourceFooter } from './CreatureSourceFooter'
import { creatureNotes, creatureText } from '../../lib/monsterManual/creatureCopy'
import { buildCreatureKitV2 } from '../../lib/monsterManual/features'
import { CreatureFeatures } from './CreatureFeatures'
import { BottomSheet } from './BottomSheet'
import { useDiceBackend } from '../../contexts/DiceBackendContext'
import { useDiceStore } from '../../store/useDiceStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { catalog, providerLabels, systemLabels } from '../../lib/monsterManual/catalog'
import { compileIntent, recipeLabel } from '../../lib/monsterManual/rollIntent'
import { executeMonsterIntent, quickActionState } from '../../lib/monsterManual/execution'
import { useMonsterManualSearch } from '../../hooks/useMonsterManualSearch'
import type { Creature, CreatureAction, Intent, ProviderId, SystemId } from '../../lib/monsterManual/types'

const field = 'field-focus-ring min-h-11 rounded-lg bg-theme-bg px-3 py-2 text-theme-text w-full'
const button = 'field-focus-ring min-h-11 rounded-lg px-3 py-2 text-sm font-semibold bg-theme-accent text-theme-on-accent disabled:opacity-50 disabled:cursor-not-allowed'
interface Props { isOpen: boolean; onClose: () => void; embedded?: boolean; onAdd?: (creature: Creature) => void }
interface Choices { mode?: string; ordinal?: number; damageChoice?: string }

export function MonsterManualPanel({ isOpen, onClose, embedded = false, onAdd }: Props) {
  const [query, setQuery] = useState('')
  const [system, setSystem] = useState<SystemId | 'all'>('all')
  const [kind, setKind] = useState<'all' | 'npc' | 'monster'>('all')
  const [selected, setSelected] = useState<Creature | null>(null)
  const previewKit=useMemo(()=>selected?buildCreatureKitV2(selected):null,[selected])
  const [detailVisible, setDetailVisible] = useState(false)
  const [choices, setChoices] = useState<Record<string, Choices>>({})
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [lastAction, setLastAction] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const listScrollRef = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const latch = useRef(false)
  const busyId = useId()
  const searchId = useId()
  const backend = useDiceBackend()
  // Subscribe to the state used by session admission; keep local-owner semantics.
  useMultiplayerStore(s => s.dice)
  useMultiplayerStore(s => s.pendingLocalRolls)
  useMultiplayerStore(s => s.pendingInventoryDieIds)
  useMultiplayerStore(s => s.pendingSpawnRollBarriers)
  useMultiplayerStore(s => s.connectionStatus)
  useMultiplayerStore(s => s.localPlayerId)
  useDiceStore(s => s.savedRollExecution)
  useDiceStore(s => s.savedRollWavesPending)
  const state = quickActionState()
  const disabled = starting || state !== 'ready'
  const { receipts, online, refresh } = useMonsterManualSearch(isOpen, `${query}|${system}|${kind}`)
  const providers = (Object.keys(providerLabels) as ProviderId[]).filter(p => system === 'all' || catalog.some(c => c.provider === p && c.system === system))
  const results = catalog.filter(c => (system === 'all' || c.system === system) && (kind === 'all' || c.kind === kind) && c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const loading = providers.some(p => receipts[p].status === 'refreshing')

  useEffect(() => {
    if (!detailVisible || !isOpen) return
    headingRef.current?.focus()
    headingRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, detailVisible, isOpen])

  function choice(key: string): Choices { return choices[key] ?? {} }
  function change(key: string, delta: Choices) { setChoices(previous => ({ ...previous, [key]: { ...previous[key], ...delta } })) }
  function select(c: Creature) {
    listScrollRef.current = listRef.current?.closest('[data-sheet-content]')?.scrollTop ?? 0
    setSelected(c)
    setDetailVisible(true)
    setError(null)
  }
  function back() {
    setDetailVisible(false)
    requestAnimationFrame(() => {
      const content = listRef.current?.closest('[data-sheet-content]')
      if (content) content.scrollTop = listScrollRef.current
      if (selected) rowRefs.current.get(selected.id)?.focus({ preventScroll: true })
    })
  }
  async function roll(c: Creature, intent: Intent) {
    if (latch.current || quickActionState() !== 'ready') return
    latch.current = true
    setStarting(true)
    setError(null)
    setLastAction(compileIntent(c, intent).name)
    try { await executeMonsterIntent(c, intent, backend, onClose) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not start roll. Try again.') }
    finally { latch.current = false; setStarting(false) }
  }
  function rollButton(c: Creature, intent: Intent, role: string) {
    const preview = compileIntent(c, intent)
    const entry = preview.dice[0]
    const count = entry.rollCount ?? entry.quantity
    const bonus = preview.flatBonus === 0 ? '' : ` ${preview.flatBonus > 0 ? '+' : '−'}${Math.abs(preview.flatBonus)}`
    const recipe = `${count}${entry.type}${entry.keepMode ? ` keep ${entry.keepMode}` : ''}${bonus}`
    return <button type="button" className={button} disabled={disabled} aria-describedby={busyId}
      aria-label={`${c.name} · ${systemLabels[c.system]} · ${intent.role === 'own-save' ? '' : `${c.actions.find(a => a.id === intent.actionId)?.name} · `}${role} · ${recipe}`}
      onClick={() => void roll(c, intent)}>{role} · <span className="font-mono tabular-nums">{recipe}</span></button>
  }
  function modeControl(c: Creature, key: string, label: string) {
    return <label className="block text-sm text-theme-text-secondary">{label}
      <select className={`${field} mt-1`} value={choice(key).mode ?? 'normal'} onChange={e => change(key, { mode: e.target.value })}>
        <option value="normal">Normal</option><option value="advantage">Advantage</option><option value="disadvantage">Disadvantage</option>
      </select><span className="sr-only">{c.name}</span></label>
  }
  function actionRow(c: Creature, a: CreatureAction) {
    const key = `${c.id}:${a.id}`
    const options = choice(key)
    const alternatives = a.damage.filter(d => d.choice)
    const selectedChoice = options.damageChoice ?? alternatives[0]?.id
    const damage = a.damage.filter(d => !d.choice || d.id === selectedChoice)
    return <section key={a.id} className="border-t border-theme-border pt-4 space-y-3" aria-label={a.name}>
      <h4 className="font-semibold text-theme-text">{a.name}</h4>
      {creatureText(a.note) && <p className="text-sm text-theme-text-secondary whitespace-pre-line break-words">{creatureText(a.note)}</p>}
      {a.target && <p className="text-sm font-medium text-theme-text">{creatureText(a.target)}</p>}
      {a.attackBonus !== undefined && (c.system === '5e' ? modeControl(c, key, `${a.name} attack mode`) :
        <label className="flex flex-wrap items-center gap-2 text-sm text-theme-text-secondary">Attack this turn
          <select aria-label={`${a.name} attack this turn`} className={`${field} !w-auto flex-1`} value={options.ordinal ?? 1} onChange={e => change(key, { ordinal: Number(e.target.value) })}>
            <option value={1}>1st · no MAP</option><option value={2}>2nd · {a.traits.includes('agile') ? '−4 agile' : '−5'} MAP</option><option value={3}>3rd+ · {a.traits.includes('agile') ? '−8 agile' : '−10'} MAP</option>
          </select>
        </label>)}
      {alternatives.length > 0 && <label className="block text-sm text-theme-text-secondary">{a.name} damage choice
        <select className={`${field} mt-1`} value={selectedChoice} onChange={e => change(key, { damageChoice: e.target.value })}>
          {alternatives.map(d => <option key={d.id} value={d.id}>{d.choice} · {recipeLabel(d.recipe)}</option>)}
        </select>
      </label>}
      <div className="flex flex-wrap gap-2">
        {a.attackBonus !== undefined && rollButton(c, { role: 'attack', actionId: a.id, ...(c.system === '5e' ? { mode: options.mode ?? 'normal' } : { ordinal: options.ordinal ?? 1 }) }, 'Roll attack')}
        {damage.map(d => <div key={d.id} className="min-w-0">
          {d.recipe.count === 0 ? <p className="text-sm text-theme-text-secondary py-3">{d.timing}: {d.recipe.bonus} {d.type}</p>
            : rollButton(c, { role: 'damage', actionId: a.id, componentId: d.id }, `Roll ${d.timing === 'immediate' ? '' : `${d.timing} `}${d.type}`)}
        </div>)}
      </div>
    </section>
  }

  const content = (
    <div className="text-theme-text min-w-0 space-y-4" data-testid="monster-manual">
      <div className={detailVisible ? 'hidden lg:block space-y-4' : 'space-y-4'}>
        <div><label htmlFor={searchId} className="block text-sm font-semibold">Search creatures</label>
          <div className="flex gap-2 mt-1"><input id={searchId} className={field} type="search" placeholder="Name, e.g. Guard" value={query} onChange={e => setQuery(e.target.value)} maxLength={120} />
            {query && <button className={`${button} bg-theme-bg text-theme-text`} onClick={() => setQuery('')}>Clear search</button>}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">System<select className={`${field} mt-1`} value={system} onChange={e => setSystem(e.target.value as SystemId | 'all')}>
            <option value="all">All systems</option>{Object.entries(systemLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          <label className="text-sm">Kind<select className={`${field} mt-1`} value={kind} onChange={e => setKind(e.target.value as typeof kind)}>
            <option value="all">All kinds</option><option value="npc">NPC</option><option value="monster">Monster</option>
          </select></label>
        </div>
        <div className="space-y-2 text-xs text-theme-text-secondary" aria-label="Source status">
          {providers.map(p => {
            const receipt = receipts[p]
            const status = !online ? 'Offline' : ({ imported: 'Imported catalog', refreshing: 'Checking online source…', online: 'Online source verified', offline: 'Offline', unavailable: 'Source unavailable', changed: 'Source changed / could not validate' }[receipt.status])
            return <div key={p} className="flex flex-wrap items-center justify-between gap-2" data-provider={p} data-source-status={!online ? 'offline' : receipt.status}>
              <span className="min-w-0">{providerLabels[p]} · {status}</span>
              <button className={`${button} bg-theme-bg text-theme-text`} disabled={receipt.status === 'refreshing'} onClick={() => void refresh(p)}>{['unavailable','changed','offline'].includes(receipt.status) ? 'Retry' : 'Refresh'}<span className="sr-only"> {providerLabels[p]}</span></button>
            </div>
          })}
        </div>
        <p role="status" className="text-sm text-theme-text-secondary">{loading ? 'Checking sources…' : `${results.length} ${results.length === 1 ? 'creature' : 'creatures'}`}</p>
      </div>
      <div className="grid lg:grid-cols-[19rem_minmax(0,1fr)] gap-6 min-w-0">
        <div ref={listRef} className={detailVisible ? 'hidden lg:block min-w-0' : 'min-w-0'}>
          {results.length === 0 ? <div className="space-y-3"><p>No creatures match “{query}”.</p><button className={button} onClick={() => { setQuery(''); setSystem('all'); setKind('all') }}>Reset filters</button></div>
            : <ul className="space-y-1">{results.map(c => <li key={c.id}><button type="button" ref={node => { if (node) rowRefs.current.set(c.id, node); else rowRefs.current.delete(c.id) }}
              className={`field-focus-ring w-full min-h-14 text-left rounded-lg p-3 ${selected?.id === c.id ? 'bg-theme-bg' : 'hover:bg-theme-bg'}`}
              aria-label={`${c.name} · ${c.kind === 'npc' ? 'NPC' : 'Monster'} · ${systemLabels[c.system]} · ${providerLabels[c.provider]}`}
              aria-current={selected?.id === c.id ? 'true' : undefined} onClick={() => select(c)}>
              <span className="block font-semibold">{c.name}{selected?.id === c.id && <span className="text-xs ml-2 text-theme-text-secondary">Selected</span>}</span>
              <span className="block text-sm text-theme-text-secondary">{c.kind === 'npc' ? 'NPC' : 'Monster'} · {systemLabels[c.system]}</span>
              <span className="block text-xs text-theme-text-muted">{providerLabels[c.provider]}</span>
            </button></li>)}</ul>}
        </div>
        <div className={`${detailVisible ? '' : 'hidden lg:block'} min-w-0 space-y-4`}>
          {!selected ? <p className="text-theme-text-secondary">Select a creature to view its actions.</p> : <>
            <button type="button" className={`${button} lg:hidden bg-theme-bg text-theme-text`} onClick={back}>Back to results</button>
            <div className="space-y-2">
              <h3 ref={headingRef} tabIndex={-1} className="text-xl font-bold field-focus-ring rounded">{selected.name}</h3>
              <p className="text-sm text-theme-text-secondary">{selected.kind === 'npc' ? 'NPC' : 'Monster'} · {systemLabels[selected.system]}</p>
            </div>
            {!onAdd && <>
            <p id={busyId} role="status" className="text-sm text-theme-text-secondary">{starting ? 'Starting roll…' : state === 'rolling' ? 'Your dice are still rolling.' : state === 'disconnected' ? 'Room not connected. Reconnect to roll.' : 'Ready to roll.'}</p>
            {error && <p role="alert" className="text-sm font-semibold text-theme-text bg-theme-bg rounded-lg p-3">{error}</p>}
            {lastAction && <p className="text-xs text-theme-text-muted break-words">Last action: {lastAction}</p>}
            <h3 className="font-semibold">Actions</h3>
            {selected.actions.map(a => actionRow(selected, a))}
            <section className="border-t border-theme-border pt-4 space-y-3" aria-label="Own saving throws">
              <h3 className="font-semibold">Own saving throws</h3>
              {selected.system === '5e' && modeControl(selected, `${selected.id}:saves`, 'Own save mode')}
              <div className="flex flex-wrap gap-2">{selected.saves.map(s => <div key={s.id}>{rollButton(selected, { role: 'own-save', saveId: s.id, ...(selected.system === '5e' ? { mode: choice(`${selected.id}:saves`).mode ?? 'normal' } : {}) }, `Roll ${s.name} save`)}</div>)}</div>
            </section>
            </>}
            {onAdd && <div className="space-y-3"><p>{previewKit!.cards.length} rolls · attacks, damage and own saves</p><button className={button} disabled={starting} onClick={() => { if (latch.current) return; latch.current = true; setStarting(true); try { onAdd(selected) } catch (e) { setError(e instanceof Error ? e.message : 'Could not add kit'); latch.current = false; setStarting(false) } }}>Add creature kit</button>{error && <p role="alert">{error}</p>}<ul className="text-sm space-y-1">{previewKit!.cards.map(card => <li key={card.id}>{card.label}</li>)}</ul></div>}
            <section className="space-y-2 text-sm text-theme-text-secondary" aria-label="Creature details">{creatureNotes(onAdd ? previewKit!.notes : selected.notes).map((n,i) => <p key={i} className="whitespace-pre-line">{n}</p>)}</section>
            {previewKit&&<CreatureFeatures features={previewKit.features} sourceUrl={selected.source.url}/>}
            <CreatureSourceFooter source={selected.source}/>
          </>}
        </div>
      </div>
    </div>
  )
  return embedded ? content : <BottomSheet isOpen={isOpen} onClose={onClose} title="Monster Manual" height="80dvh" desktopClassName="lg:mx-auto lg:max-w-5xl" handleOnlyDrag constrainToViewport returnFocus={() => document.querySelector<HTMLButtonElement>('button[aria-label="My Dice Rolls"]')}>{content}</BottomSheet>
}
