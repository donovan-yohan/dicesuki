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
   * Record a freshly created order and move to `pending`. Returns true ONLY
   * after a successful durable write and exact-order readback. A false receipt
   * retains the in-memory order but MUST prevent checkout SDK handoff.
   */
  beginPending: (order: PendingOrder) => boolean
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
): Pick<PaymentsState, 'pendingOrder'> {
  const state =
    persistedState && typeof persistedState === 'object'
      ? (persistedState as Partial<PaymentsState>)
      : {}
  return {
    pendingOrder: normalizePendingOrder(state.pendingOrder),
  }
}

// Share the actual middleware adapter with the receipt check. If initialization
// cannot acquire storage, Zustand otherwise degrades to warning-only updates.
const paymentsStorage = createJSONStorage<Pick<PaymentsState, 'pendingOrder'>>(() => localStorage)
const PAYMENTS_STORAGE_VERSION = 1

export const usePaymentsStore = create<PaymentsState>()(
  persist(
    (set, get) => ({
      pendingOrder: null,
      status: 'unknown',
      error: null,

      beginPending: (order) => {
        try {
          // Zustand updates memory before attempting its synchronous write, so
          // even a failed write leaves this order available for reconciliation.
          set({
            pendingOrder: normalizePendingOrder(order) ?? {
              externalId: order.externalId,
              createdAt: order.createdAt,
            },
            status: 'pending',
            error: null,
          })
          if (!paymentsStorage) return false
          const persisted = paymentsStorage.getItem(PAYMENTS_STORAGE_KEY)
          if (!persisted || persisted instanceof Promise || persisted.version !== PAYMENTS_STORAGE_VERSION) return false
          const savedOrder = persisted.state?.pendingOrder
          return savedOrder?.externalId === order.externalId
            && savedOrder.createdAt === order.createdAt
            && savedOrder.sku === order.sku
        } catch {
          return false
        }
      },

      setStatus: (status) => set({ status }),

      setError: (message) => set({ error: message }),

      clearPending: () => set({ pendingOrder: null, status: 'unknown', error: null }),

      hasPendingReconciliation: () => get().pendingOrder !== null,
    }),
    {
      name: PAYMENTS_STORAGE_KEY,
      storage: paymentsStorage,
      version: PAYMENTS_STORAGE_VERSION,
      // Only the durable pending-order marker is persisted; status/error are
      // ephemeral and re-derived from the server on reconcile.
      partialize: (state) => ({ pendingOrder: state.pendingOrder }),
      migrate: (persistedState) => normalizePersistedPaymentsState(persistedState),
    },
  ),
)
