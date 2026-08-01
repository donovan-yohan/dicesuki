import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from '../../contexts/ThemeContext'
import {
  claimLunarDailyStars,
  LunarPassClaimError,
} from '../../lib/lunarPass'
import type { LunarSubscriptionSnapshot } from '../../lib/walletBalances'
import { selectIsLunarPassEntitled } from '../../store/useWalletStore'
import { LUNAR_PASS_OFFER } from './lunarPassOffer'

const MAX_TIMEOUT_MS = 2_147_000_000

interface LunarPassCardProps {
  userId: string | null
  subscription: LunarSubscriptionSnapshot | null
  paymentsEnabled: boolean
  refreshBalances: () => Promise<void>
}

type LunarPassView =
  | { kind: 'offer' }
  | {
      kind: 'entitled'
      statusText: string
    }

export function LunarPassCard({
  userId,
  subscription,
  paymentsEnabled,
  refreshBalances,
}: LunarPassCardProps) {
  const [claimPending, setClaimPending] = useState(false)
  const [claimedUtcDay, setClaimedUtcDay] = useState<string | null>(null)
  const [claimNotice, setClaimNotice] = useState<string | null>(null)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const claimInFlight = useRef(false)
  const mounted = useRef(true)
  const currentScope = useRef({
    userId,
    subscriptionId: subscription?.subscriptionId ?? null,
  })
  currentScope.current = {
    userId,
    subscriptionId: subscription?.subscriptionId ?? null,
  }
  const { currentTheme } = useTheme()
  const { colors, effects, spacing, typography } = currentTheme.tokens
  const view = lunarPassView(subscription, now)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!subscription || subscription.status === 'active') return
    const boundaryValue = subscription.status === 'non_renewing'
      ? subscription.dateNextCharge
      : subscription.dateEnd
    const boundary = boundaryValue ? Date.parse(boundaryValue) : Number.NaN
    if (!Number.isFinite(boundary) || now >= boundary) return

    const liveDelay = boundary - Date.now()
    if (liveDelay <= 0) {
      setNow(Date.now())
      return
    }
    const timeout = setTimeout(
      () => setNow(Date.now()),
      Math.min(liveDelay + 1, MAX_TIMEOUT_MS),
    )
    return () => clearTimeout(timeout)
  }, [now, subscription])

  useEffect(() => {
    if (view.kind === 'offer') {
      setClaimedUtcDay(null)
      setClaimNotice(null)
      setClaimError(null)
    }
  }, [view.kind])

  useEffect(() => {
    if (!claimedUtcDay) return

    const interval = setInterval(() => {
      setNow(Date.now())
    }, 60_000)

    return () => clearInterval(interval)
  }, [claimedUtcDay])

  useEffect(() => {
    if (!claimedUtcDay) return
    const resetAt = Date.parse(`${claimedUtcDay}T00:00:00.000Z`) + 86_400_000
    if (!Number.isFinite(resetAt)) return

    let stopped = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const scheduleReset = () => {
      if (stopped) return
      const remaining = resetAt - Date.now()
      if (remaining <= 0) {
        setNow(Date.now())
        setClaimedUtcDay(null)
        setClaimNotice(null)
        return
      }
      timeout = setTimeout(scheduleReset, Math.min(remaining, MAX_TIMEOUT_MS))
    }
    scheduleReset()

    return () => {
      stopped = true
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }, [claimedUtcDay])

  const handleClaim = useCallback(async () => {
    if (
      claimInFlight.current ||
      view.kind !== 'entitled' ||
      !userId ||
      !subscription
    ) {
      return
    }

    const invocationScope = {
      userId,
      subscriptionId: subscription.subscriptionId,
    }
    const isInvocationCurrent = () =>
      mounted.current &&
      currentScope.current.userId === invocationScope.userId &&
      currentScope.current.subscriptionId === invocationScope.subscriptionId
    claimInFlight.current = true
    setClaimPending(true)
    setClaimError(null)
    try {
      const receipt = await claimLunarDailyStars()
      if (
        !isInvocationCurrent() ||
        receipt.userId !== invocationScope.userId ||
        receipt.subscriptionId !== invocationScope.subscriptionId
      ) {
        return
      }
      setClaimedUtcDay(receipt.utcDay)
      setClaimNotice(receipt.alreadyClaimed
        ? 'Already claimed today.'
        : `${receipt.creditedStars} Stars claimed.`)
      setNow(Date.now())

      // The receipt is committed success truth. Reconciliation is deliberately
      // best-effort so a transient refresh failure cannot turn it into an error.
      try {
        await refreshBalances()
      } catch {
        // The wallet store marks failed reconciliation stale.
      }
    } catch (error) {
      if (!isInvocationCurrent()) return
      setClaimError(lunarPassClaimErrorCopy(error))
    } finally {
      claimInFlight.current = false
      if (isInvocationCurrent()) setClaimPending(false)
    }
  }, [refreshBalances, subscription, userId, view.kind])

  return (
    <section
      aria-labelledby="lunar-pass-heading"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: `calc(${spacing.unit} * 3)`,
        padding: `calc(${spacing.unit} * 4)`,
        borderRadius: effects.borderRadius.lg,
        backgroundColor: colors.surface,
        border: `1px solid ${colors.accent}`,
        boxShadow: effects.shadows.sm,
      }}
    >
      <div>
        <h3
          id="lunar-pass-heading"
          style={{
            color: colors.accent,
            fontSize: typography.fontSize.lg,
            fontWeight: typography.fontWeight.bold,
          }}
        >
          Lunar Pass
        </h3>
        <p
          style={{
            marginTop: spacing.unit,
            color: colors.text.secondary,
            fontSize: typography.fontSize.sm,
          }}
        >
          ${LUNAR_PASS_OFFER.priceUsd.toFixed(2)} / month
        </p>
      </div>

      {view.kind === 'offer' ? (
        <>
          <p
            style={{
              color: colors.text.primary,
              fontSize: typography.fontSize.sm,
            }}
          >
            {LUNAR_PASS_OFFER.purchaseStars} Stars on purchase +{' '}
            {LUNAR_PASS_OFFER.dailyStars} Stars each UTC day ={' '}
            {LUNAR_PASS_OFFER.monthlyStars.toLocaleString()} Stars / month.
          </p>
          <p
            style={{
              color: colors.text.muted,
              fontSize: typography.fontSize.xs,
            }}
          >
            Subscription automatically renews monthly at $
            {LUNAR_PASS_OFFER.priceUsd.toFixed(2)} until canceled. Cancel anytime
            through your payment provider.
          </p>
          <button
            type="button"
            disabled
            aria-label={paymentsEnabled
              ? 'Subscribe to Lunar Pass, unavailable'
              : 'Subscribe to Lunar Pass, coming soon'}
            style={{
              padding: `calc(${spacing.unit} * 3) calc(${spacing.unit} * 4)`,
              borderRadius: effects.borderRadius.md,
              border: `1px solid ${colors.text.muted}`,
              backgroundColor: colors.background,
              color: colors.text.muted,
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.semibold,
              cursor: 'not-allowed',
            }}
          >
            {paymentsEnabled ? 'Subscription unavailable' : 'Subscribe · coming soon'}
          </button>
        </>
      ) : (
        <>
          <p
            style={{
              color: colors.text.primary,
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.semibold,
            }}
          >
            {view.statusText}
          </p>
          <div
            aria-label="Daily Lunar Stars"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: `calc(${spacing.unit} * 2)`,
              padding: `calc(${spacing.unit} * 3)`,
              borderRadius: effects.borderRadius.md,
              backgroundColor: colors.background,
              border: `1px solid ${colors.text.muted}`,
            }}
          >
            <h4
              style={{
                color: colors.text.primary,
                fontSize: typography.fontSize.sm,
                fontWeight: typography.fontWeight.bold,
              }}
            >
              Daily Lunar Stars
            </h4>
            <p
              style={{
                color: colors.text.muted,
                fontSize: typography.fontSize.xs,
              }}
            >
              Claim {LUNAR_PASS_OFFER.dailyStars} Stars today. Unclaimed daily
              Stars expire at 00:00 UTC.
            </p>

            {claimedUtcDay ? (
              <>
                <p
                  role="status"
                  aria-live="polite"
                  style={{
                    color: colors.text.secondary,
                    fontSize: typography.fontSize.sm,
                    fontWeight: typography.fontWeight.semibold,
                  }}
                >
                  ✓ {claimNotice ?? 'Claimed today.'}
                </p>
                <p
                  style={{
                    color: colors.text.muted,
                    fontSize: typography.fontSize.xs,
                  }}
                >
                  Resets at 00:00 UTC ({utcResetCountdown(now)}).
                </p>
              </>
            ) : (
              <button
                type="button"
                onClick={handleClaim}
                disabled={claimPending}
                style={{
                  padding: `calc(${spacing.unit} * 3) calc(${spacing.unit} * 4)`,
                  borderRadius: effects.borderRadius.md,
                  border: `1px solid ${claimPending ? colors.text.muted : colors.accent}`,
                  backgroundColor: claimPending ? colors.background : colors.accent,
                  color: claimPending ? colors.text.muted : colors.onAccent,
                  fontSize: typography.fontSize.sm,
                  fontWeight: typography.fontWeight.semibold,
                  cursor: claimPending ? 'not-allowed' : 'pointer',
                }}
              >
                {claimPending
                  ? 'Claiming…'
                  : `Claim ${LUNAR_PASS_OFFER.dailyStars} Stars`}
              </button>
            )}

            {claimError && (
              <p
                role="alert"
                style={{
                  color: colors.accent,
                  fontSize: typography.fontSize.sm,
                  fontWeight: typography.fontWeight.medium,
                }}
              >
                {claimError}
              </p>
            )}
          </div>
          <p
            style={{
              color: colors.text.muted,
              fontSize: typography.fontSize.xs,
            }}
          >
            Manage or cancel your subscription through your payment provider.
          </p>
        </>
      )}
    </section>
  )
}

