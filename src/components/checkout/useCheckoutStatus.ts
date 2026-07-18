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
 * reports the mapped UI status. Polling and the subscription stop once the order
 * reaches a terminal state (fulfilled/refunded/canceled).
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

/** Default polling cadence for the fallback. Realtime usually beats it. */
export const DEFAULT_POLL_MS = 4000

export interface UseCheckoutStatusOptions {
  /** Injected client (tests); defaults to the memoized app client. */
  client?: SupabaseClient | null
  /** Polling fallback cadence in ms. */
  pollMs?: number
}

export interface CheckoutStatusResult {
  /** Current UI status; `unknown` until the row is first seen. */
  status: PaymentUiStatus
  /** True until the first status read resolves (initial fetch). */
  loading: boolean
}

/**
 * @param externalId The order to watch, or null when there is nothing pending.
 */
export function useCheckoutStatus(
  externalId: string | null,
  options: UseCheckoutStatusOptions = {},
): CheckoutStatusResult {
  const { pollMs = DEFAULT_POLL_MS } = options
  // Resolve the client once per externalId so the effect deps stay stable and a
  // test can inject a fake client without it churning the effect.
  const clientRef = useRef<SupabaseClient | null | undefined>(undefined)
  if (clientRef.current === undefined) {
    clientRef.current = options.client !== undefined ? options.client : getSupabaseClient()
  }

  const [status, setStatus] = useState<PaymentUiStatus>('unknown')
  const [loading, setLoading] = useState<boolean>(externalId !== null)

  useEffect(() => {
    if (!externalId) {
      setStatus('unknown')
      setLoading(false)
      return
    }

    const client = clientRef.current ?? undefined
    let cancelled = false
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let unsubscribe: (() => void) | undefined

    setLoading(true)
    setStatus('unknown')

    const stopPolling = () => {
      if (pollTimer !== undefined) {
        clearInterval(pollTimer)
        pollTimer = undefined
      }
    }

    const apply = (next: PaymentUiStatus | null) => {
      if (cancelled || next === null) return
      setStatus(next)
      if (isTerminalStatus(next)) {
        stopPolling()
        unsubscribe?.()
        unsubscribe = undefined
      }
    }

    // 1. Initial fetch.
    void fetchOrderStatus(externalId, { client }).then((initial) => {
      if (cancelled) return
      setLoading(false)
      apply(initial)
    })

    // 2. Realtime subscription.
    unsubscribe = subscribeOrderStatus(externalId, apply, { client })

    // 3. Polling fallback.
    pollTimer = setInterval(() => {
      void fetchOrderStatus(externalId, { client }).then(apply)
    }, pollMs)

    return () => {
      cancelled = true
      stopPolling()
      unsubscribe?.()
    }
  }, [externalId, pollMs])

  return { status, loading }
}
