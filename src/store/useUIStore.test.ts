import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './useUIStore'

describe('useUIStore view rotation', () => {
  beforeEach(() => {
    localStorage.clear()
    useUIStore.setState({ viewRotation: 0 })
  })

  it('rotateViewCW cycles 0→90→180→270→0 and persists each step', () => {
    const store = useUIStore.getState()
    store.rotateViewCW()
    expect(useUIStore.getState().viewRotation).toBe(90)
    expect(localStorage.getItem('viewRotation')).toBe('90')

    store.rotateViewCW()
    store.rotateViewCW()
    expect(useUIStore.getState().viewRotation).toBe(270)

    store.rotateViewCW()
    expect(useUIStore.getState().viewRotation).toBe(0)
    expect(localStorage.getItem('viewRotation')).toBe('0')
  })

  it('rotateViewCCW goes the other way and persists', () => {
    useUIStore.getState().rotateViewCCW()
    expect(useUIStore.getState().viewRotation).toBe(270)
    expect(localStorage.getItem('viewRotation')).toBe('270')
  })
})
