import { memo } from 'react'
import { useTheme } from '../../contexts/ThemeContext'
import { CurrencyGlyph, type CurrencyKind } from './CurrencyGlyph'

export interface WalletBalanceSummaryProps {
  stars: number
  dust: number
  standardTickets: number
  premiumTickets?: number
  stale?: boolean
}

export const WalletBalanceSummary = memo(function WalletBalanceSummary({
  stars,
  dust,
  standardTickets,
  premiumTickets = 0,
  stale = false,
}: WalletBalanceSummaryProps) {
  const { currentTheme } = useTheme()
  const { colors, effects, spacing, typography } = currentTheme.tokens
  const balances: Balance[] = [
    { label: 'Stars', value: stars, kind: 'stars' },
    { label: 'Dust', value: dust, kind: 'dust' },
    {
      label: 'Standard rolls',
      compactLabel: 'Rolls',
      value: standardTickets,
      kind: 'roll',
    },
  ]

  if (premiumTickets > 0) {
    balances.push({ label: 'Premium rolls', value: premiumTickets, kind: 'roll' })
  }

  // Three balances fit in one compact row on a phone. When a premium balance is
  // present, a slightly wider minimum keeps the four balances in a legible 2×2
  // grid until there is room for all four across.
  const minimumCellWidth = premiumTickets > 0 ? '7.5rem' : '5rem'

  return (
    <section
      aria-label="Wallet balances"
      style={{
        width: '100%',
        padding: `calc(${spacing.unit} * 2)`,
        borderRadius: effects.borderRadius.lg,
        backgroundColor: colors.surface,
        border: `1px solid ${colors.text.muted}`,
        boxShadow: effects.shadows.sm,
      }}
    >
      <ul
        aria-label="Available balances"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(min(${minimumCellWidth}, 100%), 1fr))`,
          gap: `calc(${spacing.unit} * 2)`,
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {balances.map(balance => (
          <BalanceCell key={balance.label} {...balance} />
        ))}
      </ul>
      {stale && (
        <span
          role="status"
          aria-live="polite"
          style={{
            display: 'block',
            marginTop: `calc(${spacing.unit} * 1.5)`,
            color: colors.text.muted,
            fontSize: typography.fontSize.xs,
            fontWeight: typography.fontWeight.medium,
          }}
        >
          Balances may be stale
        </span>
      )}
    </section>
  )
})

interface Balance {
  label: string
  compactLabel?: string
  value: number
  kind: CurrencyKind
}

function BalanceCell({ label, compactLabel = label, value, kind }: Balance) {
  const { currentTheme } = useTheme()
  const { colors, effects, spacing, typography } = currentTheme.tokens
  const formattedValue = value.toLocaleString()

  return (
    <li
      data-testid={`wallet-${label.toLowerCase().replace(/\s+/g, '-')}`}
      aria-label={`${label}: ${formattedValue}`}
      style={{
        display: 'grid',
        gap: `calc(${spacing.unit} * 1)`,
        minWidth: 0,
        padding: `calc(${spacing.unit} * 1.5)`,
        borderRadius: effects.borderRadius.md,
        backgroundColor: colors.background,
        fontSize: typography.fontSize.xs,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: spacing.unit,
          minWidth: 0,
          color: colors.text.secondary,
          whiteSpace: 'nowrap',
        }}
      >
        <CurrencyGlyph kind={kind} size={14} />
        {compactLabel}
      </span>
      <strong
        style={{
          color: colors.text.primary,
          fontWeight: typography.fontWeight.bold,
          fontSize: typography.fontSize.sm,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formattedValue}
      </strong>
    </li>
  )
}
