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
    motionFieldRef: deviceMotion.motionFieldRef,
    isShakingRef: deviceMotion.isShakingRef,
  }), [deviceMotion.motionFieldRef, deviceMotion.isShakingRef])

  const stateValue = useMemo<DeviceMotionStateContextValue>(() => ({
    isSupported: deviceMotion.isSupported,
    permissionState: deviceMotion.permissionState,
    orientationPermissionState: deviceMotion.orientationPermissionState,
    isShaking: deviceMotion.isShaking,
    requestPermission: deviceMotion.requestPermission,
  }), [
    deviceMotion.isSupported,
    deviceMotion.permissionState,
    deviceMotion.orientationPermissionState,
    deviceMotion.isShaking,
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
