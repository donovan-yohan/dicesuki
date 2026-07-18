import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CheckoutReturn } from './CheckoutReturn'
import { usePaymentsStore } from '../../store/usePaymentsStore'

/**
 * A fake Supabase client with a controllable initial read and a captured
 * realtime callback, so a test can drive the order through the state machine.
 */
function makeControllableClient(initialDbStatus: string | null) {
  let realtimeCb: ((payload: { new?: { status?: string | null } | null }) => void) | null = null
  const channel = {
    on: (_event: string, _filter: unknown, cb: typeof realtimeCb) => {
      realtimeCb = cb
      return channel
    },
    subscribe: () => channel,
  }
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: initialDbStatus ? { status: initialDbStatus } : null,
            error: null,
          }),
        }),
      }),
    }),
    channel: () => channel,
    removeChannel: () => {},
  } as unknown as SupabaseClient

  return {
    client,
    push: (dbStatus: string) => act(() => realtimeCb?.({ new: { status: dbStatus } })),
  }
}

function setPendingOrder(externalId = 'ext-return') {
  usePaymentsStore.setState({
    pendingOrder: { externalId, createdAt: Date.now() },
    status: 'pending',
    error: null,
  })
}

describe('CheckoutReturn (status-only state machine)', () => {
  beforeEach(() => {
    localStorage.clear()
    usePaymentsStore.setState({ pendingOrder: null, status: 'unknown', error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    localStorage.clear()
    usePaymentsStore.setState({ pendingOrder: null, status: 'unknown', error: null })
  })

  it('shows an empty state when there is no pending order', () => {
    render(<CheckoutReturn client={null} />)
    expect(screen.getByTestId('checkout-status')).toHaveAttribute('data-status', 'none')
  })

  it('renders "pending" from the initial read, then "confirming", then "fulfilled"', async () => {
    setPendingOrder()
    const { client, push } = makeControllableClient('pending')

    render(<CheckoutReturn client={client} />)

    await waitFor(() =>
      expect(screen.getByTestId('checkout-status')).toHaveAttribute('data-status', 'pending'),
    )

    push('paid')
    expect(screen.getByTestId('checkout-status')).toHaveAttribute('data-status', 'confirming')

    push('fulfilled')
    expect(screen.getByTestId('checkout-status')).toHaveAttribute('data-status', 'fulfilled')
    // Terminal state offers a dismiss action; no spinner.
    expect(screen.getByTestId('checkout-dismiss')).toBeInTheDocument()
    expect(screen.queryByTestId('checkout-spinner')).not.toBeInTheDocument()
  })

  it('fires onFulfilled exactly once and lets the user dismiss', async () => {
    setPendingOrder('ext-fulfil')
    const onFulfilled = vi.fn()
    const { client, push } = makeControllableClient('paid')

    render(<CheckoutReturn client={client} onFulfilled={onFulfilled} />)
    await waitFor(() =>
      expect(screen.getByTestId('checkout-status')).toHaveAttribute('data-status', 'confirming'),
    )
    expect(onFulfilled).not.toHaveBeenCalled()

    push('fulfilled')
    expect(onFulfilled).toHaveBeenCalledTimes(1)
    expect(onFulfilled).toHaveBeenCalledWith('ext-fulfil')

    act(() => screen.getByTestId('checkout-dismiss').click())
    expect(usePaymentsStore.getState().pendingOrder).toBeNull()
  })

  it('renders the refunded terminal state', async () => {
    setPendingOrder()
    const { client } = makeControllableClient('refunded')
    render(<CheckoutReturn client={client} />)
    await waitFor(() =>
      expect(screen.getByTestId('checkout-status')).toHaveAttribute('data-status', 'refunded'),
    )
  })

  it('renders the canceled terminal state', async () => {
    setPendingOrder()
    const { client } = makeControllableClient('canceled')
    render(<CheckoutReturn client={client} />)
    await waitFor(() =>
      expect(screen.getByTestId('checkout-status')).toHaveAttribute('data-status', 'canceled'),
    )
  })

  it('offers a retry (BuyButton) when a canceled order still knows its SKU', async () => {
    vi.stubEnv('VITE_PAYMENTS_ENABLED', 'true')
    usePaymentsStore.setState({
      pendingOrder: { externalId: 'ext-retry', createdAt: Date.now(), sku: 'cosmetic.devil_d6' },
      status: 'pending',
      error: null,
    })
    const { client } = makeControllableClient('canceled')

    render(<CheckoutReturn client={client} />)
    await waitFor(() =>
      expect(screen.getByTestId('checkout-status')).toHaveAttribute('data-status', 'canceled'),
    )
    // The flag-gated retry button is present; the dismiss action remains too.
    expect(screen.getByTestId('buy-button')).toBeInTheDocument()
    expect(screen.getByTestId('checkout-dismiss')).toBeInTheDocument()
  })

  it('never grants an entitlement client-side (no writes to the client)', async () => {
    setPendingOrder()
    // A read-only client: any write method access would be a bug. We assert the
    // component only ever reads (from/select) and subscribes — it exposes no
    // insert/update/rpc calls.
    const insert = vi.fn()
    const client = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: 'fulfilled' }, error: null }) }) }),
        insert,
        update: insert,
        upsert: insert,
      }),
      rpc: insert,
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    } as unknown as SupabaseClient

    render(<CheckoutReturn client={client} />)
    await waitFor(() =>
      expect(screen.getByTestId('checkout-status')).toHaveAttribute('data-status', 'fulfilled'),
    )
    expect(insert).not.toHaveBeenCalled()
  })
})
