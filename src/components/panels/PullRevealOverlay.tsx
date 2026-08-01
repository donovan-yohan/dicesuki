import { useEffect, useMemo, useRef, useState } from 'react'
import { shouldReduceMotion } from '../../animations/ui-transitions'
import { useHapticFeedback } from '../../hooks/useHapticFeedback'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import type { PullRevealAssembly, PullRevealSummary } from '../../types/pull'
import type { DiceShape } from '../../types/diceShape'
import type { RenderDeviceTier } from '../../lib/renderLod'
import { CurrencyText } from '../economy/CurrencyGlyph'
import { PullDicePreview } from './PullDicePreview'
import { ROOM_DICE_CAPACITY } from '../../config/roomCapacity'

interface PullRevealOverlayProps {
  assembly: PullRevealAssembly
  summary: PullRevealSummary
  deviceTier: RenderDeviceTier
  tableDiceCount: number
  onAddDie: (type: DiceShape, inventoryDieId: string) => string | null
  onDone: () => void
}

export function PullRevealOverlay({
  assembly,
  summary,
  deviceTier,
  tableDiceCount,
  onAddDie,
  onDone,
}: PullRevealOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(
    shouldReduceMotion() ? assembly.items.length : 1,
  )
  const [newOnly, setNewOnly] = useState(false)
  const [inspectedId, setInspectedId] = useState<string | null>(null)
  const [claimStatus, setClaimStatus] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const { vibrateOnCollision } = useHapticFeedback()
  const roomActionError = useMultiplayerStore(state => state.roomActionError)
  const clearRoomActionError = useMultiplayerStore(state => state.clearRoomActionError)
  const isSingle = assembly.items.length === 1
  const visibleItems = assembly.items.slice(0, visibleCount)
  const announcementText = isSingle
    ? resultAnnouncement(assembly.items[0])
    : `You received ${assembly.items.length} dice, ${summary.newCount} new.`

  useEffect(() => {
    setAnnouncement(announcementText)
  }, [announcementText])

  useEffect(() => {
    if (visibleCount >= assembly.items.length || shouldReduceMotion()) return
    const timer = window.setTimeout(
      () => setVisibleCount(current => Math.min(current + 1, assembly.items.length)),
      120,
    )
    return () => window.clearTimeout(timer)
  }, [assembly.items.length, visibleCount])

  useEffect(() => {
    const strongest = assembly.items.some(item => (
      item.result.isFirstCopy || item.result.tierRank >= 4
    ))
    vibrateOnCollision(strongest ? 'strong' : 'medium')
  }, [assembly.items, vibrateOnCollision])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const selector = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const first = dialog.querySelector<HTMLElement>(selector)
    first?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (inspectedId) setInspectedId(null)
        else onDone()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(selector))
      if (focusable.length === 0) return
      const start = focusable[0]
      const end = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === start) {
        event.preventDefault()
        end.focus()
      } else if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault()
        start.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [inspectedId, onDone])

  const labels = useMemo(() => new Map(assembly.items.flatMap(item => (
    item.inventoryDie
      ? [[
          item.inventoryDie.id,
          item.result.isFirstCopy
            ? 'NEW'
            : item.result.isDuplicate
              ? `+${item.result.duplicateDustAmount} Dust`
              : '',
        ] as const]
      : []
  ))), [assembly.items])

  const claim = (onlyNew: boolean) => {
    clearRoomActionError()
    const candidates = assembly.items.filter(item => !onlyNew || item.result.isFirstCopy)
    const available = Math.max(0, ROOM_DICE_CAPACITY - tableDiceCount)
    let requested = 0
    for (const item of candidates) {
      if (requested >= available) break
      if (
        item.inventoryDie &&
        item.inventoryDieId &&
        onAddDie(item.inventoryDie.type, item.inventoryDieId)
      ) requested += 1
    }
    const remainder = candidates.length - requested
    setClaimStatus(
      remainder > 0
        ? `Requested ${requested}; the room will confirm placement. ${remainder} ${remainder === 1 ? 'die remains' : 'dice remain'} safe in your inventory.`
        : `Requested ${requested} ${requested === 1 ? 'die' : 'dice'}; the room will confirm placement.`,
    )
  }

  const inspectedItem = inspectedId
    ? assembly.items.find(item => item.inventoryDie?.id === inspectedId) ?? null
    : null

  return (
    <div
      className="fixed inset-0 z-[70] overflow-y-auto p-3"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pull-reveal-title"
        className="mx-auto flex min-h-full w-full max-w-3xl flex-col"
      >
        <header className="flex items-center justify-between gap-3 py-3">
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-accent)' }}
            >
              Outcome revealed
            </p>
            <h2 id="pull-reveal-title" className="text-2xl font-bold">
              {isSingle ? 'Your new die' : 'Your 10-pull'}
            </h2>
          </div>
          <button type="button" className="min-h-11 px-3" onClick={onDone}>
            Done
          </button>
        </header>

        {visibleCount < assembly.items.length && (
          <button
            type="button"
            className="min-h-11 self-end px-3 text-sm"
            onClick={() => setVisibleCount(assembly.items.length)}
          >
            Skip reveal
          </button>
        )}

        {isSingle ? (
          <SingleReveal item={assembly.items[0]} deviceTier={deviceTier} />
        ) : (
          <section aria-label="Pull results" className="mt-3">
            <PullDicePreview
              dice={visibleItems.flatMap(item => (
                item.inventoryDie ? [item.inventoryDie] : []
              ))}
              deviceTier={deviceTier}
              mode="grid"
              labels={labels}
              onSelect={(die) => setInspectedId(die.id)}
            />
            {visibleItems.filter(item => !item.inventoryDie).map(item => (
              <ReceiptOnlyResult key={item.result.position} item={item} />
            ))}
            <p className="mt-5 font-semibold">
              {summary.highlights.map(entry => `${entry.count} ${entry.tierId}`).join(' · ')}
            </p>
            <p className="mt-2" style={{ color: 'var(--color-text-secondary)' }}>
              {summary.newCount} new · {summary.duplicateCount} duplicates
            </p>
            {summary.duplicateDustTotal > 0 && (
              <p className="mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                <CurrencyText kind="dust">
                  +{summary.duplicateDustTotal} Dust from duplicates
                </CurrencyText>
              </p>
            )}
          </section>
        )}

        <section className="mt-5 grid gap-3">
          {!isSingle && summary.duplicateCount > 0 && (
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={newOnly}
                onChange={(event) => setNewOnly(event.target.checked)}
              />
              Add new dice only
            </label>
          )}
          <button
            type="button"
            className="min-h-11 rounded-md px-4 font-bold"
            style={{
              backgroundColor: 'var(--color-accent)',
              color: 'var(--color-on-accent)',
            }}
            onClick={() => claim(isSingle ? false : newOnly)}
          >
            {isSingle ? 'Add to table' : newOnly ? 'Add new to table' : 'Add all to table'}
          </button>
          {claimStatus && (
            <p role="status" aria-live="polite" style={{ color: 'var(--color-text-secondary)' }}>
              {claimStatus}
            </p>
          )}
          {roomActionError && (
            <p role="alert" style={{ color: 'var(--color-error)' }}>
              Room rejected the request: {roomActionError.message}. The dice remain in your inventory.
            </p>
          )}
        </section>

        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
        {inspectedItem && (
          <ResultInspectDialog
            item={inspectedItem}
            deviceTier={deviceTier}
            onClose={() => setInspectedId(null)}
          />
        )}
      </div>
    </div>
  )
}

