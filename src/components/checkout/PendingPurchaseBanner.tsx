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
 * Renders null when disabled, when there is no pending order, or once the order
 * settles to a terminal state (the return screen owns the terminal UX).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { Link } from 'react-router-dom'
import { isPaymentsEnabled } from '../../lib/paymentsConfig'
import { usePaymentsStore } from '../../store/usePaymentsStore'
import { isTerminalStatus } from '../../lib/paymentsOrders'
import { useCheckoutStatus } from './useCheckoutStatus'

export interface PendingPurchaseBannerProps {
  /** Injected client (tests); defaults to the memoized app client. */
  client?: SupabaseClient | null
}

export function PendingPurchaseBanner({ client }: PendingPurchaseBannerProps) {
  const pendingOrder = usePaymentsStore((state) => state.pendingOrder)
  const externalId = pendingOrder?.externalId ?? null
  const { status } = useCheckoutStatus(externalId, { client })

  // Nothing to reconcile, feature off, or already settled → render nothing.
  if (!isPaymentsEnabled() || !pendingOrder) return null
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