function lunarPassClaimErrorCopy(error: unknown): string {
  if (!(error instanceof LunarPassClaimError)) {
    return 'Daily claim failed. Please try again.'
  }

  switch (error.kind) {
    case 'not_entitled':
      return "An active Lunar Pass is needed to claim today's Stars."
    case 'unauthenticated':
      return "Sign in again to claim today's Lunar Stars."
    case 'not_configured':
      return 'Daily Lunar Star claims are unavailable right now.'
    case 'rpc_failure':
      return 'Daily claim failed. Please try again.'
    default:
      return 'Daily claim failed. Please try again.'
  }
}

function lunarPassView(
  subscription: LunarSubscriptionSnapshot | null,
  at: number,
): LunarPassView {
  if (!subscription || !selectIsLunarPassEntitled({ subscription }, at)) {
    return { kind: 'offer' }
  }

  if (subscription.status === 'active') {
    const renewalDate = subscription.dateNextCharge
      ? formatSubscriptionDate(subscription.dateNextCharge)
      : null
    return {
      kind: 'entitled',
      statusText: renewalDate
        ? `Active · renews ${renewalDate}`
        : 'Active',
    }
  }

  const boundary = subscription.status === 'non_renewing'
    ? subscription.dateNextCharge
    : subscription.dateEnd
  return {
    kind: 'entitled',
    statusText: `Ends ${formatSubscriptionDate(boundary!)}`,
  }
}

function formatSubscriptionDate(value: string): string | null {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(date)
  } catch {
    return null
  }
}

function utcResetCountdown(timestamp: number): string {
  const now = new Date(timestamp)
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  )
  const minutes = Math.max(1, Math.ceil((nextMidnight - timestamp) / 60_000))
  const hoursPart = Math.floor(minutes / 60)
  const minutesPart = minutes % 60
  return `in ${hoursPart}h ${minutesPart}m`
}
