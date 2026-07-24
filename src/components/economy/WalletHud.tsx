import { memo, useEffect, useState } from 'react'
import { useTheme } from '../../contexts/ThemeContext'
import { useAuthStore } from '../../store/useAuthStore'
import { useWalletStore } from '../../store/useWalletStore'
import { WALLET_HUD_LAYOUT_CONTRACT } from './walletHudLayout'

export interface WalletBalanceSummaryProps {
  stars: number
  dust: number
  standardTickets: number
  premiumTickets?: number
  stale?: boolean
  compact?: boolean
}

export const WalletBalanceSummary = memo(function WalletBalanceSummary({
  stars,
  dust,
  standardTickets,
  premiumTickets = 0,
  stale = false,
  compact = false,
}: WalletBalanceSummaryProps) {
  const { currentTheme } = useTheme()
  const { colors, spacing, typography } = currentTheme.tokens
  const padding = compact
    ? `calc(${spacing.unit} * 2)`
    : `calc(${spacing.unit} * 3)`

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

export interface WalletHudProps {
  isVisible?: boolean
}

export const WalletHud = memo(function WalletHud({
  isVisible = true,
}: WalletHudProps) {
  const status = useAuthStore(state => state.status)
  const userId = useWalletStore(state => state.userId)
  const loading = useWalletStore(state => state.loading)
  const promotionalStars = useWalletStore(state => state.wallet.stars.promotional)
  const paidStars = useWalletStore(state => state.wallet.stars.paid ?? 0)
  const dust = useWalletStore(state => state.wallet.dust.earned)
  const standardTickets = useWalletStore(state => state.tickets.standard_roll)
  const premiumTickets = useWalletStore(state => state.tickets.premium_roll)
  const stale = useWalletStore(state => state.stale)
  const { currentTheme } = useTheme()
  const { colors, effects, spacing } = currentTheme.tokens
  const hudLayout = WALLET_HUD_LAYOUT_CONTRACT
  const [loadObservation, setLoadObservation] = useState(() => ({
    userId,
    hasObservedFreshBalances: Boolean(userId && !loading && !stale),
  }))

  useEffect(() => {
    setLoadObservation(current => {
      const observedFreshNow = Boolean(userId && !loading && !stale)
      if (current.userId !== userId) {
        return {
          userId,
          hasObservedFreshBalances: observedFreshNow,
        }
      }
      if (observedFreshNow && !current.hasObservedFreshBalances) {
        return {
          userId,
          hasObservedFreshBalances: true,
        }
      }
      return current
    })
  }, [loading, stale, userId])

  const hasLoadedForCurrentUser =
    loadObservation.userId === userId &&
    loadObservation.hasObservedFreshBalances

  if (
    !isVisible ||
    status !== 'authenticated' ||
    !userId ||
    !hasLoadedForCurrentUser
  ) {
    return null
  }

  return (
    <aside
      aria-label="Wallet"
      data-layout-slot="bottom-right-hud"
      style={{
        position: 'fixed',
        right: `calc(${spacing.unit} * ${hudLayout.rightInsetUnits})`,
        bottom: `calc(${spacing.unit} * ${hudLayout.bottomClearanceUnits})`,
        zIndex: hudLayout.zIndex,
        width: `calc(${spacing.unit} * ${hudLayout.widthUnits})`,
        maxWidth: `calc(50% - calc(${spacing.unit} * ${hudLayout.centerClearanceUnits}))`,
        maxHeight: `calc(60vh - calc(${spacing.unit} * ${
          hudLayout.bottomClearanceUnits +
          hudLayout.resultTopUnits +
          hudLayout.resultGapUnits
        }))`,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        padding: `calc(${spacing.unit} * 2)`,
        borderRadius: effects.borderRadius.full,
        backgroundColor: colors.background,
        border: `1px solid ${colors.text.muted}`,
        boxShadow: effects.shadows.md,
      }}
    >
      <WalletBalanceSummary
        stars={promotionalStars + paidStars}
        dust={dust}
        standardTickets={standardTickets}
        premiumTickets={premiumTickets}
        stale={stale}
        compact
      />
    </aside>
  )
})

export default WalletHud
