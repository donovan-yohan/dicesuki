import { createContext, useContext, type MutableRefObject } from 'react'
import type { MotionField } from '../lib/motionField'

/**
 * Ref context - Contains only the stable refs
 * This context NEVER changes, so components subscribing to it never re-render
 */
export interface DeviceMotionRefContext {
  /** Continuous "dice box" field in engine units (U/s²); `[0,0,0]` when still. */
  motionFieldRef: MutableRefObject<MotionField>
  isShakingRef: MutableRefObject<boolean>
}

/**
 * State context - Contains all changing state
 * Components subscribing to this will re-render when state changes
 */
export interface DeviceMotionStateContext {
  isSupported: boolean
  permissionState: 'prompt' | 'granted' | 'denied' | 'unsupported'
  isShaking: boolean
  requestPermission: () => Promise<void>
}

export const DeviceMotionRefContext = createContext<DeviceMotionRefContext | null>(null)
export const DeviceMotionStateContext = createContext<DeviceMotionStateContext | null>(null)

/**
 * Hook to access ONLY the motion refs (for physics)
 * Components using this will NEVER re-render from device motion updates
 */
export function useDeviceMotionRef(): DeviceMotionRefContext {
  const context = useContext(DeviceMotionRefContext)
  if (!context) {
    throw new Error('useDeviceMotionRef must be used within DeviceMotionProvider')
  }
  return context
}

/**
 * Hook to access device motion state (for UI)
 * Components using this will re-render when state changes
 */
export function useDeviceMotionState(): DeviceMotionStateContext {
  const context = useContext(DeviceMotionStateContext)
  if (!context) {
    throw new Error('useDeviceMotionState must be used within DeviceMotionProvider')
  }
  return context
}
