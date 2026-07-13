import { describe, it, expect, vi, afterEach } from 'vitest'
import { Vector3 } from 'three'
import {
  clampImpulseMagnitude,
  computeShakeImpulse,
  shakeImpulseForFrame,
} from './motionImpulse'
import {
  MOTION_IMPULSE_MAX_MAGNITUDE,
  SHAKE_IMPULSE_VERTICAL,
  SHAKE_IMPULSE_HORIZONTAL_SCALE,
} from '../config/physicsConfig'
import { useMultiplayerStore } from '../store/useMultiplayerStore'

const magnitude = ([x, y, z]: [number, number, number]) => Math.sqrt(x * x + y * y + z * z)

// rng returning 0.5 => jitter term is exactly 0, so impulses are deterministic.
const noJitter = () => 0.5

describe('clampImpulseMagnitude', () => {
  it('leaves a vector within the limit untouched', () => {
    expect(clampImpulseMagnitude([1, 2, 2], 10)).toEqual([1, 2, 2])
  })

  it('scales an over-long vector down to the max, preserving direction', () => {
    const clamped = clampImpulseMagnitude([0, 100, 0], 30)
    expect(clamped).toEqual([0, 30, 0])
  })

  it('never divides by zero for a zero vector', () => {
    expect(clampImpulseMagnitude([0, 0, 0], 30)).toEqual([0, 0, 0])
  })
})

describe('computeShakeImpulse', () => {
  it('produces an upward toss consistent with the single-player shake', () => {
    // Arrange: flat device, pure downward gravity, no jitter.
    const impulse = computeShakeImpulse([0, -9.81, 0], noJitter)

    // Assert: mostly upward, no horizontal energy.
    expect(impulse[0]).toBe(0)
    expect(impulse[1]).toBe(SHAKE_IMPULSE_VERTICAL)
    expect(impulse[2]).toBe(0)
  })

  it('maps the sensor horizontal (tilt/shake) into horizontal impulse', () => {
    // Arrange: shake energy on X and Z from the effective-gravity vector.
    const impulse = computeShakeImpulse([10, -9.81, -6], noJitter)

    // Assert: horizontal scaled from the sensor, direction preserved.
    expect(impulse[0]).toBeCloseTo(10 * SHAKE_IMPULSE_HORIZONTAL_SCALE, 5)
    expect(impulse[2]).toBeCloseTo(-6 * SHAKE_IMPULSE_HORIZONTAL_SCALE, 5)
    expect(impulse[1]).toBe(SHAKE_IMPULSE_VERTICAL)
  })

  it('reads x/z from a THREE.Vector3 as well as a tuple', () => {
    const fromVec = computeShakeImpulse(new Vector3(4, -9.81, 2), noJitter)
    const fromTuple = computeShakeImpulse([4, -9.81, 2], noJitter)
    expect(fromVec).toEqual(fromTuple)
  })

  it('clamps a violent shake to the server-matched max magnitude', () => {
    // Arrange: absurd sensor reading that would exceed the arena.
    const impulse = computeShakeImpulse([500, -9.81, 500], noJitter)

    // Assert: never longer than the server clamp.
    expect(magnitude(impulse)).toBeLessThanOrEqual(MOTION_IMPULSE_MAX_MAGNITUDE + 1e-6)
  })

  it('applies random jitter so stacked dice scatter', () => {
    const a = computeShakeImpulse([0, -9.81, 0], () => 0)
    const b = computeShakeImpulse([0, -9.81, 0], () => 1)
    expect(a[0]).not.toBe(b[0])
    expect(a[2]).not.toBe(b[2])
  })
})

describe('shakeImpulseForFrame', () => {
  const gravity: [number, number, number] = [0, -9.81, 0]

  it('emits an impulse on the rising edge of a shake when motion is enabled', () => {
    const impulse = shakeImpulseForFrame({
      isShaking: true,
      wasShaking: false,
      motionEnabled: true,
      gravity,
      rng: noJitter,
    })
    expect(impulse).not.toBeNull()
    expect(impulse?.[1]).toBe(SHAKE_IMPULSE_VERTICAL)
  })

  it('does not re-fire while a shake is sustained (no rising edge)', () => {
    expect(
      shakeImpulseForFrame({ isShaking: true, wasShaking: true, motionEnabled: true, gravity }),
    ).toBeNull()
  })

  it('emits nothing when not shaking', () => {
    expect(
      shakeImpulseForFrame({ isShaking: false, wasShaking: false, motionEnabled: true, gravity }),
    ).toBeNull()
  })

  it('emits nothing when the local motion opt-in is disabled', () => {
    // Mirrors a phone whose permission was never granted / motion never enabled.
    expect(
      shakeImpulseForFrame({ isShaking: true, wasShaking: false, motionEnabled: false, gravity }),
    ).toBeNull()
  })
})

describe('room shake pipeline (shake -> sendMotionImpulse)', () => {
  afterEach(() => {
    useMultiplayerStore.getState().reset()
    vi.useRealTimers()
  })

  it('sends a motion_impulse when the room policy allows motion', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const send = vi.fn()
    useMultiplayerStore.setState({
      connectionStatus: 'connected',
      socket: { send } as unknown as WebSocket,
      roomSettings: { version: 1, motionControl: 'own_dice' },
    })
    // Clear any prior throttle timestamp from earlier tests.
    vi.advanceTimersByTime(1000)

    const impulse = shakeImpulseForFrame({
      isShaking: true,
      wasShaking: false,
      motionEnabled: true,
      gravity: [2, -9.81, -2],
      rng: noJitter,
    })
    expect(impulse).not.toBeNull()
    useMultiplayerStore.getState().sendMotionImpulse(impulse!)

    expect(send).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(send.mock.calls[0][0])
    expect(payload.type).toBe('motion_impulse')
    expect(payload.impulse[1]).toBe(SHAKE_IMPULSE_VERTICAL)
  })

  it('sends nothing when the room policy is off', () => {
    const send = vi.fn()
    useMultiplayerStore.setState({
      connectionStatus: 'connected',
      socket: { send } as unknown as WebSocket,
      roomSettings: { version: 1, motionControl: 'off' },
    })

    const impulse = computeShakeImpulse([2, -9.81, -2], noJitter)
    useMultiplayerStore.getState().sendMotionImpulse(impulse)

    expect(send).not.toHaveBeenCalled()
  })
})
