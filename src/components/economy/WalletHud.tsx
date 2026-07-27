import { memo } from 'react'
import { useTheme } from '../../contexts/ThemeContext'

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
  const { colors, spacing, typography } = currentTheme.tokens
  const padding = `calc(${spacing.unit} * 3)`

  return (
    <div
      aria-label="Wallet balances"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: `calc(${spacing.unit} * 2)`,
      }}
    >
      <BalanceChip label="Stars" value={stars} padding={padding} />
      <BalanceChip label="Dust" value={dust} padding={padding} />
      <BalanceChip label="Standard rolls" value={standardTickets} padding={padding} />
      {premiumTickets > 0 && (
        <BalanceChip label="Premium rolls" value={premiumTickets} padding={padding} />
      )}
      {stale && (
        <span
          role="status"
          style={{
            color: colors.text.muted,
            fontSize: typography.fontSize.xs,
            fontWeight: typography.fontWeight.medium,
          }}
        >
          Balances may be stale
        </span>
      )}
    </div>
  )
})

function BalanceChip({
  label,
  value,
  padding,
}: {
  label: string
  value: number
  padding: string
}) {
  const { currentTheme } = useTheme()
  const { colors, effects, typography } = currentTheme.tokens

  return (
    <span
      data-testid={`wallet-${label.toLowerCase().replace(/\s+/g, '-')}`}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: padding,
        padding,
        borderRadius: effects.borderRadius.full,
        backgroundColor: colors.surface,
        border: `1px solid ${colors.text.muted}`,
        color: colors.text.secondary,
        fontSize: typography.fontSize.xs,
      }}
    >
      <span>{label}</span>
      <strong
        style={{
          color: colors.text.primary,
          fontWeight: typography.fontWeight.bold,
        }}
      >
        {value.toLocaleString()}
      </strong>
    </span>
  )
}
