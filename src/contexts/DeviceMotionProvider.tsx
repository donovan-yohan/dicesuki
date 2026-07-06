import { type ReactNode, useMemo } from 'react'
import { useDeviceMotion } from '../hooks/useDeviceMotion'
import {
  DeviceMotionRefContext,
  DeviceMotionStateContext,
  type DeviceMotionRefContext as DeviceMotionRefContextValue,
  type DeviceMotionStateContext as DeviceMotionStateContextValue,
} from './DeviceMotionContext'

/**
 * Provider that creates a single useDeviceMotion instance.
 * Splits refs from state to prevent unnecessary re-renders.
 */
export function DeviceMotionProvider({ children }: { children: ReactNode }) {
  const deviceMotion = useDeviceMotion()

  const refValue = useMemo<DeviceMotionRefContextValue>(() => ({
    gravityRef: deviceMotion.gravityRef,
    isShakingRef: deviceMotion.isShakingRef,
  }), [deviceMotion.gravityRef, deviceMotion.isShakingRef])

  const stateValue = useMemo<DeviceMotionStateContextValue>(() => ({
    isSupported: deviceMotion.isSupported,
    permissionState: deviceMotion.permissionState,
    isShaking: deviceMotion.isShaking,
    gravityVector: deviceMotion.gravityVector,
    requestPermission: deviceMotion.requestPermission,
  }), [
    deviceMotion.isSupported,
    deviceMotion.permissionState,
    deviceMotion.isShaking,
    deviceMotion.gravityVector,
    deviceMotion.requestPermission,
  ])

  return (
    <DeviceMotionRefContext.Provider value={refValue}>
      <DeviceMotionStateContext.Provider value={stateValue}>
        {children}
      </DeviceMotionStateContext.Provider>
    </DeviceMotionRefContext.Provider>
  )
}
