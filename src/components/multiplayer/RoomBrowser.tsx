import { useNavigate } from 'react-router-dom'
import { useTheme } from '../../contexts/ThemeContext'
import { usePublicRooms } from '../../hooks/usePublicRooms'
import type { PublicRoomEntry } from '../../lib/multiplayerServer'

/**
 * Public room browser (#79). Lists rooms hosts have marked public and lets a
 * player join one directly. Reached at `/rooms`.
 */
export function RoomBrowser() {
  const navigate = useNavigate()
  const { currentTheme } = useTheme()
  const colors = currentTheme.tokens.colors
  const {
    rooms,
    page,
    total,
    isLoading,
    error,
    refresh,
    nextPage,
    prevPage,
    hasNextPage,
    hasPrevPage,
  } = usePublicRooms()

  const joinRoom = (roomId: string) => {
    navigate(`/room/${roomId}`)
  }

  return (
    <div
      className="w-full h-full overflow-y-auto"
      style={{ background: colors.background, color: colors.text.primary }}
      data-testid="room-browser"
    >
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <img
              src="/brand/dicesuki-wordmark.svg"
              alt="Dicesuki"
              className="w-40 max-w-[46vw] mb-4"
            />
            <h1 className="text-2xl font-bold">Public Rooms</h1>
            <p className="text-sm" style={{ color: colors.text.muted }}>
              Drop in and roll with anyone
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="px-3 py-2 rounded-lg text-sm font-medium"
              style={{
                background: colors.surface,
                border: '1px solid rgba(255,255,255,0.12)',
                color: colors.text.primary,
              }}
              aria-label="Refresh room list"
            >
              Refresh
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-3 py-2 rounded-lg text-sm font-medium"
              style={{
                background: colors.surface,
                border: '1px solid rgba(255,255,255,0.12)',
                color: colors.text.primary,
              }}
            >
              Back
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            className="mb-4 p-3 rounded-lg text-sm"
            role="alert"
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fca5a5',
            }}
          >
            {error}
          </div>
        )}

        {/* Loading */}
        {isLoading && rooms.length === 0 && (
          <p className="text-sm py-8 text-center" style={{ color: colors.text.muted }}>
            Loading public rooms...
          </p>
        )}

        {/* Empty */}
        {!isLoading && !error && rooms.length === 0 && (
          <div
            className="p-8 rounded-lg text-center"
            style={{ background: colors.surface, border: '1px solid rgba(255,255,255,0.08)' }}
            data-testid="room-browser-empty"
          >
            <p className="text-sm" style={{ color: colors.text.secondary }}>
              No public rooms right now.
            </p>
            <p className="text-xs mt-1" style={{ color: colors.text.muted }}>
              Create a room and mark it public to see it here.
            </p>
          </div>
        )}

        {/* List */}
        {rooms.length > 0 && (
          <ul className="flex flex-col gap-2" data-testid="room-list">
            {rooms.map((room) => (
              <RoomRow
                key={room.roomId}
                room={room}
                textPrimary={colors.text.primary}
                textMuted={colors.text.muted}
                surface={colors.surface}
                accent={colors.accent}
                onJoin={() => joinRoom(room.roomId)}
              />
            ))}
          </ul>
        )}

        {/* Pagination */}
        {(hasPrevPage || hasNextPage) && (
          <div className="flex items-center justify-between mt-6">
            <button
              onClick={prevPage}
              disabled={!hasPrevPage}
              className="px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
              style={{
                background: colors.surface,
                border: '1px solid rgba(255,255,255,0.12)',
                color: colors.text.primary,
                cursor: hasPrevPage ? 'pointer' : 'default',
              }}
            >
              Previous
            </button>
            <span className="text-xs" style={{ color: colors.text.muted }}>
              Page {page + 1} · {total} room{total === 1 ? '' : 's'}
            </span>
            <button
              onClick={nextPage}
              disabled={!hasNextPage}
              className="px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
              style={{
                background: colors.surface,
                border: '1px solid rgba(255,255,255,0.12)',
                color: colors.text.primary,
                cursor: hasNextPage ? 'pointer' : 'default',
              }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

interface RoomRowProps {
  room: PublicRoomEntry
  textPrimary: string
  textMuted: string
  surface: string
  accent: string
  onJoin: () => void
}

function RoomRow({ room, textPrimary, textMuted, surface, accent, onJoin }: RoomRowProps) {
  const label = room.name || room.roomId
  return (
    <li
      className="flex items-center justify-between gap-3 p-3 rounded-lg"
      style={{ background: surface, border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm truncate" style={{ color: textPrimary }}>
            {label}
          </span>
          {room.themeId && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(255,255,255,0.08)', color: textMuted }}
            >
              {room.themeId}
            </span>
          )}
        </div>
        <div className="text-xs mt-0.5" style={{ color: textMuted }}>
          {room.name ? `${room.roomId} · ` : ''}
          {room.playerCount} player{room.playerCount === 1 ? '' : 's'}
        </div>
      </div>
      <button
        onClick={onJoin}
        className="px-4 py-2 rounded-lg text-sm font-semibold flex-shrink-0"
        style={{ background: accent, color: '#fff' }}
        aria-label={`Join ${label}`}
      >
        Join
      </button>
    </li>
  )
}
