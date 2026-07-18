import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuyButton } from './BuyButton'
import { startPurchase } from '../../lib/paymentsClient'

// Mock the buy flow so no real edge function / SDK is touched. This also lets us
// assert the flag-off surface never even calls into the SDK-bearing flow.
vi.mock('../../lib/paymentsClient', () => ({
  startPurchase: vi.fn(async () => ({ ok: true, externalId: 'ext' })),
}))

const startPurchaseMock = vi.mocked(startPurchase)

describe('BuyButton flag gating', () => {
  beforeEach(() => {
    startPurchaseMock.mockClear()
    startPurchaseMock.mockResolvedValue({ ok: true, externalId: 'ext' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('renders NOTHING when payments are disabled (default)', () => {
    const { container } = render(<BuyButton sku="cosmetic.devil_d6" />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('buy-button')).not.toBeInTheDocument()
    // The only path to the Pay Station SDK (startPurchase) is unreachable.
    expect(startPurchaseMock).not.toHaveBeenCalled()
  })

  it('renders a buy button and starts the purchase when enabled', async () => {
    vi.stubEnv('VITE_PAYMENTS_ENABLED', 'true')
    const user = userEvent.setup()

    render(<BuyButton sku="cosmetic.devil_d6" />)
    const button = screen.getByTestId('buy-button')
    expect(button).toBeInTheDocument()

    await user.click(button)
    await waitFor(() =>
      expect(startPurchaseMock).toHaveBeenCalledWith('cosmetic.devil_d6'),
    )
  })

  it('surfaces a failure message via onError', async () => {
    vi.stubEnv('VITE_PAYMENTS_ENABLED', 'true')
    startPurchaseMock.mockResolvedValueOnce({
      ok: false,
      reason: 'checkout-failed',
      message: 'declined',
    })
    const onError = vi.fn()
    const user = userEvent.setup()

    render(<BuyButton sku="sku" onError={onError} />)
    await user.click(screen.getByTestId('buy-button'))

    await waitFor(() => expect(onError).toHaveBeenCalledWith('declined'))
  })
})
