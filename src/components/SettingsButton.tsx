import { useUIStore } from '../store/useUIStore'
import { useDeviceMotionState } from '../contexts/DeviceMotionContext'

/**
 * Settings button with toggles for debug overlay and motion mode
 *
 * Positioned in bottom-right corner
 * Toggles:
 * - Debug Overlay: Show/hide device motion debug information
 * - Motion Mode: Enable continuous rolling from device motion (requests permission if needed)
 */
export function SettingsButton() {
  const { showDebugOverlay, toggleDebugOverlay, motionMode, toggleMotionMode } = useUIStore()
  const { permissionState, requestPermission } = useDeviceMotionState()

  const handleMotionToggle = async () => {
    // If permission not granted yet, request it first
    if (permissionState === 'prompt') {
      await requestPermission()
    }
    // Toggle motion mode (will only have effect if permission is granted)
    if (permissionState === 'granted' || permissionState === 'prompt') {
      toggleMotionMode()
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {/* Debug Overlay Toggle */}
      <button
        onClick={toggleDebugOverlay}
        className="bg-gray-800 bg-opacity-90 hover:bg-opacity-100 text-white px-4 py-2 rounded-lg shadow-lg transition-all text-sm font-medium"
        title="Toggle debug overlay"
      >
        {showDebugOverlay ? '👁️ Debug' : '👁️‍🗨️ Debug'}
      </button>

      {/* Motion Mode Toggle - with integrated permission request */}
      <button
        onClick={handleMotionToggle}
        className={`px-4 py-2 rounded-lg shadow-lg transition-all text-sm font-medium ${
          motionMode
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : permissionState === 'prompt'
            ? 'bg-blue-600 hover:bg-blue-700 text-white'
            : permissionState === 'denied'
            ? 'bg-red-600 opacity-50 cursor-not-allowed text-white'
            : 'bg-gray-800 bg-opacity-90 hover:bg-opacity-100 text-white'
        }`}
        title={
          permissionState === 'prompt'
            ? 'Enable device motion'
            : permissionState === 'denied'
            ? 'Motion permission denied'
            : 'Toggle continuous motion rolling'
        }
        disabled={permissionState === 'denied'}
      >
        {permissionState === 'prompt'
          ? '📱 Enable Motion'
          : permissionState === 'denied'
          ? '❌ Motion Blocked'
          : motionMode
          ? '🎲 Motion ON'
          : '🎲 Motion OFF'}
      </button>
    </div>
  )
}
