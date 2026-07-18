/**
 * CheckoutReturn — the `/checkout/return` surface (Packet C, issue #153).
 *
 * STATUS-ONLY. This screen never grants an entitlement and never infers success
 * from the redirect (invariant 1: "never grant from success redirect alone").
 * It reads the buyer's own pending order (persisted before checkout handoff),
 * watches the server-authoritative `payment_orders.status` via
 * {@link useCheckoutStatus} (realtime + polling), and shows where the purchase
 * is. Fulfillment is the webhook's job, server-side.
 *
 * Cold-relaunch reconciliation: because the pending order is persisted, landing
 * here after a full app relaunch still finds the order and shows "confirming".
 */

import { useEffect } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { usePaymentsStore } from '../../store/usePaymentsStore'
import type { PaymentUiStatus } from '../../lib/paymentsOrders'
import { isTerminalStatus } from '../../lib/paymentsOrders'
import { useCheckoutStatus } from './useCheckoutStatus'
import { BuyButton } from './BuyButton'

export interface CheckoutReturnProps {
  /** Injected client (tests); defaults to the memoized app client. */
  client?: SupabaseClient | null
  /**
   * Called once when the order reaches `fulfilled`. The real entitlement refresh
   * flows through the existing `user_entitlements` read path / dataSync on the
   * next sync cycle — this hook is a seam for eager refresh, NOT a client grant.
   */
  onFulfilled?: (externalId: string) => void
}

interface StatusCopy {
  title: string
  detail: string
  /** Whether this state is settled (offers a dismiss action). */
  terminal: boolean
}

const STATUS_COPY: Record<PaymentUiStatus, StatusCopy> = {
  pending: {
    title: 'Waiting for payment',
    detail: 'Complete the payment in the checkout window to continue.',
    terminal: false,
  },
  confirming: {
    title: 'Confirming your purchase',
    detail: 'Payment received. We are confirming it with the store — this only takes a moment.',
    terminal: false,
  },
  fulfilled: {
    title: 'Purchase complete',
    detail: 'Your items have been added to your account.',
    terminal: true,
  },
  refunded: {
    title: 'Purchase refunded',
    detail: 'This purchase was refunded. Nothing was charged to keep.',
    terminal: true,
  },
  canceled: {
    title: 'Purchase canceled',
    detail: 'This purchase was canceled. You were not charged.',
    terminal: true,
  },
  unknown: {
    title: 'Looking up your purchase',
    detail: 'Hang tight while we find your order.',
    terminal: false,
  },
}

export function CheckoutReturn({ client, onFulfilled }: CheckoutReturnProps) {
  const pendingOrder = usePaymentsStore((state) => state.pendingOrder)
  const clearPending = usePaymentsStore((state) => state.clearPending)
  const setStatus = usePaymentsStore((state) => state.setStatus)

  const externalId = pendingOrder?.externalId ?? null
  const { status, loading } = useCheckoutStatus(externalId, { client })

  // Mirror the live status into the store so other surfaces (e.g. the relaunch
  // banner) stay in sync, and fire the fulfillment seam exactly once.
  useEffect(() => {
    if (!externalId) return
    setStatus(status)
    if (status === 'fulfilled') onFulfilled?.(externalId)
  }, [externalId, status, setStatus, onFulfilled])

  if (!pendingOrder) {
    return (
      <main
        data-testid="checkout-return"
        className="w-full h-full flex items-center justify-center [background-color:var(--startup-splash-bg)] [color:var(--startup-splash-text)]"
      >
        <div className="text-center max-w-md px-4">
          <h1 className="text-xl font-semibold mb-2">No purchase in progress</h1>
          <p data-testid="checkout-status" data-status="none" className="text-sm opacity-80">
            There is nothing to confirm right now.
          </p>
        </div>
      </main>
    )
  }

  const copy = STATUS_COPY[status]
  const showSpinner = loading || (!copy.terminal && status !== 'pending')
  // A canceled purchase can be retried (starts a fresh order). Only offered when
  // we still know the SKU that was being bought.
  const canRetry = (status === 'canceled' || status === 'refunded') && Boolean(pendingOrder.sku)

  return (
    <main
      data-testid="checkout-return"
      className="w-full h-full flex items-center justify-center [background-color:var(--startup-splash-bg)] [color:var(--startup-splash-text)]"
    >
      <div className="text-center max-w-md px-4">
        <img
          src="/brand/dicesuki-wordmark.svg"
          alt="Dicesuki"
          className="w-40 max-w-[60vw] mx-auto mb-8"
        />
        <h1 className="text-2xl font-bold mb-3">{copy.title}</h1>
        <p
          data-testid="checkout-status"
          data-status={status}
          aria-live="polite"
          className="mb-6"
        >
          {copy.detail}
        </p>
        {showSpinner && (
          <div
            data-testid="checkout-spinner"
            role="status"
            aria-label="Working"
            className="mx-auto mb-2 h-6 w-6 rounded-full border-2 border-current border-t-transparent animate-spin opacity-70"
          />
        )}
        {isTerminalStatus(status) && (
          <div className="mt-2 flex items-center justify-center gap-3">
            {canRetry && pendingOrder.sku && (
              <BuyButton sku={pendingOrder.sku}>Try again</BuyButton>
            )}
            <button
              type="button"
              data-testid="checkout-dismiss"
              onClick={clearPending}
              className="inline-flex items-center rounded-md px-4 py-2 text-sm font-medium [background-color:var(--startup-splash-text)] [color:var(--startup-splash-bg)]"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

export default CheckoutReturn
