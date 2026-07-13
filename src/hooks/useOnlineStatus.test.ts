import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOnlineStatus } from './useOnlineStatus'

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value,
  })
}

describe('useOnlineStatus', () => {
  afterEach(() => {
    setOnLine(true)
    vi.restoreAllMocks()
  })

  it('reports online when navigator.onLine is true', () => {
    // Arrange
    setOnLine(true)
    // Act
    const { result } = renderHook(() => useOnlineStatus())
    // Assert
    expect(result.current).toBe(true)
  })

  it('reports offline when navigator.onLine is false', () => {
    // Arrange
    setOnLine(false)
    // Act
    const { result } = renderHook(() => useOnlineStatus())
    // Assert
    expect(result.current).toBe(false)
  })

  it('updates when the browser fires online/offline events', () => {
    // Arrange
    setOnLine(true)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)

    // Act — go offline
    act(() => {
      setOnLine(false)
      window.dispatchEvent(new Event('offline'))
    })
    // Assert
    expect(result.current).toBe(false)

    // Act — come back online
    act(() => {
      setOnLine(true)
      window.dispatchEvent(new Event('online'))
    })
    // Assert
    expect(result.current).toBe(true)
  })
})