function ResultInspectDialog({
  item,
  deviceTier,
  onClose,
}: {
  item: PullRevealAssembly['items'][number]
  deviceTier: RenderDeviceTier
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
  }, [])
  if (!item.inventoryDie) return null
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="pull-result-inspect-title"
        className="w-full max-w-lg text-center"
      >
        <button
          ref={closeRef}
          type="button"
          className="min-h-11 px-3"
          onClick={onClose}
          aria-label="Close result inspection"
        >
          Close
        </button>
        <div className="mt-2 h-[min(45vh,360px)]">
          <PullDicePreview dice={[item.inventoryDie]} deviceTier={deviceTier} mode="hero" />
        </div>
        <h2 id="pull-result-inspect-title" className="mt-3 text-2xl font-bold">
          {item.inventoryDie.name}
        </h2>
        <p className="mt-1 capitalize" style={{ color: 'var(--color-text-secondary)' }}>
          {item.inventoryDie.rarity} · {item.inventoryDie.setId}
        </p>
        {item.copyLine && <p className="mt-2">{item.copyLine}</p>}
        {item.dustLine && <p className="mt-1">{item.dustLine}</p>}
      </section>
    </div>
  )
}

function SingleReveal({
  item,
  deviceTier,
}: {
  item: PullRevealAssembly['items'][number]
  deviceTier: RenderDeviceTier
}) {
  if (!item.inventoryDie) {
    return <ReceiptOnlyResult item={item} />
  }
  return (
    <section className="mt-2 text-center">
      {item.result.isFirstCopy && (
        <p className="text-lg font-black tracking-[0.3em]" style={{ color: 'var(--color-accent)' }}>
          NEW
        </p>
      )}
      <div className="mx-auto mt-2 h-[min(46vh,380px)] max-w-lg">
        <PullDicePreview dice={[item.inventoryDie]} deviceTier={deviceTier} mode="hero" />
      </div>
      <h3 className="mt-3 text-2xl font-bold">{item.inventoryDie.name}</h3>
      <p className="mt-1 capitalize" style={{ color: 'var(--color-text-secondary)' }}>
        {item.inventoryDie.rarity} · {item.inventoryDie.setId}
      </p>
      {item.copyLine && <p className="mt-2">{item.copyLine}</p>}
      {item.dustLine && (
        <p className="mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          <CurrencyText kind="dust">{item.dustLine}</CurrencyText>
        </p>
      )}
    </section>
  )
}

function ReceiptOnlyResult({
  item,
}: {
  item: PullRevealAssembly['items'][number]
}) {
  return (
    <article
      className="mt-3 border p-4 text-left"
      style={{ borderColor: 'var(--color-text-muted)' }}
      data-testid={`pull-receipt-only-result-${item.result.position}`}
    >
      <p className="font-semibold">Result {item.result.position}</p>
      <p className="mt-1 break-all text-sm">Catalog item {item.result.catalogItemId}</p>
      <p className="mt-1 text-sm">Server tier {item.result.tierId}</p>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Presentation metadata is temporarily unavailable. This receipt-only
        result has no local ownership identity and cannot be added to the table
        from this view.
      </p>
      {item.dustLine && <p className="mt-1">{item.dustLine}</p>}
    </article>
  )
}

function resultAnnouncement(item: PullRevealAssembly['items'][number]): string {
  return [
    item.inventoryDie
      ? `You won ${item.inventoryDie.name}`
      : `You received catalog item ${item.result.catalogItemId}`,
    item.inventoryDie?.rarity ?? `server tier ${item.result.tierId}`,
    item.result.isFirstCopy ? 'new' : 'duplicate',
    item.copyLine,
    item.dustLine,
  ].filter(Boolean).join(', ')
}
