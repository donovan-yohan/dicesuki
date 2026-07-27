import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { DiceShape } from '../../types/diceShape'
import type { PullCount, PullCtaState, StandardPullBanner } from '../../types/pull'
import type { PullPitySnapshot } from '../../lib/pullPity'
import type { RenderDeviceTier } from '../../lib/renderLod'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { usePullFlow } from '../../hooks/usePullFlow'
import { useHapticFeedback } from '../../hooks/useHapticFeedback'
import { fetchActiveStandardPullBanner } from '../../lib/pullRpc'
import { derivePullCtaState } from '../../lib/pullFlow'
import { fetchMyPullPity } from '../../lib/pullPity'
import { getSupabaseClient } from '../../lib/supabaseClient'
import { type AuthStatus, useAuthStore } from '../../store/useAuthStore'
import { useInventoryStore } from '../../store/useInventoryStore'
import { useWalletStore } from '../../store/useWalletStore'
import { CurrencyText } from '../economy/CurrencyGlyph'
import { BottomSheet } from './BottomSheet'
import { PullDicePreview } from './PullDicePreview'
import { PullProgressOverlay } from './PullProgressOverlay'
import { PullRevealOverlay } from './PullRevealOverlay'

interface PullBannerScreenProps {
  onClose: () => void
  onOpenShop: () => void
  onAddDie: (type: DiceShape, inventoryDieId: string) => string | null
  tableDiceCount: number
  deviceTier: RenderDeviceTier
  /** Renders inside ShopPanel's shared full-screen surface. */
  embedded?: boolean
}

interface PullTierRate {
  tierId: string
  weightUnits: number
  percent: number
}

