import { createContext, useContext, ReactNode, useMemo } from 'react'
import * as THREE from 'three'
import { useDeviceMotion } from '../hooks/useDeviceMotion'

/**
 * Ref context - Contains only the stable refs
 * This context NEVER changes, so components subscribing to it never re-render
 */
interface DeviceMotionRefContext {
  gravityRef: React.MutableRefObject<THREE.Vector3>
  isShakingRef: React.MutableRefObject<boolean>
}

/**
 * State context - Contains all changing state
 * Components subscribing to this will re-render when state changes
 */
interface DeviceMotionStateContext {
  isSupported: boolean
  permissionState: 'prompt' | 'granted' | 'denied' | 'unsupported'
  isShaking: boolean
  gravityVector: THREE.Vector3
  requestPermission: () => Promise<void>
}

const RefContext = createContext<DeviceMotionRefContext | null>(null)
const StateContext = createContext<DeviceMotionStateContext | null>(null)

/**
 * Provider that creates a single useDeviceMotion instance
 * Splits the result into two contexts to prevent unnecessary re-renders
 */
export function DeviceMotionProvider({ children }: { children: ReactNode }) {
  const deviceMotion = useDeviceMotion()

  // Ref context value - STABLE, never changes reference
  // Empty dependency array ensures this object is created once and frozen forever
  const refValue = useMemo<DeviceMotionRefContext>(() => ({
    gravityRef: deviceMotion.gravityRef,
    isShakingRef: deviceMotion.isShakingRef
  }), []) // Empty deps - refs are stable

  // State context value - changes when any state property changes
  const stateValue = useMemo<DeviceMotionStateContext>(() => ({
    isSupported: deviceMotion.isSupported,
    permissionState: deviceMotion.permissionState,
    isShaking: deviceMotion.isShaking,
    gravityVector: deviceMotion.gravityVector,
    requestPermission: deviceMotion.requestPermission
  }), [
    deviceMotion.isSupported,
    deviceMotion.permissionState,
    deviceMotion.isShaking,
    deviceMotion.gravityVector,
    deviceMotion.requestPermission
  ])

  return (
    <RefContext.Provider value={refValue}>
      <StateContext.Provider value={stateValue}>
        {children}
      </StateContext.Provider>
    </RefContext.Provider>
  )
}

/**
 * Hook to access ONLY the gravityRef (for physics)
 * Components using this will NEVER re-render from device motion updates
 */
export function useDeviceMotionRef(): DeviceMotionRefContext {
  const context = useContext(RefContext)
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
  const context = useContext(StateContext)
  if (!context) {
    throw new Error('useDeviceMotionState must be used within DeviceMotionProvider')
  }
  return context
}
