import type { ReactNode } from 'react'

export type CurrencyKind = 'roll' | 'stars' | 'dust'

interface CurrencyGlyphProps {
  kind: CurrencyKind
  label?: string
  size?: number
}

/**
 * Small current-color token marks for economy copy. These are intentionally
 * SVG/CSS glyphs rather than platform emoji so their weight and color stay
 * consistent with the active theme.
 */
export function CurrencyGlyph({
  kind,
  label,
  size = 16,
}: CurrencyGlyphProps) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-currency-kind={kind}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        color: 'currentColor',
      }}
    >
      {kind === 'roll' ? (
        <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
          <path
            d="M3.25 5.25h13.5v3a2 2 0 0 0 0 4v2.5H3.25v-2.5a2 2 0 0 0 0-4v-3Z"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path d="M10 6.6v6.8" stroke="currentColor" strokeWidth="1.3" strokeDasharray="1.4 1.4" />
        </svg>
      ) : kind === 'stars' ? (
        <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
          <path
            d="m10 2.5 2.15 4.55 4.85.62-3.55 3.5.9 4.83L10 13.62 5.65 16l.9-4.83L3 7.67l4.85-.62L10 2.5Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
          <path
            d="M10 2.75 15.6 7 10 17.25 4.4 7 10 2.75Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M4.8 7h10.4L10 10.4 4.8 7Z" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      )}
    </span>
  )
}

export function CurrencyText({
  kind,
  children,
}: {
  kind: CurrencyKind
  children: ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <CurrencyGlyph kind={kind} />
      <span>{children}</span>
    </span>
  )
}
