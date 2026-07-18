import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PendingPurchaseBanner } from './PendingPurchaseBanner'
import { usePaymentsStore } from '../../store/usePaymentsStore'

function makeControllableClient(initialDbStatus: string | null) {
  let realtimeCb: ((payload: { new?: { status?: string | null } | null }) => void) | null = null
  const channel = {
    on: (_e: string, _f: unknown, cb: typeof realtimeCb) => {
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
  return { client, push: (s: string) => act(() => realtimeCb?.({ new: { status: s } })) }
}

function renderBanner(client: SupabaseClient | null) {
  return render(
    <MemoryRouter>
      <PendingPurchaseBanner client={client} />
    </MemoryRouter>,
  )
}

function setPendingOrder() {
  usePaymentsStore.setState({
    pendingOrder: { externalId: 'ext-relaunch', createdAt: Date.now() - 5000 },
    status: 'pending',
    error: null,
  })
}

describe('PendingPurchaseBanner cold-relaunch reconciliation', () => {
  beforeEach(() => {
    localStorage.clear()
    usePaymentsStore.setState({ pendingOrder: null, status: 'unknown', error: null })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    localStorage.clear()
    usePaymentsStore.setState({ pendingOrder: null, status: 'unknown', error: null })
  })

  it('renders nothing when payments are disabled, even with a pending order', () => {
    setPendingOrder()
    const { container } = renderBanner(null)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when enabled but there is no pending order', () => {
    vi.stubEnv('VITE_PAYMENTS_ENABLED', 'true')
    const { container } = renderBanner(null)
    expect(container).toBeEmptyDOMElement()
  })

  it('surfaces a confirming affordance on relaunch with a persisted pending order', async () => {
    vi.stubEnv('VITE_PAYMENTS_ENABLED', 'true')
    setPendingOrder()
    const { client } = makeControllableClient('paid')

    renderBanner(client)

    await waitFor(() =>
      expect(screen.getByTestId('pending-purchase-banner')).toHaveAttribute(
        'data-status',
        'confirming',
      ),
    )
    expect(screen.getByText('Confirming your purchase…')).toBeInTheDocument()
    // Links to the full status-only return surface.
    expect(screen.getByTestId('pending-purchase-link')).toHaveAttribute(
      'href',
      '/checkout/return',
    )
  })

  it('dismisses itself once the order reaches a terminal state', async () => {
    vi.stubEnv('VITE_PAYMENTS_ENABLED', 'true')
    setPendingOrder()
    const { client, push } = makeControllableClient('pending')

    renderBanner(client)
    await waitFor(() => expect(screen.getByTestId('pending-purchase-banner')).toBeInTheDocument())

    push('fulfilled')
    expect(screen.queryByTestId('pending-purchase-banner')).not.toBeInTheDocument()
  })
})
