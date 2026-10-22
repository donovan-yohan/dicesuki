import { useEffect, useMemo, useRef, useState } from 'react'
import { BottomSheet } from './BottomSheet'
import { SavedRollCard } from './saved-rolls/SavedRollCard'
import { RollBuilder } from './saved-rolls/RollBuilder'
import { CreatureFeatures, type FeatureUiState } from './CreatureFeatures'
import { buildCreatureKitV2, freshFeatureRoll, kitFingerprint, resolveFeatureVariant, validateStoredKit, type Selection } from '../../lib/monsterManual/features'
import { catalog } from '../../lib/monsterManual/catalog'
import { CreatureSourceFooter } from './CreatureSourceFooter'
import { creatureNotes, creatureText } from '../../lib/monsterManual/creatureCopy'
import { MonsterManualPanel } from './MonsterManualPanel'
import { useDiceBackend } from '../../contexts/DiceBackendContext'
import type { TableDieSummary } from '../../types/tableDice'
import type { SavedRoll } from '../../types/savedRolls'
import { useSavedRollsStore } from '../../store/useSavedRollsStore'
import { useRollLibraryStore, currentLibraryScope } from '../../store/useRollLibraryStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useDiceStore } from '../../store/useDiceStore'
import { createClientId } from '../../lib/clientId'
import { type KitCard } from '../../lib/rollLibrary'
import { systemLabels } from '../../lib/monsterManual/catalog'
import type { SavedRollScoring } from '../../lib/savedRollPlan'
import { executeAdmittedRoll, quickActionState } from '../../lib/monsterManual/execution'
import { formatSavedRoll } from '../../lib/diceHelpers'

