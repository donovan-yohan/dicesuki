import { useEffect, useMemo, useRef, useState } from 'react'
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
import { useAuthStore } from '../../store/useAuthStore'
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
  const [ratesOpen, setRatesOpen] = useState(false)
  const [convertCount, setConvertCount] = useState<PullCount | null>(null)
  const [insufficientCount, setInsufficientCount] = useState<PullCount | null>(null)
  const [converting, setConverting] = useState(false)
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

  const hardGuarantee = pity?.rareHardGuaranteePull
  const misses = pity?.rareMisses
  const remaining = pity
    ? Math.max(0, pity.rareHardGuaranteePull - pity.rareMisses)
    : null

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{
        color: 'var(--color-text-primary)',
        backgroundColor: 'var(--color-background)',
      }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-52">
        <header className="sticky top-0 z-10 -mx-4 border-b px-4 py-2 backdrop-blur">
          <div className="flex min-h-11 items-center justify-between">
            <button type="button" className="min-h-11 min-w-11" onClick={onClose} aria-label="Close Banners">
              Back
            </button>
            <h1 className="text-xl font-bold">Shop</h1>
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Fair pulls <span aria-hidden="true">✓</span>
            </span>
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

        <div role="tablist" aria-label="Banner class" className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            role="tab"
            aria-selected={activeClass === 'standard'}
            className="min-h-11 rounded-md border"
            onClick={() => setActiveClass('standard')}
          >
            Standard
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeClass === 'premium'}
            className="min-h-11 rounded-md border"
            onClick={() => setActiveClass('premium')}
          >
            Premium · Coming soon
          </button>
        </div>

        {activeClass === 'premium' ? (
          <PremiumDormant />
        ) : (
          <>
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

            <section className="mt-5 border-y py-4" aria-labelledby="pity-heading">
              <div className="flex items-center justify-between">
                <h2 id="pity-heading" className="font-bold">Pity</h2>
                {pity && <span>{pity.rareMisses}/{pity.rareHardGuaranteePull}</span>}
              </div>
              {authStatus !== 'authenticated' ? (
                <p className="mt-2 text-sm">Sign in to view your server-owned pity.</p>
              ) : !banner ? (
                <p className="mt-2 text-sm">Pity is unavailable until a ticket-bound banner is active.</p>
              ) : pityLoading ? (
                <p className="mt-2 text-sm" aria-label="Loading pity">Loading pity…</p>
              ) : pityError ? (
                <p className="mt-2 text-sm" role="status">Pity unavailable: {pityError}</p>
              ) : pity && hardGuarantee !== undefined && misses !== undefined && remaining !== null ? (
                <>
                  <div
                    className="mt-2 h-2 overflow-hidden"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={hardGuarantee}
                    aria-valuenow={Math.min(misses, hardGuarantee)}
                    aria-label="Rare guarantee progress"
                    style={{ backgroundColor: 'var(--color-surface)' }}
                  >
                    <div
                      className="h-full"
                      style={{
                        width: `${Math.min(100, misses / hardGuarantee * 100)}%`,
                        backgroundColor: 'var(--color-accent)',
                      }}
                    />
                  </div>
                  <p className="mt-2 text-sm">
                    Rare+ guaranteed within {remaining} {remaining === 1 ? 'pull' : 'pulls'}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm">Pity is unavailable.</p>
              )}
              <button type="button" className="mt-2 min-h-11 underline" onClick={() => setRatesOpen(true)}>
                Rates and pity rules
              </button>
            </section>

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
          </>
        )}
      </div>

      <footer
        className="fixed inset-x-0 bottom-0 z-20 border-t p-4"
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
          <button type="button" className="mt-2 min-h-11 text-sm" onClick={() => setRatesOpen(true)}>
            Provably fair <span aria-hidden="true">✓</span>
          </button>
        </div>
      </footer>

      <BottomSheet isOpen={ratesOpen} onClose={() => setRatesOpen(false)} title="Rates and pity">
        <RatesDisclosure
          rates={rates}
          loading={ratesLoading}
          error={ratesError}
          bannerVersionId={banner?.bannerVersionId ?? null}
        />
      </BottomSheet>

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

function RatesDisclosure({
  rates,
  loading,
  error,
  bannerVersionId,
}: {
  rates: PullTierRate[] | null
  loading: boolean
  error: string | null
  bannerVersionId: string | null
}) {
  return (
    <div className="space-y-4">
      <p>Standard pulls use a shallow, server-owned pity counter.</p>
      {loading ? (
        <p aria-label="Loading exact rates">Loading exact rates…</p>
      ) : rates && bannerVersionId ? (
        <>
          <table className="w-full text-left">
            <caption className="sr-only">Standard banner base rarity rates</caption>
            <tbody>
              {rates.map(rate => (
                <tr key={rate.tierId}>
                  <th className="py-2 capitalize">{rate.tierId}</th>
                  <td>{rate.percent.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Exact base weights for {bannerVersionId}. Guarantees can increase the
            effective chance shown by the server-owned pity rules.
          </p>
        </>
      ) : (
        <p role="status">
          Exact rates are unavailable{error ? `: ${error}` : ' until a ticket-bound banner is active.'}
        </p>
      )}
    </div>
  )
}

function PremiumDormant() {
  return (
    <section className="mt-5 border-y py-8 text-center" aria-labelledby="premium-heading">
      <p className="text-xs font-bold uppercase tracking-wider">Locked</p>
      <h2 id="premium-heading" className="mt-2 text-2xl font-bold">Premium banner</h2>
      <p className="mt-2" style={{ color: 'var(--color-text-secondary)' }}>
        Coming soon. Soft pity begins at pull 41; featured is guaranteed by 75.
      </p>
      <div className="mx-auto mt-5 h-2 max-w-sm" style={{ backgroundColor: 'var(--color-surface)' }}>
        <div className="h-full w-[55%]" style={{ backgroundColor: 'var(--color-text-muted)' }} />
      </div>
      <p className="mt-2 text-sm">Base zone · soft-pity zone · hard 75</p>
    </section>
  )
}
