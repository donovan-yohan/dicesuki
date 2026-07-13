import { motion, AnimatePresence } from 'framer-motion'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useTheme } from '../../contexts/ThemeContext'
import { shouldReduceMotion } from '../../animations/ui-transitions'
import { connectionIndicator } from './connectionIndicator'
import { getMotionControl } from '../../lib/multiplayerMessages'
import {
  MOTION_CONTROL_LABELS,
  MOTION_CONTROL_DESCRIPTIONS,
  MOTION_CONTROL_OPTIONS,
} from '../../hooks/useRoomMotionNotices'

interface PlayerPanelProps {
  isOpen: boolean
}

export function PlayerPanel({ isOpen }: PlayerPanelProps) {
  const players = useMultiplayerStore((s) => s.players)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const hostId = useMultiplayerStore((s) => s.hostId)
  const connectionStatus = useMultiplayerStore((s) => s.connectionStatus)
  const selectedPlayerId = useMultiplayerStore((s) => s.selectedPlayerId)
  const setSelectedPlayerId = useMultiplayerStore((s) => s.setSelectedPlayerId)
  const roomId = useMultiplayerStore((s) => s.roomId)
  const isHost = useMultiplayerStore((s) => s.isHost)
  const roomSettings = useMultiplayerStore((s) => s.roomSettings)
  const setMotionControl = useMultiplayerStore((s) => s.setMotionControl)
  const reduceMotion = shouldReduceMotion()
  const { currentTheme } = useTheme()
  const colors = currentTheme.tokens.colors
  const motionControl = getMotionControl(roomSettings)

  // Host first, then the rest in join order.
  const playersArray = Array.from(players.values()).sort((a, b) => {
    if (a.id === hostId) return -1
    if (b.id === hostId) return 1
    return 0
  })

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed z-30 flex flex-col rounded-xl overflow-hidden"
          style={{
            top: '208px',
            right: '16px',
            width: '232px',
            maxHeight: '60vh',
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
          initial={!reduceMotion ? { x: 100, opacity: 0 } : { opacity: 0 }}
          animate={!reduceMotion ? { x: 0, opacity: 1 } : { opacity: 1 }}
          exit={!reduceMotion ? { x: 100, opacity: 0 } : { opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          data-testid="player-roster"
        >
          {/* Header: room id + player count */}
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              color: colors.text.secondary,
            }}
          >
            <span className="text-xs font-mono" style={{ letterSpacing: '0.05em' }}>
              {roomId}
            </span>
            <span className="text-xs">{playersArray.length}/8</span>
          </div>

          {/* Roster rows */}
          <div className="flex flex-col gap-1 p-2 overflow-y-auto">
            {playersArray.map((player) => {
              const isLocal = player.id === localPlayerId
              const isHostPlayer = player.id === hostId
              const isSelected = player.id === selectedPlayerId
              const indicator = connectionIndicator(
                isLocal ? connectionStatus : 'connected',
              )

              return (
                <button
                  key={player.id}
                  onClick={() => setSelectedPlayerId(player.id)}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left w-full"
                  style={{
                    backgroundColor: isSelected
                      ? 'rgba(255,255,255,0.14)'
                      : 'transparent',
                    border: isSelected
                      ? '1px solid rgba(255,255,255,0.35)'
                      : '1px solid transparent',
                    cursor: 'pointer',
                    color: colors.text.primary,
                  }}
                  title={`Filter by ${player.displayName}`}
                  aria-label={`Filter by ${player.displayName}${isHostPlayer ? ', host' : ''}${isLocal ? ' (you)' : ''}`}
                  aria-pressed={isSelected}
                >
                  {/* Color avatar */}
                  <span
                    className="flex items-center justify-center rounded-full font-bold text-xs"
                    style={{
                      width: '28px',
                      height: '28px',
                      flexShrink: 0,
                      backgroundColor: player.color,
                      color: 'white',
                      textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                      border: isLocal
                        ? '2px solid rgba(255,255,255,0.7)'
                        : '2px solid transparent',
                    }}
                  >
                    {player.displayName.charAt(0).toUpperCase()}
                  </span>

                  {/* Name + tags */}
                  <span className="flex-1 min-w-0 flex items-center gap-1">
                    <span className="truncate text-sm">{player.displayName}</span>
                    {isLocal && (
                      <span
                        className="text-xs"
                        style={{ color: colors.text.muted }}
                      >
                        (You)
                      </span>
                    )}
                    {isHostPlayer && (
                      <span title="Host" aria-label="Host" role="img">
                        👑
                      </span>
                    )}
                  </span>

                  {/* Connection state */}
                  <span
                    title={indicator.label}
                    aria-label={indicator.label}
                    role="img"
                    style={{
                      width: '9px',
                      height: '9px',
                      borderRadius: '50%',
                      flexShrink: 0,
                      backgroundColor: indicator.color,
                      boxShadow: `0 0 6px ${indicator.color}`,
                    }}
                  />
                </button>
              )
            })}
          </div>

          {/* Motion control: host sets the room's device-motion policy; everyone
              sees the current mode (read-only for non-hosts). */}
          <div
            className="flex flex-col gap-1.5 px-3 py-2.5"
            style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
            data-testid="motion-control"
          >
            <div className="flex items-center justify-between">
              <span
                className="text-xs font-semibold uppercase"
                style={{ letterSpacing: '0.06em', color: colors.text.secondary }}
              >
                Motion
              </span>
              {!isHost && (
                <span className="text-xs" style={{ color: colors.text.muted }}>
                  Host controls
                </span>
              )}
            </div>

            <div
              role="radiogroup"
              aria-label="Room motion mode"
              className="flex rounded-lg overflow-hidden"
              style={{ border: '1px solid rgba(255,255,255,0.12)' }}
            >
              {MOTION_CONTROL_OPTIONS.map((mode) => {
                const isActive = mode === motionControl
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    disabled={!isHost}
                    onClick={() => isHost && setMotionControl(mode)}
                    title={MOTION_CONTROL_DESCRIPTIONS[mode]}
                    className="flex-1 px-1.5 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      backgroundColor: isActive
                        ? 'rgba(139, 92, 246, 0.55)'
                        : 'transparent',
                      color: isActive ? '#fff' : colors.text.secondary,
                      cursor: isHost ? 'pointer' : 'default',
                      opacity: !isHost && !isActive ? 0.5 : 1,
                      borderLeft: mode !== MOTION_CONTROL_OPTIONS[0]
                        ? '1px solid rgba(255,255,255,0.12)'
                        : 'none',
                    }}
                  >
                    {MOTION_CONTROL_LABELS[mode]}
                  </button>
                )
              })}
            </div>

            <span className="text-xs" style={{ color: colors.text.muted, lineHeight: 1.35 }}>
              {MOTION_CONTROL_DESCRIPTIONS[motionControl]}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