const buttonBase = 'field-focus-ring min-h-11 min-w-11 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50'
// Keep color variants exclusive: utility stylesheet order, not class order, wins.
const button = `${buttonBase} bg-theme-bg text-theme-text`
const primary = `${buttonBase} bg-theme-accent text-theme-on-accent`
const field = 'field-focus-ring w-full min-w-0 min-h-11 rounded-lg bg-theme-bg px-3 py-2 text-theme-text'
export const recipeGrid = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3 min-w-0'
interface Props { isOpen: boolean; onClose: () => void; tableDice?: TableDieSummary[]; onOpenMonsterManual?: () => void }
export function SavedRollsPanel({ isOpen, onClose, tableDice=[] }: Props) {
  const token=useRollLibraryStore(s=>s.token)
  const [tab,setTab]=useState<'personal'|'creatures'>('personal')
  const session=useMemo(()=>({token,query:'',creatureQuery:'',tag:'',choices:{} as Record<string,string>,featureUi:{choices:{},queries:{},expanded:{}} as FeatureUiState,scroll:{personal:0,creatures:0}}),[token])
  return <BottomSheet isOpen={isOpen} onClose={onClose} title="My Dice Rolls" desktopClassName="lg:mx-auto lg:max-w-5xl" height="85dvh" handleOnlyDrag constrainToViewport returnFocus={()=>document.querySelector<HTMLButtonElement>('button[aria-label="My Dice Rolls"]')}>
    <LibraryView key={token ?? 'loading'} isOpen={isOpen} onClose={onClose} tableDice={tableDice} tab={tab} setTab={setTab} session={session} />
  </BottomSheet>
}
interface ViewProps extends Omit<Props,'onOpenMonsterManual'> { tab:'personal'|'creatures'; setTab:(tab:'personal'|'creatures')=>void; session:{token:string|null;query:string;creatureQuery:string;tag:string;choices:Record<string,string>;featureUi:FeatureUiState;scroll:{personal:number;creatures:number}} }
function LibraryView({isOpen,onClose,tableDice=[],tab,setTab,session}:ViewProps) {
  const lib=useRollLibraryStore()
  const personal=useSavedRollsStore()
  const token=lib.token
  const ready=!!token && lib.scope===currentLibraryScope()
  const [query,setQuery]=useState(session.query)
  const [creatureQuery,setCreatureQuery]=useState(session.creatureQuery)
  const [tag,setTag]=useState(session.tag)
  const [chooser,setChooser]=useState(false)
  const [builder,setBuilder]=useState(false)
  const [editing,setEditing]=useState<SavedRoll|null>(null)
  const [error,setError]=useState<string|null>(null)
  const [message,setMessage]=useState('')
  const [starting,setStarting]=useState(false)
  const [form,setForm]=useState<{kind:'group'|'instance'|'move';id?:string;name:string}|null>(null)
  const [variantChoices,setVariantChoices]=useState<Record<string,string>>(session.choices)
  const [featureUi,setFeatureUi]=useState(session.featureUi)
  const importLatch=useRef(false)
  const executeLatch=useRef(false)
  const root=useRef<HTMLDivElement>(null)
  const openRef=useRef(isOpen)
  openRef.current=isOpen
  const focusFrames=useRef(new Set<number>())
  const formInput=useRef<HTMLInputElement>(null)
  const backFocus=useRef<HTMLElement|null>(null)
  const scrollPositions=useRef(session.scroll)
  const backend=useDiceBackend()
  useMultiplayerStore(s=>s.dice); useMultiplayerStore(s=>s.connectionStatus); useMultiplayerStore(s=>s.localPlayerId)
  useMultiplayerStore(s=>s.pendingLocalRolls); useMultiplayerStore(s=>s.pendingInventoryDieIds);useMultiplayerStore(s=>s.pendingSpawnRollBarriers)
  useDiceStore(s=>s.savedRollExecution)
  const wavesPending=useDiceStore(s=>s.savedRollWavesPending)
  const state=quickActionState()
  const disabled=!ready||starting||state!=='ready'
  useEffect(()=>{session.query=query;session.creatureQuery=creatureQuery;session.tag=tag;session.choices=variantChoices;session.featureUi=featureUi},[session,query,creatureQuery,tag,variantChoices,featureUi])
  useEffect(()=>{const scroller=root.current?.closest('[data-sheet-content]');if(!scroller)return;const save=()=>{session.scroll[tab]=scroller.scrollTop};scroller.scrollTop=session.scroll[tab];scroller.addEventListener('scroll',save);return()=>scroller.removeEventListener('scroll',save)},[session,tab])
  useEffect(()=>{if(form)(formInput.current??root.current?.querySelector<HTMLSelectElement>('select[aria-label="Destination group"]'))?.focus()},[form])
  useEffect(()=>{if(chooser)document.getElementById('catalog-back')?.focus()},[chooser])
  function attempt(action:()=>void){setError(null);try{if(!ready||useRollLibraryStore.getState().token!==token||lib.scope!==currentLibraryScope())throw new Error('Library account changed. Try again.');action()}catch(e){setError(e instanceof Error?e.message:'Could not save library.')}}
  useEffect(()=>()=>{focusFrames.current.forEach(cancelAnimationFrame);focusFrames.current.clear()},[isOpen])
  function scheduleFocus(callback:()=>void){const frame=requestAnimationFrame(()=>{focusFrames.current.delete(frame);if(openRef.current&&root.current?.isConnected&&useRollLibraryStore.getState().token===token)callback()});focusFrames.current.add(frame)}
  function focus(id:string){scheduleFocus(()=>document.getElementById(id)?.focus())}
  function switchTab(next:'personal'|'creatures') {
    const scroller=root.current?.closest('[data-sheet-content]'); if(scroller)scrollPositions.current[tab]=scroller.scrollTop
    setTab(next);setForm(null);setError(null)
    requestAnimationFrame(()=>{if(scroller)scroller.scrollTop=scrollPositions.current[next]})
  }
  function openForm(value:NonNullable<typeof form>){backFocus.current=document.activeElement as HTMLElement;setForm(value)}
  function closeForm(){setForm(null);scheduleFocus(()=>backFocus.current?.focus())}
  async function execute(roll:SavedRoll,personalId?:string,scoring?:SavedRollScoring) {
    if(executeLatch.current||!ready||!token||useRollLibraryStore.getState().token!==token)return
    executeLatch.current=true;setStarting(true);setError(null)
    try {await executeAdmittedRoll(roll,backend,()=>{if(useRollLibraryStore.getState().token!==token||currentLibraryScope()!==lib.scope)return;if(personalId)personal.markRollAsUsed(personalId);onClose()},scoring)}
    catch(e){setError(e instanceof Error?e.message:'Could not start roll.')}
    finally{executeLatch.current=false;setStarting(false)}
  }
  function kitExecute(instanceId:string,card:KitCard,variantId:string){attempt(()=>{
    const live=useRollLibraryStore.getState();if(live.token!==token)throw new Error('Library account changed.')
    const instance=live.data.instances.find(i=>i.id===instanceId);if(!instance)throw new Error('Creature no longer saved')
    const checked=validateStoredKit(instance.kit);const variant=checked.cards.find(c=>c.id===card.id)?.variants.find(v=>v.id===variantId)
    if(!variant)throw new Error('Saved recipe is invalid')
    void execute({...variant.roll,id:createClientId('kit-roll'),createdAt:Date.now(),name:`${instance.displayName} · ${systemLabels[checked.provenance.system]} · ${card.label}`,dice:variant.roll.dice.map(d=>({...d,id:createClientId('kit-die')}))})
  })}
  function featureExecute(instanceId:string,featureId:string,rollId:string,selection:Selection){attempt(()=>{
    const instance=useRollLibraryStore.getState().data.instances.find(i=>i.id===instanceId)
    if(!instance)throw new Error('Creature no longer saved')
    const kit=validateStoredKit(instance.kit)
    const feature=kit.version===2?kit.features.find(f=>f.id===featureId):undefined
    const roll=feature?.rolls.find(r=>r.id===rollId)
    if(!roll)throw new Error('Creature feature no longer available')
    const next=freshFeatureRoll(resolveFeatureVariant(roll,selection).roll)
    next.name=`${instance.displayName} · ${systemLabels[kit.provenance.system]} · ${feature!.name} · ${roll.label}`
    void execute(next,undefined,{d10ZeroIsTen:true})
  })}
  function updateKit(instanceId:string){attempt(()=>{
    const instance=lib.data.instances.find(i=>i.id===instanceId)
    if(!instance)throw new Error('Creature no longer saved')
    const creature=catalog.find(c=>c.key===instance.kit.provenance.key)
    if(!creature)throw new Error('Creature source is unavailable for update')
    lib.updateInstanceKit(token!,instanceId,kitFingerprint(instance.kit),buildCreatureKitV2(creature))
    setVariantChoices(previous=>Object.fromEntries(Object.entries(previous).filter(([key])=>!key.startsWith(`${JSON.stringify(instanceId)}:`))))
    setFeatureUi(previous=>({choices:Object.fromEntries(Object.entries(previous.choices).filter(([key])=>!key.startsWith(`${JSON.stringify(instanceId)}:`))),expanded:Object.fromEntries(Object.entries(previous.expanded).filter(([key])=>!key.startsWith(`${JSON.stringify(instanceId)}:`))),queries:Object.fromEntries(Object.entries(previous.queries).filter(([key])=>!key.startsWith(`${JSON.stringify(instanceId)}:`)))}))
    setMessage('Spells & abilities updated');focus(`instance-${instanceId}`)
  })}
  function saveForm(){if(!form||!token)return;attempt(()=>{
    if(form.kind==='group') {if(form.id){lib.editGroup(token,form.id,{name:form.name});focus(`group-${form.id}`)}else {const id=lib.addGroup(token,form.name);focus(`group-${id}`)}}
    if(form.kind==='instance'){lib.editInstance(token,form.id!,{displayName:form.name});focus(`instance-${form.id}`)}
    if(form.kind==='move'){lib.moveRoll(token,form.id!,form.name||null);focus(`group-${form.name||'ungrouped'}`);setMessage('Roll moved')}
    setForm(null)
  })}
  const filtered=personal.savedRolls.filter(r=> (!query||`${r.name} ${r.description??''} ${(r.tags??[]).join(' ')}`.toLowerCase().includes(query.toLowerCase()))&&(!tag||r.tags?.includes(tag)))
  const searching=!!(query||tag)
  function personalSection(id:string,label:string,collapsed:boolean) {
    const rolls=filtered.filter(r=>(lib.data.memberships[r.id]??'ungrouped')===id).sort((a,b)=>Number(!!b.isFavorite)-Number(!!a.isFavorite))
    if(searching&&!rolls.length)return null
    return <section key={id} className="space-y-2" aria-label={`${label} group`}>
      <div className="flex items-start gap-1"><button id={`group-${id}`} className={`${button} flex-1 text-left break-words`} aria-expanded={searching||!collapsed} aria-controls={`group-content-${id}`} onClick={()=>attempt(()=>id==='ungrouped'?lib.collapseUngrouped(token!,!collapsed):lib.editGroup(token!,id,{collapsed:!collapsed}))}>{(searching||!collapsed)?'▾':'▸'} {label} · {rolls.length}</button>
        {id!=='ungrouped'&&<details><summary className={`${button} cursor-pointer`} aria-label={`Group options for ${label}`}>⋯</summary><div className="flex flex-col gap-1"><button className={button} onClick={()=>openForm({kind:'group',id,name:label})}>Rename group</button><button className={button} onClick={()=>{if(confirm('Remove this group? Its rolls will move to Ungrouped.'))attempt(()=>{lib.removeGroup(token!,id);focus('group-ungrouped')})}}>Remove group</button></div></details>}
      </div>
      {(searching||!collapsed)&&<div id={`group-content-${id}`}>
        {rolls.length?<div className={recipeGrid}>{rolls.map(roll=><SavedRollCard key={roll.id} roll={roll} onRoll={r=>void execute(r,r.id)} onEdit={r=>{setEditing(r);setBuilder(true)}} onDelete={r=>{if(confirm(`Delete "${r.name}"?`))attempt(()=>personal.deleteRoll(r.id))}} onToggleFavorite={r=>attempt(()=>personal.toggleFavorite(r.id))} onDuplicate={r=>attempt(()=>personal.duplicateRoll(r.id))} onMove={r=>openForm({kind:'move',id:r.id,name:lib.data.memberships[r.id]??''})} disabled={disabled}/>)}</div>:<p className="text-sm text-theme-text-muted">{id==='ungrouped'?'No ungrouped rolls.':'No rolls in this group'}</p>}
      </div>}
    </section>
  }
  return <div ref={root} className="space-y-4 min-w-0 text-theme-text" onKeyDown={e=>{
    if(e.key!=='Escape')return
    if(form){e.preventDefault();e.stopPropagation();closeForm();return}
    const details=(e.target as HTMLElement).closest('details[open]');if(details){e.preventDefault();e.stopPropagation();details.removeAttribute('open');details.querySelector('summary')?.focus();return}
    if(chooser){e.preventDefault();e.stopPropagation();setChooser(false);focus('add-creature')}
    else if(builder){e.preventDefault();e.stopPropagation();setBuilder(false)}
  }}>
    {!builder&&!chooser&&<div role="tablist" aria-label="Roll library" className="sticky top-0 z-10 grid grid-cols-2 gap-1 bg-theme-surface py-1">{(['personal','creatures'] as const).map((t,index)=><button key={t} id={`library-tab-${t}`} role="tab" aria-selected={tab===t} aria-controls={`library-panel-${t}`} tabIndex={tab===t?0:-1} className={tab===t?primary:button} onClick={()=>switchTab(t)} onKeyDown={e=>{const keys=['ArrowLeft','ArrowRight','Home','End'];if(keys.includes(e.key)){e.preventDefault();const next=e.key==='Home'?'personal':e.key==='End'?'creatures':index===0?'creatures':'personal';switchTab(next);focus(`library-tab-${next}`)}}}>{t==='personal'?'Personal rolls':'Monster Manual'}</button>)}</div>}
    {!ready?<p role="status">Loading library…</p>:<>
      {!builder&&<details className="text-xs text-theme-text-muted"><summary className="field-focus-ring min-h-11 py-3 cursor-pointer">Saved on this device</summary><p>Groups and creature roster are device-local, separate for guests and each account. Personal roll sync is unchanged. Sign-in does not copy guest groups or creatures.</p></details>}
      {(error||lib.notice)&&<p role="alert" className="rounded-lg bg-theme-bg p-3 text-sm">{error||lib.notice}</p>}
      {message&&<p role="status" className="text-sm">{message}</p>}
      {form&&<form className="p-3 rounded-lg border border-theme-border space-y-2" onSubmit={e=>{e.preventDefault();saveForm()}}>
        {form.kind==='move'?<label>Move roll to group<select aria-label="Destination group" className={field} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}><option value="">Ungrouped</option>{lib.data.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>:<label>{form.kind==='instance'?'Instance name':'Group name'}<input ref={formInput} className={field} maxLength={80} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>}
        <div className="flex gap-2"><button className={primary} type="submit">{form.kind==='move'?'Apply':'Save'}</button><button className={button} type="button" onClick={closeForm}>Cancel</button></div>
      </form>}
      {builder?<RollBuilder initialRoll={editing??undefined} tableDice={tableDice} onSave={value=>attempt(()=>{if(useRollLibraryStore.getState().token!==token)throw new Error('Library account changed.');if(editing)personal.updateRoll(editing.id,value);else personal.addRoll({...value,id:createClientId('roll'),createdAt:Date.now()});setBuilder(false);setEditing(null)})} onCancel={()=>{setBuilder(false);setEditing(null)}}/>:chooser?<>
        <button id="catalog-back" className={button} onClick={()=>{setChooser(false);focus('add-creature')}}>Back to roster</button>
        <MonsterManualPanel embedded isOpen={isOpen} onClose={()=>setChooser(false)} onAdd={c=>{
          if(importLatch.current)return;importLatch.current=true
          try{const kit=buildCreatureKitV2(c);const id=lib.addCreature(token!,kit);setChooser(false);setMessage(`${c.name} added · ${kit.cards.length} rolls`);focus(`instance-${id}`)}finally{queueMicrotask(()=>{importLatch.current=false})}
        }}/>
      </>:<div role="tabpanel" id={`library-panel-${tab}`} aria-labelledby={`library-tab-${tab}`} className="space-y-4">
        {tab==='personal'?<>
          <div className="flex flex-wrap gap-2"><label className="flex-1 min-w-[120px] text-sm">Search rolls<input className={field} type="search" placeholder="Search rolls..." value={query} maxLength={120} onChange={e=>setQuery(e.target.value)}/></label><button className={primary} onClick={()=>{setEditing(null);setBuilder(true)}}>New roll</button><button className={button} onClick={()=>openForm({kind:'group',name:''})}>New group</button></div>
          {!!personal.getAllTags().length&&<label className="block text-sm">Filter tag<select className={field} value={tag} onChange={e=>setTag(e.target.value)}><option value="">All tags</option>{personal.getAllTags().map(t=><option key={t}>{t}</option>)}</select></label>}
          {searching&&<p role="status">Search results · {filtered.length} rolls</p>}
          {lib.data.groups.map(g=>personalSection(g.id,g.name,g.collapsed))}
          {personalSection('ungrouped','Ungrouped',lib.data.ungroupedCollapsed)}
          {!personal.savedRolls.length&&<p>No saved rolls yet. Create your first custom roll.</p>}
        </>:<>
          <div className="flex flex-wrap gap-2"><label className="flex-1 min-w-[120px] text-sm">Find saved creatures<input className={field} type="search" value={creatureQuery} maxLength={120} onChange={e=>setCreatureQuery(e.target.value)}/></label><button id="add-creature" className={primary} onClick={()=>{importLatch.current=false;setChooser(true);setError(null)}}>Add creature</button></div>
          {!lib.data.instances.length&&<p>No creatures saved yet. Add a creature to save its rolls.</p>}
          {!!lib.data.instances.length&&!lib.data.instances.some(i=>`${i.displayName} ${i.kit.name} ${systemLabels[i.kit.provenance.system]}`.toLowerCase().includes(creatureQuery.toLowerCase()))&&<p>No saved creatures match.</p>}
          {lib.data.instances.filter(i=>`${i.displayName} ${i.kit.name} ${systemLabels[i.kit.provenance.system]}`.toLowerCase().includes(creatureQuery.toLowerCase())).map(instance=><section key={instance.id} className="space-y-3" aria-label={`${instance.displayName} saved creature`}>
            <div className="flex gap-1 items-start"><button id={`instance-${instance.id}`} className={`${button} flex-1 text-left break-words`} aria-expanded={!instance.collapsed} aria-controls={`instance-content-${instance.id}`} onClick={()=>attempt(()=>lib.editInstance(token!,instance.id,{collapsed:!instance.collapsed}))}><span className="block">{instance.collapsed?'▸':'▾'} {instance.displayName} · {instance.kit.cards.length} rolls</span><span className="block text-xs font-normal text-theme-text-secondary">{instance.kit.name} · {systemLabels[instance.kit.provenance.system]}</span></button>
              <details><summary className={`${button} cursor-pointer`} aria-label={`Creature options for ${instance.displayName}`}>⋯</summary><div className="flex flex-col gap-1"><button className={button} onClick={()=>updateKit(instance.id)}>Update spells &amp; abilities</button><button className={button} onClick={()=>openForm({kind:'instance',id:instance.id,name:instance.displayName})}>Rename instance</button><button className={button} onClick={()=>attempt(()=>{lib.editInstance(token!,instance.id,{collapsed:false});scheduleFocus(()=>{const details=document.getElementById(`source-${instance.id}`) as HTMLDetailsElement|null;if(details){details.open=true;details.querySelector('summary')?.focus()}})})}>View details</button><button className={button} onClick={()=>{if(confirm(`Remove "${instance.displayName}"? Removes this saved kit only.`))attempt(()=>{lib.removeInstance(token!,instance.id);focus('add-creature')})}}>Remove instance</button></div></details>
            </div>
            {!instance.collapsed&&<div id={`instance-content-${instance.id}`} className="space-y-3">
              {(['attack','damage','own-save'] as const).map(role=><div key={role} className="space-y-2"><h3 className="text-sm font-semibold">{role==='attack'?'Attacks':role==='damage'?'Damage':'Own saves'}</h3><div className={recipeGrid}>{instance.kit.cards.filter(c=>c.role===role).map(card=>{
                const key=`${JSON.stringify(instance.id)}:${card.id}`;const choice=variantChoices[key]??card.variants[0].id;const variant=card.variants.find(v=>v.id===choice)??card.variants[0]
                return <article key={card.id} className="min-w-0 rounded-xl border border-theme-border bg-theme-surface p-2 space-y-2 [overflow-wrap:anywhere]">
                  <button className="field-focus-ring min-h-[88px] w-full rounded-lg bg-theme-bg p-3 text-left active:translate-y-px motion-reduce:transform-none disabled:opacity-50 disabled:cursor-not-allowed" disabled={disabled} onClick={()=>kitExecute(instance.id,card,variant.id)} aria-label={`Roll ${instance.displayName} · ${systemLabels[instance.kit.provenance.system]} · ${card.label} · ${formatSavedRoll(variant.roll)}`}><span className="block text-xs text-theme-text-secondary">Roll</span><span className="block text-sm font-semibold">{card.label}</span><span className="block text-sm font-mono text-theme-accent">{formatSavedRoll(variant.roll)}</span></button>
                  {card.target&&<p className="text-xs text-theme-text-secondary">{creatureText(card.target)}</p>}
                  {card.variants.length>1&&<label className="block text-xs">{instance.kit.provenance.system==='pf2e'?'Attack this turn':'Roll mode'}<select className={`${field} text-sm px-1`} aria-label={`${instance.displayName} ${card.label} ${instance.kit.provenance.system==='pf2e'?'attack this turn':'roll mode'}`} value={variant.id} onChange={e=>setVariantChoices({...variantChoices,[key]:e.target.value})}>{card.variants.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>}
                </article>
              })}</div></div>)}
              {creatureNotes(instance.kit.constants).map(c=><p key={c} className="text-sm text-theme-text-secondary">{c}</p>)}
              <details id={`source-${instance.id}`} className="text-sm space-y-2 break-words"><summary className="field-focus-ring min-h-11 py-3 cursor-pointer">Abilities &amp; details</summary>
                {creatureNotes(instance.kit.notes).map((n,i)=><p key={i} className="whitespace-pre-line">{n}</p>)}
              </details>
              {instance.kit.version===2&&<CreatureFeatures state={featureUi} onStateChange={setFeatureUi} prefix={`${JSON.stringify(instance.id)}:`} features={instance.kit.features} sourceUrl={instance.kit.provenance.source.url} disabled={disabled} onRoll={(f,r,s)=>featureExecute(instance.id,f,r,s)}/>}
              <CreatureSourceFooter source={instance.kit.provenance.source}/>
            </div>}
          </section>)}
        </>}
        <p role="status" className="text-sm text-theme-text-secondary" data-testid={wavesPending?'saved-roll-waves-pending':undefined}>{starting?'Starting roll…':wavesPending?'Still rolling — waiting for the follow-up dice to land.':state==='rolling'?'Your dice are still rolling.':state==='disconnected'?'Room disconnected. Reconnect to roll.':''}</p>
      </div>}
    </>}
  </div>
}
