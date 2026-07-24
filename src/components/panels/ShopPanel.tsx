import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from '../../contexts/ThemeContext'
import { isPaymentsEnabled } from '../../lib/paymentsConfig'
import { useAuthStore } from '../../store/useAuthStore'
import { useWalletStore } from '../../store/useWalletStore'
import {
  MAX_STANDARD_ROLL_CONVERSION_COUNT,
  STAR_BUNDLE_PREVIEWS,
  STARS_PER_STANDARD_ROLL,
} from '../economy/shopCatalog'
import { WalletBalanceSummary } from '../economy/WalletHud'
import { BottomSheet } from './BottomSheet'

interface ShopPanelProps {
  isOpen: boolean
  onClose: () => void
}

type ConversionNotice =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }
  | null

export const ShopPanel = memo(function ShopPanel({
  isOpen,
  onClose,
}: ShopPanelProps) {
  const authStatus = useAuthStore(state => state.status)
  const walletUserId = useWalletStore(state => state.userId)
  const promotionalStars = useWalletStore(state => state.wallet.stars.promotional)
  const paidStars = useWalletStore(state => state.wallet.stars.paid ?? 0)
  const dust = useWalletStore(state => state.wallet.dust.earned)
  const standardTickets = useWalletStore(state => state.tickets.standard_roll)
  const premiumTickets = useWalletStore(state => state.tickets.premium_roll)
  const stale = useWalletStore(state => state.stale)
  const convertStars = useWalletStore(state => state.convertStarsToStandardRoll)
  const [quantity, setQuantity] = useState(1)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<ConversionNotice>(null)
  const pendingRef = useRef(false)
  const { currentTheme } = useTheme()
  const { colors, effects, spacing, typography } = currentTheme.tokens
  const affordable = Math.floor(promotionalStars / STARS_PER_STANDARD_ROLL)
  const maximumConvertible = Math.min(
    affordable,
    MAX_STANDARD_ROLL_CONVERSION_COUNT,
  )
  const quantityCeiling = Math.max(1, maximumConvertible)
  const paymentsEnabled = isPaymentsEnabled()

  useEffect(() => {
    setQuantity(current => Math.min(Math.max(current, 1), quantityCeiling))
  }, [quantityCeiling])

  const changeQuantity = useCallback((delta: number) => {
    setNotice(null)
    setQuantity(current => Math.min(Math.max(current + delta, 1), quantityCeiling))
  }, [quantityCeiling])

  const handleConvert = useCallback(async () => {
    if (
      pendingRef.current ||
      !walletUserId ||
      maximumConvertible < 1 ||
      quantity < 1 ||
      quantity > maximumConvertible
    ) {
      return
    }

    pendingRef.current = true
    setPending(true)
    setNotice(null)
    try {
      const receipt = await convertStars(quantity)
      setNotice({
        kind: 'success',
        message: `Converted ${receipt.rollCount} ${receipt.rollCount === 1 ? 'roll' : 'rolls'}. Balances updated.`,
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error
          ? error.message
          : 'Conversion failed. Please try again.',
      })
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }, [convertStars, maximumConvertible, quantity, walletUserId])

  if (authStatus !== 'authenticated') return null

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Shop">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: `calc(${spacing.unit} * 5)`,
          paddingBottom: `calc(${spacing.unit} * 20)`,
          color: colors.text.primary,
        }}
      >
        <section
          aria-labelledby="shop-wallet-heading"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: `calc(${spacing.unit} * 3)`,
          }}
        >
          <h2
            id="shop-wallet-heading"
            style={{
              color: colors.accent,
              fontSize: typography.fontSize['2xl'],
              fontWeight: typography.fontWeight.bold,
            }}
          >
            Your wallet
          </h2>
          <WalletBalanceSummary
            stars={promotionalStars + paidStars}
            dust={dust}
            standardTickets={standardTickets}
            premiumTickets={premiumTickets}
            stale={stale}
          />
        </section>

        <section
          aria-labelledby="conversion-heading"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: `calc(${spacing.unit} * 3)`,
            padding: `calc(${spacing.unit} * 4)`,
            borderRadius: effects.borderRadius.lg,
            backgroundColor: colors.surface,
            border: `1px solid ${colors.text.muted}`,
            boxShadow: effects.shadows.sm,
          }}
        >
          <div>
            <h3
              id="conversion-heading"
              style={{
                color: colors.text.primary,
                fontSize: typography.fontSize.lg,
                fontWeight: typography.fontWeight.bold,
              }}
            >
              Stars → standard rolls
            </h3>
            <p
              style={{
                marginTop: spacing.unit,
                color: colors.text.secondary,
                fontSize: typography.fontSize.sm,
              }}
            >
              {STARS_PER_STANDARD_ROLL} Stars = 1 standard roll
            </p>
            <p
              style={{
                marginTop: spacing.unit,
                color: colors.text.muted,
                fontSize: typography.fontSize.xs,
              }}
            >
              {promotionalStars.toLocaleString()} promotional Stars available · up to {maximumConvertible.toLocaleString()} rolls
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: `calc(${spacing.unit} * 2)`,
            }}
          >
            <button
              type="button"
              aria-label="Decrease roll quantity"
              onClick={() => changeQuantity(-1)}
              disabled={pending || quantity <= 1}
              style={stepperButtonStyle(currentTheme, pending || quantity <= 1)}
            >
              −
            </button>
            <output
              aria-label="Roll quantity"
              style={{
                minWidth: `calc(${spacing.unit} * 12)`,
                textAlign: 'center',
                color: colors.text.primary,
                fontSize: typography.fontSize.lg,
                fontWeight: typography.fontWeight.bold,
              }}
            >
              {quantity}
            </output>
            <button
              type="button"
              aria-label="Increase roll quantity"
              onClick={() => changeQuantity(1)}
              disabled={
                pending ||
                maximumConvertible < 1 ||
                quantity >= maximumConvertible
              }
              style={stepperButtonStyle(
                currentTheme,
                pending ||
                  maximumConvertible < 1 ||
                  quantity >= maximumConvertible,
              )}
            >
              +
            </button>
          </div>

          <button
            type="button"
            onClick={handleConvert}
            disabled={
              pending ||
              !walletUserId ||
              maximumConvertible < 1 ||
              quantity > maximumConvertible
            }
            style={{
              padding: `calc(${spacing.unit} * 3) calc(${spacing.unit} * 4)`,
              borderRadius: effects.borderRadius.md,
              border: `1px solid ${pending || maximumConvertible < 1 ? colors.text.muted : colors.accent}`,
              backgroundColor: pending || maximumConvertible < 1 ? colors.background : colors.accent,
              color: pending || maximumConvertible < 1 ? colors.text.muted : colors.text.primary,
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.semibold,
              cursor: pending || maximumConvertible < 1 ? 'not-allowed' : 'pointer',
            }}
          >
            {pending
              ? 'Converting…'
              : `Convert ${quantity * STARS_PER_STANDARD_ROLL} Stars`}
          </button>

          {notice && (
            <p
              role={notice.kind === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              style={{
                color: notice.kind === 'error' ? colors.accent : colors.text.secondary,
                fontSize: typography.fontSize.sm,
                fontWeight: typography.fontWeight.medium,
              }}
            >
              {notice.message}
            </p>
          )}
        </section>

        {!paymentsEnabled && (
          <section
            aria-labelledby="bundle-heading"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: `calc(${spacing.unit} * 3)`,
            }}
          >
            <div>
              <h3
                id="bundle-heading"
                style={{
                  color: colors.text.primary,
                  fontSize: typography.fontSize.lg,
                  fontWeight: typography.fontWeight.bold,
                }}
              >
                Star bundles
              </h3>
              <p
                style={{
                  marginTop: spacing.unit,
                  color: colors.text.muted,
                  fontSize: typography.fontSize.sm,
                }}
              >
                Coming soon
              </p>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fit, minmax(calc(${spacing.unit} * 32), 1fr))`,
                gap: `calc(${spacing.unit} * 3)`,
              }}
            >
              {STAR_BUNDLE_PREVIEWS.map(bundle => (
                <button
                  key={bundle.sku}
                  type="button"
                  disabled
                  aria-label={`${bundle.name}: ${bundle.stars} Stars for $${bundle.priceUsd}, coming soon`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: spacing.unit,
                    padding: `calc(${spacing.unit} * 3)`,
                    borderRadius: effects.borderRadius.md,
                    backgroundColor: colors.surface,
                    border: `1px solid ${colors.text.muted}`,
                    color: colors.text.muted,
                    cursor: 'not-allowed',
                  }}
                >
                  <strong
                    style={{
                      color: colors.text.secondary,
                      fontSize: typography.fontSize.sm,
                      fontWeight: typography.fontWeight.semibold,
                    }}
                  >
                    {bundle.name}
                  </strong>
                  <span style={{ fontSize: typography.fontSize.sm }}>
                    {bundle.stars.toLocaleString()} Stars
                  </span>
                  <span style={{ fontSize: typography.fontSize.xs }}>
                    ${bundle.priceUsd} · coming soon
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </BottomSheet>
  )
})

function stepperButtonStyle(
  theme: ReturnType<typeof useTheme>['currentTheme'],
  disabled: boolean,
) {
  const { colors, effects, spacing, typography } = theme.tokens
  return {
    width: `calc(${spacing.unit} * 10)`,
    height: `calc(${spacing.unit} * 10)`,
    borderRadius: effects.borderRadius.full,
    border: `1px solid ${colors.text.muted}`,
    backgroundColor: colors.background,
    color: disabled ? colors.text.muted : colors.text.primary,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    cursor: disabled ? 'not-allowed' : 'pointer',
  } as const
}

export default ShopPanel
