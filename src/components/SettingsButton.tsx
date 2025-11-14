import { useUIStore } from '../store/useUIStore'

/**
 * Settings button with toggles for debug overlay and motion mode
 *
 * Positioned in bottom-right corner
 * Toggles:
 * - Debug Overlay: Show/hide device motion debug information
 * - Motion Mode: Enable continuous rolling from device motion
 */
export function SettingsButton() {
  const { showDebugOverlay, toggleDebugOverlay, motionMode, toggleMotionMode } = useUIStore()

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

      {/* Motion Mode Toggle */}
      <button
        onClick={toggleMotionMode}
        className={`px-4 py-2 rounded-lg shadow-lg transition-all text-sm font-medium ${
          motionMode
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-gray-800 bg-opacity-90 hover:bg-opacity-100 text-white'
        }`}
        title="Toggle continuous motion rolling"
      >
        {motionMode ? '🎲 Motion ON' : '🎲 Motion OFF'}
      </button>
    </div>
  )
}
