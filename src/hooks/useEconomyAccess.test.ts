import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useEconomyAccess } from './useEconomyAccess'
import { useAuthStore, type AuthStatus } from '../store/useAuthStore'

function setAuth(status: AuthStatus, economyAccess: boolean) {
  useAuthStore.setState({
    status,
    isConfigured: true,
    user: null,
    profile: null,
    economyAccess,
  })
}

describe('useEconomyAccess', () => {
  beforeEach(() => {
    setAuth('guest', false)
  })

  it('is false for a guest even if a stale flag survives in the store', () => {
    setAuth('guest', true)
    expect(renderHook(() => useEconomyAccess()).result.current).toBe(false)
  })

  it('is false while auth is still loading', () => {
    setAuth('loading', true)
    expect(renderHook(() => useEconomyAccess()).result.current).toBe(false)
  })

  it('is false for an authenticated account that has not been flagged on', () => {
    setAuth('authenticated', false)
    expect(renderHook(() => useEconomyAccess()).result.current).toBe(false)
  })

  it('is true only for an authenticated, flagged account', () => {
    setAuth('authenticated', true)
    expect(renderHook(() => useEconomyAccess()).result.current).toBe(true)
  })

  it('re-renders when the flag flips', () => {
    setAuth('authenticated', false)
    const { result, rerender } = renderHook(() => useEconomyAccess())
    expect(result.current).toBe(false)

    setAuth('authenticated', true)
    rerender()
    expect(result.current).toBe(true)
  })
})
