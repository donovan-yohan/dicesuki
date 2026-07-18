import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPaymentsEnabled, isPaymentsSandbox } from './paymentsConfig'

describe('paymentsConfig feature flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is OFF by default when the flag is absent', () => {
    // Arrange: default test env has no VITE_PAYMENTS_ENABLED.
    // Act + Assert
    expect(isPaymentsEnabled()).toBe(false)
  })

  it.each(['true', '1', 'on', 'yes', 'TRUE', ' On '])(
    'is ON for truthy value %j',
    (value) => {
      vi.stubEnv('VITE_PAYMENTS_ENABLED', value)
      expect(isPaymentsEnabled()).toBe(true)
    },
  )

  it.each(['false', '0', 'off', 'no', '', '   ', 'enabled?'])(
    'is OFF for non-truthy value %j',
    (value) => {
      vi.stubEnv('VITE_PAYMENTS_ENABLED', value)
      expect(isPaymentsEnabled()).toBe(false)
    },
  )

  it('is sandbox-only in this slice', () => {
    expect(isPaymentsSandbox()).toBe(true)
  })
})
