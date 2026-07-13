import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useTheme } from '../../contexts/ThemeContext'
import { shouldReduceMotion } from '../../animations/ui-transitions'
import { connectionIndicator } from './connectionIndicator'
import { RoomShare } from './RoomShare'
import {
  getMotionControl,
  getRoller,
  getRoomThemeId,
  getRoomName,
  isRoomPublic,
  ROOM_NAME_MAX_LEN,
} from '../../lib/multiplayerMessages'
import { RoomThemePicker } from './RoomThemePicker'
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
  const setRoller = useMultiplayerStore((s) => s.setRoller)
  const setRoomTheme = useMultiplayerStore((s) => s.setRoomTheme)
  const setVisibility = useMultiplayerStore((s) => s.setVisibility)
  const setRoomName = useMultiplayerStore((s) => s.setRoomName)
  const reduceMotion = shouldReduceMotion()
  const { currentTheme } = useTheme()
  const colors = currentTheme.tokens.colors
  const motionControl = getMotionControl(roomSettings)
  const rollerId = getRoller(roomSettings)
  const roomThemeId = getRoomThemeId(roomSettings)
  const roomIsPublic = isRoomPublic(roomSettings)
  const roomName = getRoomName(roomSettings)

  // Local draft for the room-name input so we only push an update_settings on
  // commit (blur/Enter), not on every keystroke. Re-seed when the authoritative
  // name changes (e.g. another host action or reconnect).
  const [nameDraft, setNameDraft] = useState(roomName ?? '')
  useEffect(() => {
    setNameDraft(roomName ?? '')
  }, [roomName])

  const commitRoomName = () => {
    if ((roomName ?? '') !== nameDraft.trim()) {
      setRoomName(nameDraft)
    }
  }

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

          {/* Share controls: copy link, native share, QR (issue #77) */}
          <RoomShare />

          {/* Roster rows */}
          <div className="flex flex-col gap-1 p-2 overflow-y-auto">
            {playersArray.map((player) => {
              const isLocal = player.id === localPlayerId
              const isHostPlayer = player.id === hostId
              const isSelected = player.id === selectedPlayerId
              const indicator = connectionIndicator(
                isLocal ? connectionStatus : 'connected',
              )

              const isRollerPlayer = player.id === rollerId

              return (
                <div key={player.id} className="flex items-center gap-1">
                <button
                  onClick={() => setSelectedPlayerId(player.id)}
                  className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left"
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
                    {isRollerPlayer && (
                      <span
                        title="Rolling for the table"
                        aria-label="Rolling for the table"
                        role="img"
                      >
                        🎲
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
                {isHost && (
                  <button
                    type="button"
                    onClick={() => setRoller(isRollerPlayer ? null : player.id)}
                    title={
                      isRollerPlayer
                        ? 'Revoke roller'
                        : `Give ${player.displayName} the dice`
                    }
                    aria-label={
                      isRollerPlayer
                        ? `Revoke roller from ${player.displayName}`
                        : `Make ${player.displayName} the roller`
                    }
                    aria-pressed={isRollerPlayer}
                    data-testid={`roller-toggle-${player.id}`}
                    className="flex items-center justify-center rounded-md"
                    style={{
                      width: '28px',
                      height: '28px',
                      flexShrink: 0,
                      fontSize: '13px',
                      cursor: 'pointer',
                      backgroundColor: isRollerPlayer
                        ? 'rgba(139, 92, 246, 0.55)'
                        : 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      opacity: isRollerPlayer ? 1 : 0.75,
                    }}
                  >
                    🎲
                  </button>
                )}
                </div>
              )
            })}
          </div>

          {/* Room visibility: host opts the room into the public browser (#79).
              Everyone sees the current state; only the host can change it. */}
          <div
            className="flex flex-col gap-1.5 px-3 py-2.5"
            style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
            data-testid="room-visibility"
          >
            <div className="flex items-center justify-between">
              <span
                className="text-xs font-semibold uppercase"
                style={{ letterSpacing: '0.06em', color: colors.text.secondary }}
              >
                Discovery
              </span>
              {!isHost && (
                <span className="text-xs" style={{ color: colors.text.muted }}>
                  Host controls
                </span>
              )}
            </div>

            <div
              role="radiogroup"
              aria-label="Room visibility"
              className="flex rounded-lg overflow-hidden"
              style={{ border: '1px solid rgba(255,255,255,0.12)' }}
            >
              {(['unlisted', 'public'] as const).map((mode, index) => {
                const isActive = mode === (roomIsPublic ? 'public' : 'unlisted')
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    disabled={!isHost}
                    onClick={() => isHost && setVisibility(mode)}
                    data-testid={`visibility-${mode}`}
                    className="flex-1 px-1.5 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      backgroundColor: isActive ? 'rgba(139, 92, 246, 0.55)' : 'transparent',
                      color: isActive ? '#fff' : colors.text.secondary,
                      cursor: isHost ? 'pointer' : 'default',
                      opacity: !isHost && !isActive ? 0.5 : 1,
                      borderLeft: index > 0 ? '1px solid rgba(255,255,255,0.12)' : 'none',
                    }}
                  >
                    {mode === 'public' ? 'Public' : 'Unlisted'}
                  </button>
                )
              })}
            </div>

            <span className="text-xs" style={{ color: colors.text.muted, lineHeight: 1.35 }}>
              {roomIsPublic
                ? 'Anyone can find and join this room from the browser.'
                : 'Only people with the code can join. Hidden from the browser.'}
            </span>

            {/* Room name — shown in the public browser. Editable by the host once
                the room is public. */}
            {roomIsPublic && (
              isHost ? (
                <input
                  type="text"
                  value={nameDraft}
                  maxLength={ROOM_NAME_MAX_LEN}
                  placeholder="Name this room"
                  aria-label="Public room name"
                  data-testid="room-name-input"
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitRoomName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur()
                    }
                  }}
                  className="mt-1 w-full rounded-md px-2 py-1.5 text-sm"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: colors.text.primary,
                  }}
                />
              ) : (
                roomName && (
                  <span className="mt-1 text-sm" style={{ color: colors.text.primary }}>
                    {roomName}
                  </span>
                )
              )
            )}
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

          {/* Room theme: host picks the shared environment/tray look everyone
              sees; each player's personal dice skins stay their own (#75). */}
          <div
            className="flex flex-col gap-1.5 px-3 py-2.5"
            style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
            data-testid="room-theme-control"
          >
            <div className="flex items-center justify-between">
              <span
                className="text-xs font-semibold uppercase"
                style={{ letterSpacing: '0.06em', color: colors.text.secondary }}
              >
                Room Theme
              </span>
              {!isHost && (
                <span className="text-xs" style={{ color: colors.text.muted }}>
                  Host controls
                </span>
              )}
            </div>

            <RoomThemePicker
              value={roomThemeId}
              onChange={(themeId) => {
                if (!isHost) return
                setRoomTheme(themeId)
              }}
              disabled={!isHost}
              label="Room theme"
            />

            <span className="text-xs" style={{ color: colors.text.muted, lineHeight: 1.35 }}>
              Sets the shared table look. Your dice skins stay your own.
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
