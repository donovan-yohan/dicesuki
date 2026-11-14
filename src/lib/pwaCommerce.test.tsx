import { act, renderHook } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registerSW } from 'virtual:pwa-register'
import { startServiceWorkerUpdates, requestServiceWorkerUpdate } from './swUpdate'
import { startPurchase } from './paymentsClient'
import { usePaymentsStore } from '../store/usePaymentsStore'
import { usePullFlow } from '../hooks/usePullFlow'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useDiceStore } from '../store/useDiceStore'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }))
let stop: (() => void) | undefined
beforeEach(() => {
  vi.mocked(registerSW).mockReset()
  localStorage.clear()
  sessionStorage.clear()
  usePaymentsStore.setState({ pendingOrder: null, status: 'unknown' })
  useMultiplayerStore.setState({ roomId: null, connectionStatus: 'disconnected' })
  useDiceStore.setState({ rollingDice: new Set(), currentRollCycleDice: new Set(), savedRollWavesPending: false })
})
afterEach(() => { stop?.(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
function updateWaiting() { vi.mocked(registerSW).mock.calls[0][0]?.onNeedReload?.() }

it('keeps a checkout creation alive before a pending order exists, even while hidden', async () => {
  vi.stubEnv('VITE_PAYMENTS_ENABLED', 'true')
  let finish!: (value: unknown) => void
  const client = { functions: { invoke: () => new Promise(resolve => { finish = resolve }) } } as unknown as SupabaseClient
  const reload = vi.fn()
  stop = startServiceWorkerUpdates({ reload })
  const purchase = startPurchase('sku', { client, openCheckout: vi.fn() })
  updateWaiting()
  expect(reload).not.toHaveBeenCalled()
  finish({ data: { token: 'fixture', external_id: 'order-1' }, error: null })
  await purchase
  expect(reload).not.toHaveBeenCalled()
  usePaymentsStore.getState().clearPending()
  expect(reload).not.toHaveBeenCalled()
  requestServiceWorkerUpdate()
  expect(reload).toHaveBeenCalledTimes(1)
})

it('refuses SDK handoff after the pending-order persistence write is interrupted', async () => {
  vi.stubEnv('VITE_PAYMENTS_ENABLED', 'true')
  const client = { functions: { invoke: async () => ({ data: { token: 'fixture', external_id: 'order-1' }, error: null }) } } as unknown as SupabaseClient
  const openCheckout = vi.fn()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  await expect(startPurchase('sku', { client, openCheckout })).resolves.toMatchObject({ ok: false, reason: 'storage-unavailable' })
  expect(openCheckout).not.toHaveBeenCalled()
})

it('holds reload throughout real pull preparation until the failed intent is acknowledged', async () => {
  let finish!: (value: unknown) => void
  const rpc = vi.fn(() => new Promise(resolve => { finish = resolve }))
  const client = { rpc } as unknown as SupabaseClient
  const reload = vi.fn()
  stop = startServiceWorkerUpdates({ reload })
  const { result } = renderHook(() => usePullFlow({ client, ownerId: 'owner-a' }))
  let pull!: Promise<void>
  act(() => { pull = result.current.startPull('standard-banner@2', 1) })
  updateWaiting()
  expect(reload).not.toHaveBeenCalled()
  await act(async () => { finish({ data: null, error: { message: 'unavailable' } }); await pull })
  expect(reload).not.toHaveBeenCalled()
  act(() => result.current.clearReveal())
  expect(reload).not.toHaveBeenCalled()
  requestServiceWorkerUpdate()
  expect(reload).toHaveBeenCalledTimes(1)
})

it('does not dispatch a pull if its durable idempotency pointer cannot be written', async () => {
  const rpc = vi.fn()
  const client = { rpc } as unknown as SupabaseClient
  const { result } = renderHook(() => usePullFlow({ client, ownerId: 'owner-a' }))
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  await act(async () => { await result.current.startPull('standard-banner@2', 1) })
  expect(rpc).not.toHaveBeenCalled()
  expect(result.current.state).toMatchObject({ status: 'error', stage: 'prepare', error: expect.stringMatching(/storage/i) })
})
