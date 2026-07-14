import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useTheme } from '../../contexts/ThemeContext'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useCreateRoom } from '../../hooks/useCreateRoom'
import {
  getRoomThemeId,
  ROOM_NAME_MAX_LEN,
  type RoomVisibility,
} from '../../lib/multiplayerMessages'
import { setPendingRoomSetup, type ArenaFootprint } from '../../lib/roomCarry'
import { RoomSizeControl } from './RoomSizeControl'

/**
 * Solo-mode contents of the {@link PlayerPanel}: the panel is the primary way to
 * go online. Since a solo room has no server room yet, Discovery is a *local*
 * pre-choice (applied to the room we create) and "Create Room" replaces the
 * share block. Creating snapshots the current dice + their positions so the new
 * server room reopens exactly where solo left off (Shared-ADR-005).
 */
export function SoloRoomControls() {
  const roomSettings = useMultiplayerStore((s) => s.roomSettings)
  const navigate = useNavigate()
  const isOnline = useOnlineStatus()
  const { currentTheme } = useTheme()
  const colors = currentTheme.tokens.colors

  // Carry the solo room's current look into the room we create (#76 path).
  const currentThemeId = getRoomThemeId(roomSettings)

  // Discovery is a local pre-choice until the room exists; applied host-side on join.
  const [pendingVisibility, setPendingVisibility] = useState<RoomVisibility>('unlisted')
  const [pendingName, setPendingName] = useState('')
  const isPublic = pendingVisibility === 'public'

  // Stash the carry setup only once the server assigns a room id (i.e. creation
  // succeeded), keyed to that exact room so it can never be applied to a
  // different room the user later joins. Snapshots the live dice + the solo
  // arena they were captured in at that moment.
  const { createRoom, isCreating, phase, error, clearError } = useCreateRoom({
    themeId: currentThemeId,
    onRoomCreated: (roomId) => {
      const state = useMultiplayerStore.getState()
      const dice = Array.from(state.dice.values()).map((die) => ({
        diceType: die.diceType,
        presentation: die.presentation,
        position: die.position,
        rotation: die.rotation,
      }))
      const engine = state.engineConfig
      const sourceArena: ArenaFootprint | null = engine
        ? { halfX: engine.arenaHalfX, halfZ: engine.arenaHalfZ }
        : null
      setPendingRoomSetup({
        roomId,
        dice,
        sourceArena,
        visibility: pendingVisibility,
        roomName: pendingName,
      })
    },
  })

  const handleCreate = () => {
    if (isCreating || !isOnline) return
    void createRoom()
  }

  return (
    <div className="flex flex-col gap-2.5 px-3 py-3" data-testid="solo-room-controls">
      {/* Room size: reshape the solo table to your screen or a fixed ratio. The
          solo player is the host, so this resizes the current room live. */}
      <div className="pb-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <RoomSizeControl showAuto />
      </div>

      {/* Discovery — the room we're about to create is unlisted or public. */}
      <div className="flex flex-col gap-1.5" data-testid="solo-room-visibility">
        <span
          className="text-xs font-semibold uppercase"
          style={{ letterSpacing: '0.06em', color: colors.text.secondary }}
        >
          Discovery
        </span>

        <div
          role="radiogroup"
          aria-label="New room visibility"
          className="flex rounded-lg overflow-hidden"
          style={{ border: '1px solid rgba(255,255,255,0.12)' }}
        >
          {(['unlisted', 'public'] as const).map((mode, index) => {
            const isActive = mode === pendingVisibility
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => setPendingVisibility(mode)}
                data-testid={`solo-visibility-${mode}`}
                className="flex-1 px-1.5 py-1.5 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: isActive ? 'rgba(139, 92, 246, 0.55)' : 'transparent',
                  color: isActive ? '#fff' : colors.text.secondary,
                  cursor: 'pointer',
                  borderLeft: index > 0 ? '1px solid rgba(255,255,255,0.12)' : 'none',
                }}
              >
                {mode === 'public' ? 'Public' : 'Unlisted'}
              </button>
            )
          })}
        </div>

        <span className="text-xs" style={{ color: colors.text.muted, lineHeight: 1.35 }}>
          {isPublic
            ? 'Listed in the public browser for anyone to join.'
            : 'Only people with the code can join. Hidden from the browser.'}
        </span>

        {isPublic && (
          <input
            type="text"
            value={pendingName}
            maxLength={ROOM_NAME_MAX_LEN}
            placeholder="Name this room"
            aria-label="Public room name"
            data-testid="solo-room-name-input"
            onChange={(e) => setPendingName(e.target.value)}
            className="mt-0.5 w-full rounded-md px-2 py-1.5 text-sm"
            style={{
              backgroundColor: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: colors.text.primary,
            }}
          />
        )}
      </div>

      {/* Create Room — replaces the share block in solo (there's nothing to share
          until a server room exists). Brings the current dice along. */}
      <button
        type="button"
        onClick={handleCreate}
        disabled={isCreating || !isOnline}
        title={!isOnline ? 'Unavailable offline' : undefined}
        data-testid="go-online-create"
        className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-all"
        style={{
          backgroundColor: 'rgba(139, 92, 246, 0.2)',
          border: '1px solid rgba(139, 92, 246, 0.45)',
          cursor: !isOnline ? 'not-allowed' : isCreating ? 'wait' : 'pointer',
          opacity: !isOnline || isCreating ? 0.6 : 1,
          color: colors.text.primary,
        }}
      >
        <span className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>🌐</span>
          <span className="text-sm font-semibold">
            {phase === 'waking'
              ? 'Server waking up…'
              : isCreating
                ? 'Creating room…'
                : 'Create Room'}
          </span>
        </span>
        <span aria-hidden>→</span>
      </button>

      {/* Browse — join an existing public room instead. */}
      <button
        type="button"
        onClick={() => navigate('/rooms')}
        disabled={!isOnline || isCreating}
        title={!isOnline ? 'Unavailable offline' : undefined}
        data-testid="go-online-browse"
        className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-all"
        style={{
          backgroundColor: 'rgba(34, 197, 94, 0.14)',
          border: '1px solid rgba(34, 197, 94, 0.35)',
          cursor: !isOnline || isCreating ? 'not-allowed' : 'pointer',
          opacity: !isOnline || isCreating ? 0.6 : 1,
          color: colors.text.primary,
        }}
      >
        <span className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>🔍</span>
          <span className="text-sm font-semibold">Browse Rooms</span>
        </span>
        <span aria-hidden>→</span>
      </button>

      {!isOnline && (
        <span className="text-xs" style={{ color: colors.text.muted, lineHeight: 1.35 }}>
          You're offline. Reconnect to create or join an online room.
        </span>
      )}

      {error && (
        <div
          role="alert"
          data-testid="go-online-error"
          className="flex items-start justify-between gap-2 rounded-md px-2 py-1.5 text-xs"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
          }}
        >
          <span>
            <strong>{error.title}.</strong> {error.message}
          </span>
          <button
            type="button"
            onClick={clearError}
            aria-label="Dismiss room error"
            style={{ color: '#fca5a5' }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
