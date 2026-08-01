import { memo } from 'react'
import { DiceIcon, type DiceType } from './DiceIcon'

interface DiceIconWithNumberProps {
  type: DiceType
  number?: number
  className?: string
  size?: number
  /**
   * Colour the die artwork inherits, forwarded to `DiceIcon`.
   *
   * It has to be a prop, not a colour utility in `className`: `DiceIcon` sets
   * `color` on its svg root so it never falls back to browser-default black,
   * and that inline style beats any class we could hand it.
   */
  tone?: string
}

/**
 * Where the count sits inside the icon box.
 *
 * `d10tens` prints a `%` across the middle of its front face — measured
 * bounding box x 36..64, y 36.5..67.5 in viewBox units — and a centred count
 * covers x 27.7..72.2, y 27..73. The two stack into an unreadable smudge, and
 * `DiceEntryCard` renders exactly that pair for percentile entries.
 *
 * The `%` is what it is because the die has nowhere else to put it: the widest
 * strip of d10 clear of a two-digit count is ~11 viewBox units, which caps the
 * mark at ~2.6px on a 24px icon. So the count moves instead, into the
 * bottom-right corner the d10 silhouette leaves empty at every size. Every
 * other die has a clear centre and stays centred.
 */
const COUNT_PLACEMENT: Partial<Record<DiceType, string>> = {
  d10tens: 'items-end justify-end',
}

/** Placement for every die whose face carries no printed mark. */
const CENTRED_COUNT = 'items-center justify-center'

const DiceIconWithNumberImpl = ({
  type,
  number,
  className = '',
  size = 24,
  tone = 'var(--color-text-secondary)',
}: DiceIconWithNumberProps) => {
  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <DiceIcon type={type} size={size} tone={tone} />
      {number !== undefined && (
        <span
          className={`absolute inset-0 flex ${COUNT_PLACEMENT[type] ?? CENTRED_COUNT} font-bold text-theme-text pointer-events-none`}
          style={{
            fontSize: `${size * 0.4}px`,
            textShadow: '0 1px 2px rgba(0,0,0,0.3)'
          }}
        >
          {number}
        </span>
      )}
    </div>
  )
}

export const DiceIconWithNumber = memo(DiceIconWithNumberImpl)