export function PullBannerScreen({
  onClose,
  onOpenShop,
  onAddDie,
  tableDiceCount,
  deviceTier,
  embedded = false,
}: PullBannerScreenProps) {
  const client = getSupabaseClient()
  const authStatus = useAuthStore(state => state.status)
  const userId = useAuthStore(state => state.user?.id ?? null)
  const signIn = useAuthStore(state => state.signInWithDiscord)
  const walletLoading = useWalletStore(state => state.loading)
  const walletStale = useWalletStore(state => state.stale)
  const tickets = useWalletStore(state => state.tickets.standard_roll)
  const stars = useWalletStore(state => (
    state.wallet.stars.promotional + (state.wallet.stars.paid ?? 0)
  ))
  const promotionalStars = useWalletStore(state => state.wallet.stars.promotional)
  const convertStars = useWalletStore(state => state.convertStarsToStandardRoll)
  const featuredDie = useInventoryStore(state => (
    state.dice.find(die => die.type === 'd20' && !die.isDev) ??
    state.dice.find(die => !die.isDev)
  ))
  const online = useOnlineStatus()
  const { vibrateOnCollision } = useHapticFeedback()
  const flow = usePullFlow({ client, ownerId: userId })
  const [banner, setBanner] = useState<StandardPullBanner | null>(null)
  const [bannerLoading, setBannerLoading] = useState(Boolean(client))
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [pity, setPity] = useState<PullPitySnapshot | null>(null)
  const [pityLoading, setPityLoading] = useState(false)
  const [pityError, setPityError] = useState<string | null>(null)
  const [rates, setRates] = useState<PullTierRate[] | null>(null)
  const [ratesLoading, setRatesLoading] = useState(false)
  const [ratesError, setRatesError] = useState<string | null>(null)
  const [activeClass, setActiveClass] = useState<'standard' | 'premium'>('standard')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [convertCount, setConvertCount] = useState<PullCount | null>(null)
  const [insufficientCount, setInsufficientCount] = useState<PullCount | null>(null)
  const [converting, setConverting] = useState(false)
  const standardBannerTabId = useId()
  const premiumBannerTabId = useId()
  const standardBannerPanelId = useId()
  const premiumBannerPanelId = useId()
  const [conversionError, setConversionError] = useState<string | null>(null)
  const [pityRefreshGeneration, setPityRefreshGeneration] = useState(0)
  const previousFlowStatusRef = useRef(flow.state.status)

  useEffect(() => {
    const previousStatus = previousFlowStatusRef.current
    previousFlowStatusRef.current = flow.state.status
    if (
      previousStatus !== flow.state.status &&
      (
        flow.state.status === 'revealed' ||
        flow.state.status === 'cancelled' ||
        flow.state.status === 'expired'
      )
    ) {
      setPityRefreshGeneration(generation => generation + 1)
    }
  }, [flow.state.status])

  useEffect(() => {
    let active = true
    if (!client) {
      setBannerLoading(false)
      return
    }
    setBannerLoading(true)
    setBannerError(null)
    void fetchActiveStandardPullBanner(client)
      .then(value => {
        if (!active) return
        setBanner(value)
        setBannerLoading(false)
      })
      .catch(error => {
        if (!active) return
        setBanner(null)
        setBannerError(error instanceof Error ? error.message : 'Banner lookup failed.')
        setBannerLoading(false)
      })
    return () => {
      active = false
    }
  }, [client])

  useEffect(() => {
    let active = true
    if (!client || !userId || !banner) {
      setPity(null)
      setPityLoading(false)
      setPityError(null)
      return
    }
    setPityLoading(true)
    setPityError(null)
    void fetchMyPullPity(client, banner.bannerFamilyId)
      .then(value => {
        if (!active) return
        if (value.bannerVersionId !== banner.bannerVersionId) {
          setPity(null)
          setPityError('Pity belongs to a different banner version.')
          return
        }
        setPity(value)
      })
      .catch(error => {
        if (active) {
          setPity(null)
          setPityError(error instanceof Error ? error.message : 'Pity is unavailable.')
        }
      })
      .finally(() => {
        if (active) setPityLoading(false)
      })
    return () => {
      active = false
    }
  }, [banner, client, pityRefreshGeneration, userId])

  useEffect(() => {
    let active = true
    if (!client || !banner) {
      setRates(null)
      setRatesLoading(false)
      setRatesError(null)
      return
    }
    setRatesLoading(true)
    setRatesError(null)
    void (async () => {
      try {
        const { data, error } = await client
          .from('pull_banner_tiers')
          .select('tier_id, weight_units')
          .eq('banner_version_id', banner.bannerVersionId)
        if (!active) return
        if (error || !Array.isArray(data) || data.length === 0) {
          setRates(null)
          setRatesError(error?.message ?? 'Exact rates are unavailable.')
          return
        }
        const parsed = data.map((row: Record<string, unknown>) => ({
          tierId: typeof row.tier_id === 'string' ? row.tier_id : '',
          weightUnits: typeof row.weight_units === 'number' ? row.weight_units : 0,
        }))
        const total = parsed.reduce((sum, row) => sum + row.weightUnits, 0)
        if (
          total <= 0 ||
          parsed.some(row => !row.tierId || !Number.isSafeInteger(row.weightUnits) || row.weightUnits <= 0)
        ) {
          setRates(null)
          setRatesError('Exact rates returned malformed data.')
          return
        }
        setRates(parsed.map(row => ({
          ...row,
          percent: row.weightUnits / total * 100,
        })))
      } catch (error) {
        if (active) {
          setRates(null)
          setRatesError(error instanceof Error ? error.message : 'Exact rates are unavailable.')
        }
      } finally {
        if (active) setRatesLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [banner, client])

  const ctas = useMemo(() => ([1, 10] as const).map(pullCount => (
    derivePullCtaState({
      signedIn: authStatus === 'authenticated',
      pullCount,
      availableTickets: tickets,
      promotionalStars,
    })
  )), [authStatus, promotionalStars, tickets])

  const handleCta = (cta: PullCtaState) => {
    if (activeClass === 'premium' || flow.isBusy || !online) return
    if (cta.kind === 'sign-in') {
      void signIn()
      return
    }
    if (!banner) return
    vibrateOnCollision('light')
    if (cta.kind === 'tickets') {
      void flow.startPull(banner.bannerVersionId, cta.pullCount)
    } else if (cta.kind === 'convert') {
      setConversionError(null)
      setConvertCount(cta.pullCount)
    } else {
      setInsufficientCount(cta.pullCount)
    }
  }

  const convertAndPull = async () => {
    if (!convertCount || !banner) return
    const deficit = Math.max(0, convertCount - tickets)
    setConverting(true)
    setConversionError(null)
    try {
      await convertStars(deficit)
      setConvertCount(null)
      await flow.startPull(banner.bannerVersionId, convertCount)
    } catch {
      setConversionError('Conversion failed. Check your balance and try again.')
    } finally {
      setConverting(false)
    }
  }

  const preparation = flow.state.status === 'sealing' ||
    flow.state.status === 'hold' ||
    flow.state.status === 'cancelling' ||
    flow.state.status === 'expiring'
    ? flow.state.preparation
    : undefined
  const hasRetainedSession = [
    'preparing',
    'sealing',
    'hold',
    'restoring',
    'cancelling',
    'expiring',
    'auth-required',
    'revealed',
  ].includes(flow.state.status) || (
    flow.state.status === 'error' && flow.state.stage === 'restore'
  )

  if (authStatus !== 'authenticated' && hasRetainedSession) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pull-auth-lost-title"
        className="fixed inset-0 z-[70] flex items-center justify-center p-6 text-center"
        style={{ backgroundColor: 'var(--color-background)' }}
      >
        <div className="max-w-md">
          <h2 id="pull-auth-lost-title" className="text-2xl font-bold">
            Sign in to continue
          </h2>
          <p className="mt-3" style={{ color: 'var(--color-text-secondary)' }}>
            Your pull session is retained. A committed result remains safe and
            can be restored after sign-in.
          </p>
          <button
            type="button"
            className="mt-5 min-h-11 rounded-md px-4 font-bold"
            onClick={() => void signIn()}
          >
            Sign in with Discord
          </button>
        </div>
      </div>
    )
  }

  if (flow.state.status === 'auth-required') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Restore retained pull"
        className="fixed inset-0 z-[70] flex items-center justify-center p-6 text-center"
        style={{ backgroundColor: 'var(--color-background)' }}
      >
        <div className="max-w-md">
          <h2 className="text-2xl font-bold">Restore your pull</h2>
          <p className="mt-3">{flow.state.message}</p>
          <button
            type="button"
            className="mt-5 min-h-11 px-4"
            onClick={() => void flow.retryRestore()}
          >
            Retry restoring pull
          </button>
        </div>
      </div>
    )
  }

  if (flow.state.status === 'revealed' && flow.assembly && flow.summary) {
    return (
      <PullRevealOverlay
        assembly={flow.assembly}
        summary={flow.summary}
        deviceTier={deviceTier}
        tableDiceCount={tableDiceCount}
        onAddDie={onAddDie}
        onDone={flow.clearReveal}
      />
    )
  }

  if (
    flow.state.status === 'sealing' ||
    flow.state.status === 'hold' ||
    flow.state.status === 'restoring' ||
    flow.state.status === 'cancelling' ||
    flow.state.status === 'expiring'
  ) {
    return (
      <PullProgressOverlay
        mode={flow.state.status === 'sealing'
          ? 'sealing'
          : flow.state.status === 'restoring'
            ? 'restoring'
            : 'hold'}
        preparation={preparation}
        error={flow.state.status === 'hold' ? flow.state.error : null}
        cancelling={flow.state.status === 'cancelling' || flow.state.status === 'expiring'}
        onRevealNow={() => void flow.revealNow()}
        onCancel={() => void flow.cancel()}
        onExpired={() => void flow.expire()}
      />
    )
  }

  if (flow.state.status === 'revealed' && !flow.assembly) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Restoring pull inventory"
        className="fixed inset-0 z-[70] flex items-center justify-center p-6 text-center"
        style={{ backgroundColor: 'var(--color-background)' }}
      >
        <div className="max-w-md">
          <h2 className="text-2xl font-bold">Restoring your dice…</h2>
          {flow.inventoryRefreshError ? (
            <>
              <p role="alert" className="mt-3">
                Your pull is safe, but the inventory view could not refresh.
              </p>
              <button type="button" className="mt-5 min-h-11 px-4" onClick={flow.clearReveal}>
                Back to Banners
              </button>
            </>
          ) : (
            <p className="mt-3" style={{ color: 'var(--color-text-secondary)' }}>
              The grant is committed. Loading its live copy record.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={embedded
        ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
        : 'fixed inset-0 z-50 flex h-[100dvh] flex-col overflow-hidden'}
      style={{
        color: 'var(--color-text-primary)',
        backgroundColor: 'var(--color-background)',
      }}
    >
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-y-auto px-4 pb-5">
        {!embedded && (
          <header className="sticky top-0 z-10 -mx-4 border-b px-4 py-2 backdrop-blur">
          <div className="flex min-h-11 items-center justify-between">
            <button type="button" className="min-h-11 min-w-11" onClick={onClose} aria-label="Close Banners">
              Back
            </button>
            <h1 className="text-xl font-bold">Shop</h1>
            <span className="min-w-11" aria-hidden="true" />
          </div>
          <nav aria-label="Shop sections" className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-current="page"
              className="min-h-11 border-b-2 font-bold"
              style={{ borderColor: 'var(--color-accent)' }}
            >
              Banners
            </button>
            <button type="button" className="min-h-11" onClick={onOpenShop}>
              Wallet &amp; bundles
            </button>
          </nav>
          </header>
        )}

        <div role="tablist" aria-label="Banner class" className="mt-4 grid grid-cols-2 gap-2">
          <button
            id={standardBannerTabId}
            type="button"
            role="tab"
            aria-selected={activeClass === 'standard'}
            aria-controls={standardBannerPanelId}
            className="min-h-11 rounded-md border"
            onClick={() => setActiveClass('standard')}
          >
            Standard
          </button>
          <button
            id={premiumBannerTabId}
            type="button"
            role="tab"
            aria-selected={activeClass === 'premium'}
            aria-controls={premiumBannerPanelId}
            className="min-h-11 rounded-md border"
            onClick={() => setActiveClass('premium')}
          >
            Premium · Coming soon
          </button>
        </div>

        {activeClass === 'premium' ? (
          <div
            id={premiumBannerPanelId}
            role="tabpanel"
            aria-labelledby={premiumBannerTabId}
          >
            <PremiumDormant />
            <button
              type="button"
              className="mt-4 min-h-11 self-start underline"
              onClick={() => setDetailsOpen(true)}
            >
              Banner details: odds, pity &amp; pool
            </button>
          </div>
        ) : (
          <div
            id={standardBannerPanelId}
            role="tabpanel"
            aria-labelledby={standardBannerTabId}
          >
            <section className="mt-4" aria-labelledby="standard-banner-heading">
              <div
                className="h-[min(42vh,360px)] overflow-hidden border-y"
                style={{ borderColor: 'var(--color-text-muted)' }}
              >
                {bannerLoading || !featuredDie ? (
                  <div
                    className="h-full animate-pulse"
                    aria-label="Loading banner"
                    style={{ backgroundColor: 'var(--color-surface)' }}
                  />
                ) : (
                  <PullDicePreview dice={[featuredDie]} deviceTier={deviceTier} mode="hero" />
                )}
              </div>
              <h2 id="standard-banner-heading" className="mt-4 text-2xl font-bold">
                Permanent collection
              </h2>
              <p style={{ color: 'var(--color-text-secondary)' }}>
                Real dice for your table. The standard pool never rotates away.
              </p>
            </section>

            <button
              type="button"
              className="mt-4 min-h-11 self-start underline"
              onClick={() => setDetailsOpen(true)}
            >
              Banner details: odds, pity &amp; pool
            </button>

            {!online && (
              <p role="status" className="mt-4">You&apos;re offline. Pulls will resume when you reconnect.</p>
            )}
            {!bannerLoading && !banner && (
              <p role="status" className="mt-4 border-l-2 pl-3">
                Standard pulls are temporarily unavailable: no ticket-bound banner is active.
                Your rolls and Stars will not be spent.
                {bannerError ? ` (${bannerError})` : ''}
              </p>
            )}
            {flow.state.status === 'error' && (
              <div className="mt-4">
                <p role="alert">{flow.state.error}</p>
                {flow.state.stage === 'prepare' && (
                  <button type="button" className="mt-2 min-h-11 underline" onClick={() => void flow.retryPrepare()}>
                    Try pull again
                  </button>
                )}
                {flow.state.stage === 'restore' && (
                  <button type="button" className="mt-2 min-h-11 underline" onClick={() => void flow.retryRestore()}>
                    Retry restoring pull
                  </button>
                )}
              </div>
            )}
            {(flow.state.status === 'cancelled' || flow.state.status === 'expired') && (
              <p role="status" className="mt-4">{flow.state.message}</p>
            )}
          </div>
        )}
      </div>

      <footer
        className="shrink-0 border-t p-4"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderColor: 'var(--color-text-muted)',
        }}
      >
        <div className="mx-auto max-w-3xl">
          <div className="mb-3 flex min-h-11 items-center justify-between gap-3 text-sm">
            {walletLoading || (walletStale && authStatus === 'authenticated') ? (
              <span aria-label="Loading balances" className="animate-pulse">Loading balances…</span>
            ) : (
              <>
                <CurrencyText kind="roll">{tickets} standard rolls</CurrencyText>
                <CurrencyText kind="stars">{stars.toLocaleString()} Stars</CurrencyText>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {ctas.map(cta => {
              const locked = activeClass === 'premium'
              const unavailable = authStatus === 'authenticated' && !banner
              const disabled = locked || unavailable || !online || bannerLoading ||
                flow.isBusy || (cta.kind === 'insufficient')
              return (
                <button
                  key={cta.pullCount}
                  type="button"
                  className="min-h-11 rounded-md border px-3 py-2 text-sm font-bold"
                  disabled={disabled}
                  aria-label={locked ? `Pull ${cta.pullCount}, coming soon` : cta.label}
                  onClick={() => handleCta(cta)}
                  style={{
                    borderColor: disabled ? 'var(--color-text-muted)' : 'var(--color-accent)',
                    color: disabled ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                    backgroundColor: cta.pullCount === 10 && !disabled
                      ? 'var(--color-accent)'
                      : 'var(--color-background)',
                  }}
                >
                  {locked
                    ? 'Coming soon'
                    : unavailable
                      ? 'Pull unavailable'
                      : cta.label}
                </button>
              )
            })}
          </div>
          {activeClass === 'standard' && ctas.some(cta => cta.kind === 'insufficient') && (
            <button
              type="button"
              className="mt-2 min-h-11 text-sm underline"
              onClick={() => {
                const unaffordable = [...ctas].reverse().find(cta => cta.kind === 'insufficient')
                if (unaffordable) setInsufficientCount(unaffordable.pullCount)
              }}
            >
              How to earn more rolls
            </button>
          )}
        </div>
      </footer>

      <BannerDetailsModal
        isOpen={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        bannerClass={activeClass}
        banner={banner}
        authStatus={authStatus}
        pity={pity}
        pityLoading={pityLoading}
        pityError={pityError}
        rates={rates}
        ratesLoading={ratesLoading}
        ratesError={ratesError}
      />

      <BottomSheet
        isOpen={convertCount !== null}
        onClose={() => setConvertCount(null)}
        title="Convert Stars → rolls"
      >
        {convertCount && (
          <div className="grid gap-4">
            <p>You have {promotionalStars.toLocaleString()} promotional Stars.</p>
            <p>
              Pull ×{convertCount} needs {Math.max(0, convertCount - tickets)} more rolls.
              Convert {Math.max(0, convertCount - tickets) * 160} Stars?
            </p>
            {conversionError && <p role="alert">{conversionError}</p>}
            <button
              type="button"
              className="min-h-11 rounded-md px-4 font-bold"
              onClick={() => void convertAndPull()}
              disabled={converting}
            >
              {converting ? 'Converting…' : 'Convert & pull'}
            </button>
            <button type="button" className="min-h-11" onClick={() => setConvertCount(null)}>
              Cancel
            </button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        isOpen={insufficientCount !== null}
        onClose={() => setInsufficientCount(null)}
        title="Not enough rolls yet"
      >
        <div className="grid gap-3">
          <p>You have {tickets} rolls · need {insufficientCount ?? 0}.</p>
          <p>Daily login: +1 roll tomorrow</p>
          <p>Weekly budget: 10 rolls per week</p>
          {tickets >= 1 && (
            <button
              type="button"
              className="min-h-11"
              onClick={() => {
                setInsufficientCount(null)
                const one = ctas[0]
                handleCta(one)
              }}
            >
              Pull ×1 instead
            </button>
          )}
          <button type="button" className="min-h-11" onClick={() => setInsufficientCount(null)}>
            Back
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}

function BannerDetailsModal({
  isOpen,
  onClose,
  bannerClass,
  banner,
  authStatus,
  pity,
  pityLoading,
  pityError,
  rates,
  ratesLoading,
  ratesError,
}: {
  isOpen: boolean
  onClose: () => void
  bannerClass: 'standard' | 'premium'
  banner: StandardPullBanner | null
  authStatus: AuthStatus
  pity: PullPitySnapshot | null
  pityLoading: boolean
  pityError: string | null
  rates: PullTierRate[] | null
  ratesLoading: boolean
  ratesError: string | null
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

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

  if (!isOpen) return null

  const remaining = pity
    ? Math.max(0, pity.rareHardGuaranteePull - pity.rareMisses)
    : null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.72)' }}
      onMouseDown={onClose}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="banner-details-title"
        tabIndex={-1}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg border p-5"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderColor: 'var(--color-text-muted)',
        }}
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="banner-details-title" className="text-xl font-bold">Banner details</h2>
          <button type="button" className="min-h-11 min-w-11" onClick={onClose} aria-label="Close banner details">
            ×
          </button>
        </div>

        <section className="mt-4" aria-labelledby="banner-pool-heading">
          <h3 id="banner-pool-heading" className="font-bold">Pool</h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {bannerClass === 'standard'
              ? 'Permanent collection. The standard pool never rotates away.'
              : 'Premium pool details are coming soon.'}
          </p>
        </section>

        <section className="mt-4" aria-labelledby="banner-odds-heading">
          <h3 id="banner-odds-heading" className="font-bold">Base odds</h3>
          {bannerClass === 'premium' ? (
            <p className="mt-1 text-sm" role="status">
              Premium banner odds are unavailable while it is coming soon.
            </p>
          ) : ratesLoading ? (
            <p className="mt-1 text-sm" aria-label="Loading exact rates">Loading exact rates…</p>
          ) : rates && banner ? (
            <>
              <table className="mt-1 w-full text-left">
                <caption className="sr-only">Standard banner base rarity rates</caption>
                <tbody>
                  {rates.map(rate => (
                    <tr key={rate.tierId}>
                      <th className="py-1 capitalize">{rate.tierId}</th>
                      <td>{rate.percent.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Exact base weights for {banner.bannerVersionId}; guarantees can raise the effective chance.
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm" role="status">
              Exact rates are unavailable{ratesError ? `: ${ratesError}` : ' until a ticket-bound banner is active.'}
            </p>
          )}
        </section>

        <section className="mt-4" aria-labelledby="banner-pity-heading">
          <h3 id="banner-pity-heading" className="font-bold">Pity</h3>
          {bannerClass === 'premium' ? (
            <>
              <p className="mt-1 text-sm">
                Soft pity begins at pull 41; featured is guaranteed by 75.
              </p>
              <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Base zone · soft-pity zone · hard 75
              </p>
            </>
          ) : authStatus !== 'authenticated' ? (
            <p className="mt-1 text-sm">Sign in to view your current pity.</p>
          ) : pityLoading ? (
            <p className="mt-1 text-sm" aria-label="Loading pity">Loading pity…</p>
          ) : pityError ? (
            <p className="mt-1 text-sm" role="status">Pity unavailable: {pityError}</p>
          ) : pity && remaining !== null ? (
            <>
              <p className="mt-1 text-sm">
                Rare+ guaranteed within {remaining} {remaining === 1 ? 'pull' : 'pulls'}
                {' '}({pity.rareMisses}/{pity.rareHardGuaranteePull}).
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                <li>Rare+ hard guarantee: pull {pity.rareHardGuaranteePull}</li>
                <li>Epic+ hard guarantee: pull {pity.epicHardGuaranteePull}</li>
                <li>Selected-item hard guarantee: pull {pity.selectedHardGuaranteePull}</li>
              </ul>
              <div
                className="mt-2 h-2 overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={pity.rareHardGuaranteePull}
                aria-valuenow={Math.min(pity.rareMisses, pity.rareHardGuaranteePull)}
                aria-label="Rare guarantee progress"
                style={{ backgroundColor: 'var(--color-background)' }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${Math.min(100, pity.rareMisses / pity.rareHardGuaranteePull * 100)}%`,
                    backgroundColor: 'var(--color-accent)',
                  }}
                />
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm">Pity is unavailable until a ticket-bound banner is active.</p>
          )}
        </section>

        <section className="mt-4" aria-labelledby="banner-fairness-heading">
          <h3 id="banner-fairness-heading" className="font-bold">Fair pulls</h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            The server seals each outcome before reveal. Its verification receipt includes
            the commitment root, seed, and per-result nonces after the pull completes.
          </p>
        </section>
      </section>
    </div>
  )
}

function PremiumDormant() {
  return (
    <section className="mt-5 border-y py-8 text-center" aria-labelledby="premium-heading">
      <p className="text-xs font-bold uppercase tracking-wider">Locked</p>
      <h2 id="premium-heading" className="mt-2 text-2xl font-bold">Premium banner</h2>
      <p className="mt-2" style={{ color: 'var(--color-text-secondary)' }}>
        Coming soon. See banner details for its planned pool and pity rules.
      </p>
    </section>
  )
}
