import { useDeviceMotion } from '../hooks/useDeviceMotion'

/**
 * Device Motion Permission Button
 *
 * Displays a button to request device motion permission (required for iOS)
 * Shows current permission state and shake indicator
 *
 * States:
 * - prompt: Show "Enable Motion" button
 * - granted: Show "Motion Enabled" with shake indicator
 * - denied: Show "Motion Blocked" with help text
 * - unsupported: Hidden (no device motion support)
 */
export function DeviceMotionButton() {
  const { isSupported, permissionState, isShaking, requestPermission } = useDeviceMotion()

  // Don't render on unsupported devices
  if (!isSupported || permissionState === 'unsupported') {
    return null
  }

  const handleClick = () => {
    requestPermission()
  }

  // Permission prompt state
  if (permissionState === 'prompt') {
    return (
      <button
        onClick={handleClick}
        className="fixed bottom-4 left-4 z-20 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow-lg transition-colors"
      >
        📱 Enable Motion
      </button>
    )
  }

  // Permission granted state
  if (permissionState === 'granted') {
    return (
      <button
        className={`fixed bottom-4 left-4 z-20 px-4 py-2 rounded-lg shadow-lg transition-all ${
          isShaking
            ? 'bg-green-600 text-white scale-110'
            : 'bg-green-500 text-white'
        }`}
      >
        {isShaking ? '🎲 Shaking!' : '✓ Motion Enabled'}
      </button>
    )
  }

  // Permission denied state
  if (permissionState === 'denied') {
    return (
      <div className="fixed bottom-4 left-4 z-20 bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg max-w-xs">
        <div className="font-bold">❌ Motion Blocked</div>
        <div className="text-sm mt-1">Enable in Settings → Safari → Motion & Orientation</div>
      </div>
    )
  }

  return null
}
