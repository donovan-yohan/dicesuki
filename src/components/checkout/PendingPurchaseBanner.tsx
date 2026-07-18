/**
 * PendingPurchaseBanner — cold-relaunch reconciliation affordance (Packet C).
 *
 * Mounted globally (behind the payments flag) so that if the app is relaunched
 * while a purchase is still in flight — the pending order was persisted before
 * checkout handoff — the buyer sees a small "confirming purchase" affordance
 * instead of the transaction silently vanishing (issue #152 checkout-return
 * safety). Any persisted pending order (age > 0s) surfaces it.
 *
 * STATUS-ONLY: it reconciles by reading the server-authoritative status
 * (realtime + polling) and links to the full return screen. It never grants.
 * Renders null when disabled, when there is no pending order, once the order
 * settles to a terminal state (the return screen owns the terminal UX), on the
 * `/checkout/return` route (where {@link CheckoutReturn} owns the single
 * watcher — no duplicate realtime topic / double polling), or once the order's
 * TTL has elapsed (an abandoned checkout auto-dismisses instead of leaving a
 * permanent banner; the pending record is kept but quiescent).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { Link, useLocation } from 'react-router-dom'
import { isPaymentsEnabled } from '../../lib/paymentsConfig'
import { usePaymentsStore } from '../../store/usePaymentsStore'
import { isTerminalStatus } from '../../lib/paymentsOrders'
import { useCheckoutStatus } from './useCheckoutStatus'

/** The return screen owns the watcher on its own route; suppress the banner there. */
const CHECKOUT_RETURN_PATH = '/checkout/return'

export interface PendingPurchaseBannerProps {
  /** Injected client (tests); defaults to the memoized app client. */
  client?: SupabaseClient | null
}

export function PendingPurchaseBanner({ client }: PendingPurchaseBannerProps) {
  const pendingOrder = usePaymentsStore((state) => state.pendingOrder)
  const location = useLocation()
  // On the return route the dedicated screen owns the watcher; pass a null id so
  // this hook does not open a second subscription / poll loop for the same order.
  const onReturnRoute = location.pathname === CHECKOUT_RETURN_PATH
  const externalId = onReturnRoute ? null : (pendingOrder?.externalId ?? null)
  const { status, expired } = useCheckoutStatus(externalId, {
    client,
    createdAt: pendingOrder?.createdAt ?? null,
  })

  // Nothing to reconcile, feature off, suppressed on the return route, past its
  // TTL, or already settled → render nothing.
  if (!isPaymentsEnabled() || !pendingOrder) return null
  if (onReturnRoute) return null
  if (expired) return null
  if (isTerminalStatus(status)) return null

  const label =
    status === 'confirming'
      ? 'Confirming your purchase…'
      : 'Finishing your purchase…'

  return (
    <div
      data-testid="pending-purchase-banner"
      data-status={status}
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 px-4 py-2 text-sm [background-color:var(--startup-splash-text)] [color:var(--startup-splash-bg)]"
    >
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
      />
      <span>{label}</span>
      <Link
        to="/checkout/return"
        data-testid="pending-purchase-link"
        className="underline underline-offset-2 font-medium"
      >
        View
      </Link>
    </div>
  )
}

export default PendingPurchaseBanner
