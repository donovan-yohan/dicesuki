import { useDeviceMotionState } from '../contexts/DeviceMotionContext'
import { useUIStore } from '../store/useUIStore'

/**
 * Debug overlay showing real-time device motion data
 * Displays permission state, raw accelerometer values, and calculated gravity vector
 *
 * Subscribes to StateContext - re-renders when state changes (expected for UI)
 * Visibility controlled by useUIStore.showDebugOverlay
 */
export function DebugOverlay() {
  const { isSupported, permissionState, gravityVector, isShaking } = useDeviceMotionState()
  const showDebugOverlay = useUIStore((state) => state.showDebugOverlay)

  if (!showDebugOverlay) {
    return null
  }

  return (
    <div className="absolute bottom-4 left-4 bg-black bg-opacity-90 text-white p-4 rounded-lg text-xs font-mono z-50 max-w-xs">
      <div className="text-green-400 font-bold mb-2">🔍 Device Motion Debug</div>

      <div className="space-y-1">
        <div>
          <span className="text-gray-400">Supported:</span>{' '}
          <span className={isSupported ? 'text-green-400' : 'text-red-400'}>
            {isSupported ? '✓ Yes' : '✗ No'}
          </span>
        </div>

        <div>
          <span className="text-gray-400">Permission:</span>{' '}
          <span className={
            permissionState === 'granted' ? 'text-green-400' :
            permissionState === 'denied' ? 'text-red-400' :
            'text-yellow-400'
          }>
            {permissionState}
          </span>
        </div>

        <div>
          <span className="text-gray-400">Shaking:</span>{' '}
          <span className={isShaking ? 'text-yellow-400' : 'text-gray-500'}>
            {isShaking ? '⚡ Yes' : 'No'}
          </span>
        </div>

        <div className="border-t border-gray-700 mt-2 pt-2">
          <div className="text-blue-400 font-semibold mb-1">Gravity Vector:</div>
          <div className="pl-2 space-y-0.5">
            <div>
              <span className="text-gray-400">X (L/R):</span>{' '}
              <span className="text-white">{gravityVector.x.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-gray-400">Y (Down):</span>{' '}
              <span className="text-white">{gravityVector.y.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-gray-400">Z (F/B):</span>{' '}
              <span className="text-white">{gravityVector.z.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-700 mt-2 pt-2 text-gray-400 text-xs">
          <div>Tilt device to see values change</div>
          {permissionState !== 'granted' && (
            <div className="text-yellow-400 mt-1">
              ⚠️ Grant motion permission first
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
