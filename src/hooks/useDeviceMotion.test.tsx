import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config/engineConfig', () => ({
  getEngineConfig: () => ({ gravity: -240 }),
}))

import { useDeviceMotion } from './useDeviceMotion'

const sensorGlobal = globalThis as unknown as {
  DeviceMotionEvent: typeof DeviceMotionEvent | undefined
  DeviceOrientationEvent: typeof DeviceOrientationEvent | undefined
}
const originalMotionEvent = sensorGlobal.DeviceMotionEvent
const originalOrientationEvent = sensorGlobal.DeviceOrientationEvent

class MockDeviceMotionEvent extends Event {
  acceleration: DeviceMotionEventAcceleration | null
  accelerationIncludingGravity: DeviceMotionEventAcceleration | null
  interval = 16
  rotationRate = null

  constructor(
    acceleration: DeviceMotionEventAcceleration | null,
    accelerationIncludingGravity: DeviceMotionEventAcceleration | null = null,
  ) {
    super('devicemotion')
    this.acceleration = acceleration
    this.accelerationIncludingGravity = accelerationIncludingGravity
  }
}

class MockDeviceOrientationEvent extends Event {
  absolute = false
  alpha = 0
  beta: number | null
  gamma: number | null

  constructor(beta: number | null, gamma: number | null) {
    super('deviceorientation')
    this.beta = beta
    this.gamma = gamma
  }
}

describe('useDeviceMotion', () => {
  beforeEach(() => {
    sensorGlobal.DeviceMotionEvent = MockDeviceMotionEvent as unknown as typeof DeviceMotionEvent
    sensorGlobal.DeviceOrientationEvent = MockDeviceOrientationEvent as unknown as typeof DeviceOrientationEvent
  })

  afterEach(() => {
    delete (MockDeviceMotionEvent as unknown as { requestPermission?: unknown }).requestPermission
    delete (MockDeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission
    sensorGlobal.DeviceMotionEvent = originalMotionEvent
    sensorGlobal.DeviceOrientationEvent = originalOrientationEvent
    vi.restoreAllMocks()
  })

  it('combines fused-orientation tilt with gentle linear acceleration', async () => {
    const { result } = renderHook(() => useDeviceMotion())

    await act(async () => result.current.requestPermission())
    await waitFor(() => expect(result.current.permissionState).toBe('granted'))

    act(() => {
      window.dispatchEvent(new MockDeviceOrientationEvent(30, 0))
    })
    const tiltOnly = [...result.current.motionFieldRef.current]
    expect(tiltOnly[0]).toBeCloseTo(0, 8)
    expect(tiltOnly[1]).toBeGreaterThan(0)
    expect(tiltOnly[2]).toBeCloseTo(120, 8)

    act(() => {
      window.dispatchEvent(new MockDeviceMotionEvent({ x: 0.5, y: 0, z: 0 }))
    })
    expect(result.current.motionFieldRef.current[0]).toBeCloseTo(-20, 8)
    expect(result.current.motionFieldRef.current[1]).toBeCloseTo(tiltOnly[1], 8)
    expect(result.current.motionFieldRef.current[2]).toBeCloseTo(tiltOnly[2], 8)
  })

  it('retains acceleration control when orientation permission is denied', async () => {
    Object.assign(MockDeviceMotionEvent, {
      requestPermission: vi.fn(async () => 'granted' as const),
    })
    Object.assign(MockDeviceOrientationEvent, {
      requestPermission: vi.fn(async () => 'denied' as const),
    })
    const { result } = renderHook(() => useDeviceMotion())

    await act(async () => result.current.requestPermission())
    expect(result.current.permissionState).toBe('granted')
    expect(result.current.orientationPermissionState).toBe('denied')

    act(() => {
      window.dispatchEvent(new MockDeviceMotionEvent({ x: 0.5, y: 0, z: 0 }))
    })
    expect(result.current.motionFieldRef.current).toEqual([-20, 0, 0])
  })
})
