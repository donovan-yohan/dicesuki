/**
 * Payments domain store (Packet C, issue #153 / Frontend-ADR-002).
 *
 * Owns the one piece of client payment state that MUST survive a redirect,
 * refresh, or cold relaunch: the pending order (its `externalId` + `createdAt`).
 * Persisting this before checkout handoff is what makes cold-relaunch
 * reconciliation possible — on next app start we can re-find the buyer's order
 * and show "confirming purchase" instead of silently losing the transaction
 * (issue #152 checkout-return safety).
 *
 * This store NEVER holds an entitlement or grants anything: fulfillment truth is
 * the webhook (invariant 1). `status` here is a display-only projection of the
 * server-authoritative `payment_orders.status`, refreshed by the status hook.
 *
 * Persistence: only `pendingOrder` is persisted (via `partialize`); `status` is
 * ephemeral and always re-derived from the server. Per Frontend-ADR-002 the
 * store carries a `version` + `migrate`, and the persisted value is a plain
 * serializable object (no Map/Set).
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { PaymentUiStatus, PendingOrder } from '../lib/paymentsOrders'

/** localStorage key for the persisted pending-order marker. */
export const PAYMENTS_STORAGE_KEY = 'dicesuki-payments'

export interface PaymentsState {
  /** The purchase awaiting server confirmation, or null when none is open. */
  pendingOrder: PendingOrder | null
  /** Display-only projection of the server order status. */
  status: PaymentUiStatus
  /** Human-readable error for a failed checkout handoff (not a payment failure). */
  error: string | null

  /**
   * Record a freshly created order and move to `pending`. MUST be called (and
   * thus persisted) BEFORE the checkout SDK handoff so a relaunch can reconcile.
   */
  beginPending: (order: PendingOrder) => void
  /** Update the display status from a server read/subscription. */
  setStatus: (status: PaymentUiStatus) => void
  /** Record a checkout-handoff error (SDK/network), leaving the order intact. */
  setError: (message: string | null) => void
  /** Clear the pending order + reset status (terminal state or dismissal). */
  clearPending: () => void
  /** True when a persisted pending order exists to reconcile on app start. */
  hasPendingReconciliation: () => boolean
}

/** Validate/normalize a persisted pending order; drop anything malformed. */
export function normalizePendingOrder(value: unknown): PendingOrder | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const externalId = record.externalId
  const createdAt = record.createdAt
  if (typeof externalId !== 'string' || externalId.length === 0) return null
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null
  const sku = typeof record.sku === 'string' && record.sku.length > 0 ? record.sku : undefined
  return sku ? { externalId, createdAt, sku } : { externalId, createdAt }
}

/** Normalize any persisted blob into a valid partial state (Frontend-ADR-002). */
export function normalizePersistedPaymentsState(
  persistedState: unknown,
): Partial<PaymentsState> {
  const state =
    persistedState && typeof persistedState === 'object'
      ? (persistedState as Partial<PaymentsState>)
      : {}
  return {
    pendingOrder: normalizePendingOrder(state.pendingOrder),
  }
}

export const usePaymentsStore = create<PaymentsState>()(
  persist(
    (set, get) => ({
      pendingOrder: null,
      status: 'unknown',
      error: null,

      beginPending: (order) =>
        set({
          pendingOrder: normalizePendingOrder(order) ?? {
            externalId: order.externalId,
            createdAt: order.createdAt,
          },
          status: 'pending',
          error: null,
        }),

      setStatus: (status) => set({ status }),

      setError: (message) => set({ error: message }),

      clearPending: () => set({ pendingOrder: null, status: 'unknown', error: null }),

      hasPendingReconciliation: () => get().pendingOrder !== null,
    }),
    {
      name: PAYMENTS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Only the durable pending-order marker is persisted; status/error are
      // ephemeral and re-derived from the server on reconcile.
      partialize: (state) => ({ pendingOrder: state.pendingOrder }),
      migrate: (persistedState) => normalizePersistedPaymentsState(persistedState),
    },
  ),
)
