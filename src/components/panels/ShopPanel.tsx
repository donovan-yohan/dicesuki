import { motion } from 'framer-motion'
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import { shouldReduceMotion } from '../../animations/ui-transitions'
import { useTheme } from '../../contexts/ThemeContext'
import type { DiceShape } from '../../types/diceShape'
import type { RenderDeviceTier } from '../../lib/renderLod'
import { isPaymentsEnabled } from '../../lib/paymentsConfig'
import { WalletConversionError } from '../../lib/walletBalances'
import { useAuthStore } from '../../store/useAuthStore'
import { useWalletStore } from '../../store/useWalletStore'
import {
  MAX_STANDARD_ROLL_CONVERSION_COUNT,
  STAR_BUNDLE_PREVIEWS,
  STARS_PER_STANDARD_ROLL,
} from '../economy/shopCatalog'
import { WalletBalanceSummary } from '../economy/WalletHud'
import { LunarPassCard } from './LunarPassCard'
import { PullBannerScreen } from './PullBannerScreen'

interface ShopPanelProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: 'shop' | 'banners'
  onAddDie?: (type: DiceShape, inventoryDieId: string) => string | null
  tableDiceCount?: number
  deviceTier?: RenderDeviceTier
}

type ConversionNotice =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }
  | null

export const ShopPanel = memo(function ShopPanel({
  isOpen,
  onClose,
  initialTab = 'shop',
  onAddDie = () => null,
  tableDiceCount = 0,
  deviceTier = 'high',
}: ShopPanelProps) {
  const authStatus = useAuthStore(state => state.status)
  const signIn = useAuthStore(state => state.signInWithDiscord)
  const walletUserId = useWalletStore(state => state.userId)
  const promotionalStars = useWalletStore(state => state.wallet.stars.promotional)
  const paidStars = useWalletStore(state => state.wallet.stars.paid ?? 0)
  const dust = useWalletStore(state => state.wallet.dust.earned)
  const standardTickets = useWalletStore(state => state.tickets.standard_roll)
  const premiumTickets = useWalletStore(state => state.tickets.premium_roll)
  const stale = useWalletStore(state => state.stale)
  const subscription = useWalletStore(state => state.subscription)
  const refreshBalances = useWalletStore(state => state.refresh)
  const convertStars = useWalletStore(state => state.convertStarsToStandardRoll)
  const [quantity, setQuantity] = useState(1)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<ConversionNotice>(null)
  const [activeTab, setActiveTab] = useState<'shop' | 'banners'>(initialTab)
  const pendingRef = useRef(false)
  const dialogRef = useRef<HTMLElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const bannersTabId = useId()
  const shopTabId = useId()
  const bannersPanelId = useId()
  const shopPanelId = useId()
  onCloseRef.current = onClose
  const { currentTheme } = useTheme()
  const { colors, effects, spacing, typography } = currentTheme.tokens
  const affordable = Math.floor(promotionalStars / STARS_PER_STANDARD_ROLL)
  const maximumConvertible = Math.min(
    affordable,
    MAX_STANDARD_ROLL_CONVERSION_COUNT,
  )
  const quantityCeiling = Math.max(1, maximumConvertible)
  const paymentsEnabled = isPaymentsEnabled()
  const reduceMotion = shouldReduceMotion()

  useEffect(() => {
    setQuantity(current => Math.min(Math.max(current, 1), quantityCeiling))
  }, [quantityCeiling])

  useEffect(() => {
    if (isOpen) setActiveTab(initialTab)
  }, [initialTab, isOpen])

  // Guests get the same shell, so they get the same focus trap and Escape.
  useEffect(() => {
    if (!isOpen) return

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const dialog = dialogRef.current
    const focusableSelector = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')
    const focusFirst = () => {
      const first = dialog?.querySelector<HTMLElement>(focusableSelector)
      ;(first ?? dialog)?.focus()
    }
    const animationFrame = window.requestAnimationFrame(focusFirst)

    const handleKeyDown = (event: KeyboardEvent) => {
      // A nested modal owns focus and Escape while it is open.
      const hasNestedModal = Boolean(dialog?.querySelector(
        '[role="dialog"][aria-modal="true"]',
      ))
      if (hasNestedModal) return

      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      )
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(animationFrame)
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocusedRef.current?.focus()
      previouslyFocusedRef.current = null
    }
  }, [isOpen])

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
        message: conversionErrorCopy(error),
      })
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }, [convertStars, maximumConvertible, quantity, walletUserId])

  if (!isOpen) return null

  const signedIn = authStatus === 'authenticated'

  return (
      <motion.section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shop-title"
        tabIndex={-1}
        className="fixed inset-0 z-50 flex h-[100dvh] flex-col overflow-hidden"
        style={{
          color: colors.text.primary,
          backgroundColor: colors.background,
        }}
        // No `exit`: the panel is unmounted by its own `isOpen` guard, so there
        // is no AnimatePresence that could ever play one.
        initial={{ y: reduceMotion ? 0 : '100%', opacity: reduceMotion ? 1 : 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.4, 0, 0.2, 1] }}
      >
        <header
          className="shrink-0 border-b px-4 pt-2"
          style={{
            borderColor: colors.text.muted,
            backgroundColor: colors.surface,
          }}
        >
          <div className="flex min-h-11 items-center justify-between gap-3">
            <h1
              id="shop-title"
              style={{
                color: colors.accent,
                fontSize: typography.fontSize.xl,
                fontWeight: typography.fontWeight.bold,
              }}
            >
              Shop
            </h1>
            <button
              type="button"
              className="min-h-11 min-w-11 text-xl"
              onClick={onClose}
              aria-label="Close Shop"
            >
              ×
            </button>
          </div>
          <nav role="tablist" aria-label="Shop sections" className="grid grid-cols-2 gap-2">
            <button
              id={bannersTabId}
              type="button"
              role="tab"
              aria-selected={activeTab === 'banners'}
              aria-controls={bannersPanelId}
              className="min-h-11 border-b-2 font-bold"
              onClick={() => setActiveTab('banners')}
              style={{ borderColor: activeTab === 'banners' ? colors.accent : 'transparent' }}
            >
              Banners
            </button>
            <button
              id={shopTabId}
              type="button"
              role="tab"
              aria-selected={activeTab === 'shop'}
              aria-controls={shopPanelId}
              className="min-h-11 border-b-2 font-bold"
              onClick={() => setActiveTab('shop')}
              style={{ borderColor: activeTab === 'shop' ? colors.accent : 'transparent' }}
            >
              Wallet &amp; bundles
            </button>
          </nav>
          {/* The wallet block is account data — auth-gated, shell is not. */}
          {signedIn && (
            <div className="pb-3 pt-2">
              <WalletBalanceSummary
                stars={promotionalStars + paidStars}
                dust={dust}
                standardTickets={standardTickets}
                premiumTickets={premiumTickets}
                stale={stale}
              />
            </div>
          )}
        </header>

        {activeTab === 'banners' ? (
          <div
            id={bannersPanelId}
            role="tabpanel"
            aria-labelledby={bannersTabId}
            className="flex min-h-0 flex-1 flex-col"
          >
            <PullBannerScreen
              onAddDie={onAddDie}
              tableDiceCount={tableDiceCount}
              deviceTier={deviceTier}
            />
          </div>
        ) : (
          <div
            id={shopPanelId}
            role="tabpanel"
            aria-labelledby={shopTabId}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-5"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: `calc(${spacing.unit} * 5)`,
              paddingBottom: `calc(${spacing.unit} * 20)`,
              color: colors.text.primary,
            }}
          >
        {!signedIn ? (
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
            <p style={{ color: colors.text.secondary, fontSize: typography.fontSize.sm }}>
              Sign in to hold Stars, convert them into standard rolls, and keep
              everything you pull.
            </p>
            <button
              type="button"
              className="min-h-11 rounded-md px-4 font-bold"
              style={{
                border: `1px solid ${colors.accent}`,
                backgroundColor: colors.accent,
                color: colors.text.primary,
              }}
              onClick={() => void signIn()}
            >
              Sign in with Discord
            </button>
          </section>
        ) : (
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
              aria-live={notice.kind === 'success' ? 'polite' : undefined}
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
        )}

        <LunarPassCard
          key={`${walletUserId ?? 'none'}:${subscription?.subscriptionId ?? 'none'}`}
          userId={walletUserId}
          subscription={subscription}
          paymentsEnabled={paymentsEnabled}
          refreshBalances={refreshBalances}
        />

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
        )}
      </motion.section>
  )
})

function conversionErrorCopy(error: unknown): string {
  if (!(error instanceof WalletConversionError)) {
    return 'Conversion failed. Please try again.'
  }

  switch (error.kind) {
    case 'invalid_request':
      return 'Choose a valid number of rolls and try again.'
    case 'insufficient_funds':
      return "You don't have enough Stars for that conversion."
    case 'rpc_failure':
      return 'Conversion failed. Please try again.'
    default:
      return 'Conversion failed. Please try again.'
  }
}

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
