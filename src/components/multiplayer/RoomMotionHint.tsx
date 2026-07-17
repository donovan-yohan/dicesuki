import { useDeviceMotionState } from '../../contexts/DeviceMotionContext'
import { getMotionControl } from '../../lib/multiplayerMessages'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useUIStore } from '../../store/useUIStore'

/**
 * In-room hint explaining why tilt/shake is (or isn't) doing anything, so motion is
 * never silently dead. Rendered only in the multiplayer/room branch of the Scene
 * and only once the local player has opted into motion (the Bottom Nav motion
 * toggle, which also runs the iOS permission flow).
 *
 * Surfaces, in priority order:
 * - the room policy being `off` (host disabled motion for everyone),
 * - device-motion permission being blocked (`denied` — needs OS Settings),
 * - permission not yet granted (`prompt` — tap the motion toggle).
 *
 * When permission is granted and the policy allows motion, no hint is shown —
 * tilting and shaking just work. Reuses the muted read-only hint styling from PlayerPanel.
 */
export function RoomMotionHint() {
  const { isSupported, permissionState } = useDeviceMotionState()
  const motionMode = useUIStore((s) => s.motionMode)
  const roomSettings = useMultiplayerStore((s) => s.roomSettings)
  const motionControl = getMotionControl(roomSettings)

  // Nothing to say on devices without a motion sensor, or before the player
  // opts into motion via the Bottom Nav toggle.
  if (!isSupported || permissionState === 'unsupported') return null
  if (!motionMode) return null

  let message: string | null = null
  let tone: 'muted' | 'warning' = 'muted'

  if (motionControl === 'off') {
    message = 'Tilt and shake controls are off for this room'
  } else if (permissionState === 'denied') {
    message = 'Motion blocked — enable it in your device Settings'
    tone = 'warning'
  } else if (permissionState === 'prompt') {
    message = 'Tap the motion button to enable tilt and shake controls'
  }

  if (!message) return null

  const palette = tone === 'warning'
    ? { border: 'rgba(248, 113, 113, 0.45)', bg: 'rgba(127, 29, 29, 0.45)', color: '#fecaca' }
    : { border: 'rgba(255,255,255,0.14)', bg: 'rgba(31, 41, 55, 0.72)', color: 'rgba(226,232,240,0.85)' }

  return (
    <div
      data-testid="room-motion-hint"
      role="status"
      className="fixed left-1/2 z-40 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs font-medium"
      style={{
        bottom: '76px',
        border: `1px solid ${palette.border}`,
        backgroundColor: palette.bg,
        color: palette.color,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        maxWidth: 'calc(100vw - 2rem)',
        textAlign: 'center',
        pointerEvents: 'none',
      }}
    >
      {message}
    </div>
  )
}
