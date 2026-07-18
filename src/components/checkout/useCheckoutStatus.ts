/**
 * useCheckoutStatus (Packet C, issue #153).
 *
 * Watches ONE payment order's status, status-only, three ways layered for
 * resilience:
 *   1. an initial fetch (so a status shows immediately, even pre-subscription),
 *   2. a Supabase Realtime subscription (`postgres_changes`) for instant flips,
 *   3. a polling fallback (so a dropped socket never strands the buyer).
 *
 * It NEVER grants anything — it only reads the buyer's own RLS-scoped row and
 * reports the mapped UI status.
 *
 * Bounded watching (issue #153 review, P2): watching is not perpetual.
 *   - Polling backs off (4s → 8s → 15s → 30s cap) so an abandoned checkout does
 *     not hammer the network forever.
 *   - Polling AND the subscription stop the moment the order reaches a terminal
 *     state (fulfilled/refunded/canceled) — that row will not change again.
 *   - A TTL derived from the order's persisted `createdAt` closes the watch
 *     window entirely: after {@link DEFAULT_TTL_MS} the hook goes quiescent and
 *     reports `expired`, so an order that never settles cannot poll or hold a
 *     realtime topic indefinitely. The pending record itself is left intact for
 *     the caller to keep (until terminal or user-dismissed) — this hook only
 *     stops *watching* it.
 */

import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchOrderStatus,
  isTerminalStatus,
  subscribeOrderStatus,
  type PaymentUiStatus,
} from '../../lib/paymentsOrders'
import { getSupabaseClient } from '../../lib/supabaseClient'

/**
 * Polling backoff schedule (ms). The fallback poll fires after the first delay,
 * then steps down the list, holding at the final entry as a sustained cap. This
 * keeps an unsettled order from polling at a fixed high rate forever; Realtime
 * still delivers instant flips when the socket is healthy.
 * Recommended: increasing, capped ≤ 60s. Rationale: 4s feels live right after
 * handoff, 30s is a gentle steady-state that will not drain a backgrounded tab.
 */
export const DEFAULT_POLL_BACKOFF_MS: readonly number[] = [4000, 8000, 15000, 30000]

/**
 * First (and, historically, only) poll cadence. Retained as the head of the
 * backoff schedule for callers/tests that reference a single fallback interval.
 */
export const DEFAULT_POLL_MS = DEFAULT_POLL_BACKOFF_MS[0]

/**
 * Watch TTL (ms) measured from the order's `createdAt`. After this the hook
 * stops polling/subscribing and reports `expired`, so an abandoned checkout can
 * never leave a permanent banner or perpetual polling.
 * Recommended: 15–60 min. Rationale: Xsolla confirmation is normally seconds;
 * 30 min is a generous ceiling that still bounds a stranded order.
 */
export const DEFAULT_TTL_MS = 30 * 60 * 1000

export interface UseCheckoutStatusOptions {
  /** Injected client (tests); defaults to the memoized app client. */
  client?: SupabaseClient | null
  /** Polling backoff schedule in ms (last entry is the sustained cap). */
  pollScheduleMs?: readonly number[]
  /**
   * ms epoch when the order was created (from the persisted pending order).
   * Enables the TTL auto-stop; when null/undefined the hook watches without a
   * TTL (used by the foreground return screen, where the user is present).
   */
  createdAt?: number | null
  /** TTL after which watching stops and `expired` becomes true. */
  ttlMs?: number
}

export interface CheckoutStatusResult {
  /** Current UI status; `unknown` until the row is first seen. */
  status: PaymentUiStatus
  /** True until the first status read resolves (initial fetch). */
  loading: boolean
  /** True once the TTL has elapsed and watching has gone quiescent. */
  expired: boolean
}

/**
 * @param externalId The order to watch, or null when there is nothing pending.
 */
export function useCheckoutStatus(
  externalId: string | null,
  options: UseCheckoutStatusOptions = {},
): CheckoutStatusResult {
  const {
    pollScheduleMs = DEFAULT_POLL_BACKOFF_MS,
    createdAt = null,
    ttlMs = DEFAULT_TTL_MS,
  } = options
  // Resolve the client once per externalId so the effect deps stay stable and a
  // test can inject a fake client without it churning the effect.
  const clientRef = useRef<SupabaseClient | null | undefined>(undefined)
  if (clientRef.current === undefined) {
    clientRef.current = options.client !== undefined ? options.client : getSupabaseClient()
  }

  const [status, setStatus] = useState<PaymentUiStatus>('unknown')
  const [loading, setLoading] = useState<boolean>(externalId !== null)
  const [expired, setExpired] = useState<boolean>(false)

  useEffect(() => {
    if (!externalId) {
      setStatus('unknown')
      setLoading(false)
      setExpired(false)
      return
    }

    // TTL window remaining. Infinity when no createdAt is supplied (no TTL).
    const ttlRemaining = createdAt != null ? createdAt + ttlMs - Date.now() : Infinity
    if (ttlRemaining <= 0) {
      // Already past the TTL at mount — go quiescent immediately, no network,
      // no subscription. The caller keeps the pending record; we just stop.
      setLoading(false)
      setExpired(true)
      return
    }

    const client = clientRef.current ?? undefined
    let cancelled = false
    let stopped = false
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let ttlTimer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: (() => void) | undefined
    let backoffIndex = 0

    setLoading(true)
    setStatus('unknown')
    setExpired(false)

    // Tear down every live watcher (poll timer, TTL timer, subscription). Idempotent.
    const stopWatching = () => {
      stopped = true
      if (pollTimer !== undefined) {
        clearTimeout(pollTimer)
        pollTimer = undefined
      }
      if (ttlTimer !== undefined) {
        clearTimeout(ttlTimer)
        ttlTimer = undefined
      }
      unsubscribe?.()
      unsubscribe = undefined
    }

    const apply = (next: PaymentUiStatus | null) => {
      if (cancelled || stopped || next === null) return
      setStatus(next)
      if (isTerminalStatus(next)) {
        // Terminal: the row will not change again — stop everything.
        stopWatching()
      }
    }

    // Recursive backoff poll: fire after the next scheduled delay, then, if we
    // are still watching, chain the following (longer) step.
    const scheduleNextPoll = () => {
      if (cancelled || stopped) return
      const delay = pollScheduleMs[Math.min(backoffIndex, pollScheduleMs.length - 1)]
      backoffIndex += 1
      pollTimer = setTimeout(() => {
        pollTimer = undefined
        void fetchOrderStatus(externalId, { client }).then((next) => {
          apply(next)
          if (!cancelled && !stopped) scheduleNextPoll()
        })
      }, delay)
    }

    // 1. Initial fetch.
    void fetchOrderStatus(externalId, { client }).then((initial) => {
      if (cancelled) return
      setLoading(false)
      apply(initial)
    })

    // 2. Realtime subscription.
    unsubscribe = subscribeOrderStatus(externalId, apply, { client })

    // 3. Polling fallback (backed off).
    scheduleNextPoll()

    // 4. TTL: close the watch window if the order never settles.
    if (ttlRemaining !== Infinity) {
      ttlTimer = setTimeout(() => {
        stopWatching()
        if (!cancelled) setExpired(true)
      }, ttlRemaining)
    }

    return () => {
      cancelled = true
      stopWatching()
    }
    // `pollScheduleMs` defaults to a stable module constant; callers pass a
    // stable array (or none), so its identity does not churn this effect.
  }, [externalId, createdAt, ttlMs, pollScheduleMs])

  return { status, loading, expired }
}
