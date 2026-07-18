import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PAYMENTS_STORAGE_KEY,
  normalizePendingOrder,
  normalizePersistedPaymentsState,
  usePaymentsStore,
} from './usePaymentsStore'

function readPersisted(): { state?: Record<string, unknown> } | null {
  const raw = localStorage.getItem(PAYMENTS_STORAGE_KEY)
  return raw ? (JSON.parse(raw) as { state?: Record<string, unknown> }) : null
}

describe('usePaymentsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    usePaymentsStore.setState({ pendingOrder: null, status: 'unknown', error: null })
  })

  afterEach(() => {
    localStorage.clear()
    usePaymentsStore.setState({ pendingOrder: null, status: 'unknown', error: null })
  })

  it('records a pending order and moves to "pending"', () => {
    usePaymentsStore.getState().beginPending({ externalId: 'ext-1', createdAt: 1000 })
    const state = usePaymentsStore.getState()
    expect(state.pendingOrder).toEqual({ externalId: 'ext-1', createdAt: 1000 })
    expect(state.status).toBe('pending')
    expect(state.hasPendingReconciliation()).toBe(true)
  })

  it('persists ONLY the pending order to localStorage (partialize)', () => {
    usePaymentsStore.getState().beginPending({ externalId: 'ext-2', createdAt: 2000 })
    usePaymentsStore.getState().setStatus('confirming')

    const persisted = readPersisted()
    expect(persisted?.state?.pendingOrder).toEqual({ externalId: 'ext-2', createdAt: 2000 })
    // Ephemeral fields are never persisted.
    expect(persisted?.state).not.toHaveProperty('status')
    expect(persisted?.state).not.toHaveProperty('error')
  })

  it('clears the pending order and resets status', () => {
    usePaymentsStore.getState().beginPending({ externalId: 'ext-3', createdAt: 3000 })
    usePaymentsStore.getState().clearPending()
    const state = usePaymentsStore.getState()
    expect(state.pendingOrder).toBeNull()
    expect(state.status).toBe('unknown')
    expect(state.hasPendingReconciliation()).toBe(false)
    expect(readPersisted()?.state?.pendingOrder).toBeNull()
  })

  it('survives a simulated cold relaunch (persisted marker is reconcilable)', () => {
    usePaymentsStore.getState().beginPending({ externalId: 'ext-4', createdAt: 4000 })
    // Simulate a fresh process where only localStorage survived: rehydrate the
    // persisted blob through the store's own migrate/normalizer.
    const persisted = readPersisted()
    const rehydrated = normalizePersistedPaymentsState(persisted?.state)
    expect(rehydrated.pendingOrder).toEqual({ externalId: 'ext-4', createdAt: 4000 })
  })
})

describe('pending-order normalization (migrate)', () => {
  it('accepts a well-formed order', () => {
    expect(normalizePendingOrder({ externalId: 'a', createdAt: 1 })).toEqual({
      externalId: 'a',
      createdAt: 1,
    })
  })

  it.each([
    null,
    undefined,
    {},
    { externalId: '', createdAt: 1 },
    { externalId: 'a' },
    { externalId: 'a', createdAt: 'nope' },
    { externalId: 42, createdAt: 1 },
    { externalId: 'a', createdAt: Number.NaN },
  ])('rejects malformed order %j', (value) => {
    expect(normalizePendingOrder(value)).toBeNull()
  })

  it('drops a malformed persisted blob to a clean state', () => {
    expect(normalizePersistedPaymentsState({ pendingOrder: { bad: true } })).toEqual({
      pendingOrder: null,
    })
    expect(normalizePersistedPaymentsState('garbage')).toEqual({ pendingOrder: null })
  })
})
