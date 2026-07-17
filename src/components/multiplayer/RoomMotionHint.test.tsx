import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { DeviceMotionStateContext } from '../../contexts/DeviceMotionContext'

// Mock the DeviceMotion browser API at the module level (Frontend-ADR-004) so we
// can drive permission/support state without real sensors or the provider.
let motionState: DeviceMotionStateContext
vi.mock('../../contexts/DeviceMotionContext', () => ({
  useDeviceMotionState: () => motionState,
}))

import { RoomMotionHint } from './RoomMotionHint'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useUIStore } from '../../store/useUIStore'
import type { MotionControl } from '../../lib/multiplayerMessages'

const makeMotionState = (
  over: Partial<DeviceMotionStateContext> = {},
): DeviceMotionStateContext => ({
  isSupported: true,
  permissionState: 'granted',
  orientationPermissionState: 'granted',
  isShaking: false,
  requestPermission: vi.fn(async () => {}),
  ...over,
})

function arrange(opts: {
  motionMode: boolean
  policy: MotionControl
  motion?: Partial<DeviceMotionStateContext>
}) {
  motionState = makeMotionState(opts.motion)
  useUIStore.setState({ motionMode: opts.motionMode })
  useMultiplayerStore.setState({
    roomSettings: { version: 1, motionControl: opts.policy },
  })
}

describe('RoomMotionHint', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
    useUIStore.setState({ motionMode: false })
  })

  afterEach(() => {
    useMultiplayerStore.getState().reset()
    useUIStore.setState({ motionMode: false })
  })

  it('renders nothing until the player opts into motion', () => {
    arrange({ motionMode: false, policy: 'own_dice' })
    render(<RoomMotionHint />)
    expect(screen.queryByTestId('room-motion-hint')).not.toBeInTheDocument()
  })

  it('tells the player when the host has motion turned off for the room', () => {
    arrange({ motionMode: true, policy: 'off' })
    render(<RoomMotionHint />)
    expect(screen.getByTestId('room-motion-hint')).toHaveTextContent(/off for this room/i)
  })

  it('surfaces a blocked device-motion permission', () => {
    arrange({ motionMode: true, policy: 'own_dice', motion: { permissionState: 'denied' } })
    render(<RoomMotionHint />)
    expect(screen.getByTestId('room-motion-hint')).toHaveTextContent(/blocked/i)
  })

  it('points the player at the motion button when permission is not yet granted', () => {
    arrange({ motionMode: true, policy: 'own_dice', motion: { permissionState: 'prompt' } })
    render(<RoomMotionHint />)
    expect(screen.getByTestId('room-motion-hint')).toHaveTextContent(/motion button/i)
  })

  it('stays silent when motion is granted and the policy allows it', () => {
    arrange({ motionMode: true, policy: 'room', motion: { permissionState: 'granted' } })
    render(<RoomMotionHint />)
    expect(screen.queryByTestId('room-motion-hint')).not.toBeInTheDocument()
  })

  it('warns when tilt is blocked but shake remains granted', () => {
    arrange({
      motionMode: true,
      policy: 'own_dice',
      motion: { permissionState: 'granted', orientationPermissionState: 'denied' },
    })
    render(<RoomMotionHint />)
    expect(screen.getByTestId('room-motion-hint')).toHaveTextContent(/tilt blocked/i)
    expect(screen.getByTestId('room-motion-hint')).toHaveTextContent(/shake still works/i)
  })

  it('renders nothing on devices without a motion sensor', () => {
    arrange({
      motionMode: true,
      policy: 'off',
      motion: { isSupported: false, permissionState: 'unsupported' },
    })
    render(<RoomMotionHint />)
    expect(screen.queryByTestId('room-motion-hint')).not.toBeInTheDocument()
  })
})
