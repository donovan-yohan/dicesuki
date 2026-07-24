import { useMemo, useRef } from 'react'
import type { InventoryDie } from '../../types/inventory'
import { resolveDiceRenderLod, type RenderDeviceTier } from '../../lib/renderLod'
import { getRarityColor } from '../../lib/rarityColor'
import { useTheme } from '../../contexts/ThemeContext'
import { SharedInventoryDicePreviewCanvas } from './SharedInventoryDicePreviewCanvas'

interface PullDicePreviewProps {
  dice: InventoryDie[]
  deviceTier: RenderDeviceTier
  mode: 'hero' | 'grid'
  labels?: Map<string, string>
  onSelect?: (die: InventoryDie) => void
}

/**
 * One pooled WebGL canvas serves the visible pull result cells. Low-tier
 * devices use catalog thumbnails (or a quiet text fallback) and never stand up
 * ten independent R3F roots.
 */
export function PullDicePreview({
  dice,
  deviceTier,
  mode,
  labels,
  onSelect,
}: PullDicePreviewProps) {
  const { currentTheme } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef<Map<string, HTMLElement>>(new Map())
  const lod = resolveDiceRenderLod({
    context: mode === 'hero' ? 'hero' : 'grid',
    deviceTier,
    isVisible: true,
    isFocused: mode === 'hero',
  })
  const staticFallback = deviceTier === 'low'
  const visibleDice = useMemo(
    () => mode === 'hero' ? dice.slice(0, 1) : dice.slice(0, 10),
    [dice, mode],
  )

  return (
    <div
      ref={hostRef}
      className={mode === 'hero'
        ? 'relative h-full min-h-[220px] w-full overflow-hidden'
        : 'relative grid w-full grid-cols-5 gap-2'}
      data-preview-mode={staticFallback ? 'static' : 'pooled-mesh'}
      data-preview-lod={lod.debugLabel}
    >
      {!staticFallback && (
        <SharedInventoryDicePreviewCanvas
          dice={visibleDice}
          hostRef={hostRef}
          slotRefs={slotRefs}
          lodPolicy={lod}
        />
      )}
      {visibleDice.map((die) => {
        const label = labels?.get(die.id)
        const cell = (
          <div
            ref={(node) => {
              if (node) slotRefs.current.set(die.id, node)
              else slotRefs.current.delete(die.id)
            }}
            className={mode === 'hero'
              ? 'relative h-full min-h-[220px] w-full'
              : 'relative aspect-square min-h-11 overflow-hidden rounded-md'}
            style={{
              border: mode === 'grid'
                ? `1px solid ${getRarityColor(die.rarity, currentTheme)}`
                : undefined,
            }}
          >
            {staticFallback && die.customAsset?.thumbnailUrl ? (
              <img
                src={die.customAsset.thumbnailUrl}
                alt=""
                className="h-full w-full object-contain"
              />
            ) : staticFallback ? (
              <span
                aria-hidden="true"
                className="flex h-full w-full items-center justify-center font-mono text-sm font-bold uppercase"
                style={{
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-text-muted)',
                }}
              >
                {die.type}
              </span>
            ) : null}
            {label && (
              <span
                className="absolute left-1 top-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase"
                style={{
                  color: 'var(--color-text-primary)',
                  backgroundColor: 'var(--color-background)',
                }}
              >
                {label}
              </span>
            )}
            {mode === 'grid' && (
              <span
                className="absolute bottom-0.5 right-0.5 max-w-[90%] truncate px-1 text-[8px] font-semibold uppercase"
                style={{ color: getRarityColor(die.rarity, currentTheme) }}
              >
                {die.rarity}
              </span>
            )}
          </div>
        )

        if (!onSelect) return <div key={die.id}>{cell}</div>
        return (
          <button
            key={die.id}
            type="button"
            className="min-h-11 min-w-11"
            aria-label={`Inspect ${die.name}, ${die.rarity}`}
            onClick={() => onSelect(die)}
          >
            {cell}
          </button>
        )
      })}
    </div>
  )
}
