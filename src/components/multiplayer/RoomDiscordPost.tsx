/**
 * Post to Discord (issue #246).
 *
 * Host-initiated room posting, rendered inside {@link RoomShare} alongside the
 * copy-link / native-share / QR controls. Opening the picker fetches the guilds
 * the *caller* may post to (`GET /api/discord/targets` — membership-filtered
 * server-side), then walks server → channel → confirm → post.
 *
 * Visibility is gated in two layers, both cheap and both re-checked server-side:
 *   1. Discord identity — guests and email-only users never see the control.
 *   2. Host — the room protocol already carries `hostId`/`isHost`
 *      (`room_state` / `host_changed`), so the client knows the host without any
 *      protocol change. A host transfer between render and click still lands as a
 *      `NOT_ROOM_HOST` response, which is mapped to its own sentence.
 *
 * All picker state is ephemeral component state: nothing here is cross-cutting,
 * so per Frontend-ADR-002 none of it belongs in a Zustand store.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from '../../contexts/ThemeContext'
import { useAuthStore } from '../../store/useAuthStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import {
  advertiseRoomToDiscord,
  describeDiscordShareError,
  fetchDiscordTargets,
  getDiscordBotInviteUrl,
  guildIconUrl,
  hasDiscordIdentity,
  type DiscordGuildTarget,
  type DiscordShareErrorCode,
} from '../../lib/discordShare'

type LoadState = 'idle' | 'loading' | 'loaded' | 'error'

export function RoomDiscordPost() {
  const roomId = useMultiplayerStore((s) => s.roomId)
  const isHost = useMultiplayerStore((s) => s.isHost)
  const user = useAuthStore((s) => s.user)
  const { currentTheme } = useTheme()
  const colors = currentTheme.tokens.colors

  const [open, setOpen] = useState(false)
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [guilds, setGuilds] = useState<DiscordGuildTarget[]>([])
  const [loadError, setLoadError] = useState<DiscordShareErrorCode | null>(null)
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<DiscordShareErrorCode | null>(null)
  const [postedChannelIds, setPostedChannelIds] = useState<Set<string>>(() => new Set())
  const [success, setSuccess] = useState<string | null>(null)

  // Guards a resolved fetch/post from writing into an unmounted tree.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadTargets = useCallback(async () => {
    setLoadState('loading')
    setLoadError(null)
    const result = await fetchDiscordTargets()
    if (!mounted.current) return
    if (!result.ok) {
      setLoadError(result.code)
      setLoadState('error')
      return
    }
    setGuilds(result.guilds)
    setLoadState('loaded')
  }, [])

  const handleToggle = useCallback(() => {
    if (open) {
      setOpen(false)
      return
    }
    // Opening is a fresh pick: clear the previous walk and refetch, so a guild
    // the host has since been removed from cannot linger in the list.
    setSelectedGuildId(null)
    setSelectedChannelId(null)
    setPostError(null)
    setSuccess(null)
    setOpen(true)
    void loadTargets()
  }, [open, loadTargets])

  const handlePost = useCallback(async () => {
    if (!roomId || !selectedChannelId) return
    setPosting(true)
    setPostError(null)
    const result = await advertiseRoomToDiscord(roomId, selectedChannelId)
    if (!mounted.current) return
    setPosting(false)
    if (!result.ok) {
      setPostError(result.code)
      return
    }
    const channelName =
      guilds
        .find((g) => g.id === selectedGuildId)
        ?.channels.find((c) => c.id === selectedChannelId)?.name ?? 'the channel'
    // New Set instance — never mutate state collections in place (Frontend-ADR-002).
    setPostedChannelIds((prev) => new Set(prev).add(selectedChannelId))
    setSuccess(`Posted to #${channelName}`)
    setSelectedChannelId(null)
    setSelectedGuildId(null)
  }, [roomId, selectedChannelId, selectedGuildId, guilds])

  // Layer 1: no linked Discord account (guest or email-only) ⇒ the option
  // never exists. Layer 2: not the host ⇒ nothing to post.
  if (!roomId || !hasDiscordIdentity(user) || !isHost) return null

  const selectedGuild = guilds.find((g) => g.id === selectedGuildId) ?? null
  const selectedChannel =
    selectedGuild?.channels.find((c) => c.id === selectedChannelId) ?? null
  const inviteUrl = getDiscordBotInviteUrl()

  const buttonBase: React.CSSProperties = {
    padding: '0.4rem 0.5rem',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.08)',
    color: colors.text.primary,
    fontSize: '0.8rem',
    cursor: 'pointer',
  }

  const rowBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    width: '100%',
    padding: '0.4rem 0.5rem',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.05)',
    color: colors.text.primary,
    fontSize: '0.78rem',
    textAlign: 'left',
  }

  const hintStyle: React.CSSProperties = {
    fontSize: '0.68rem',
    color: colors.text.secondary,
  }

  return (
    <div data-testid="room-discord-post" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        style={{ ...buttonBase, width: '100%' }}
        data-testid="room-discord-toggle"
      >
        {open ? 'Hide Discord servers' : 'Post to Discord'}
      </button>

      {open && (
        <div
          data-testid="room-discord-picker"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
            padding: '0.5rem',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(0,0,0,0.18)',
          }}
        >
          {loadState === 'loading' && (
            <span data-testid="room-discord-loading" style={hintStyle}>
              Loading your servers…
            </span>
          )}

          {loadState === 'error' && loadError && (
            <>
              <span data-testid="room-discord-load-error" style={{ ...hintStyle, color: colors.error }}>
                {describeDiscordShareError(loadError)}
              </span>
              <button
                type="button"
                onClick={() => void loadTargets()}
                style={buttonBase}
                data-testid="room-discord-retry"
              >
                Try again
              </button>
            </>
          )}

          {loadState === 'loaded' && guilds.length === 0 && (
            <div
              data-testid="room-discord-empty"
              style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}
            >
              <span style={hintStyle}>
                No servers yet. Dicesuki can only post to Discord servers you&apos;re in that
                already have the Dicesuki bot.
              </span>
              {inviteUrl && (
                <a
                  href={inviteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...buttonBase, textAlign: 'center', textDecoration: 'none' }}
                  data-testid="room-discord-invite"
                >
                  Add the Dicesuki bot to your server
                </a>
              )}
            </div>
          )}

          {/* Step 1 — pick a server. */}
          {loadState === 'loaded' && guilds.length > 0 && !selectedGuild && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <span style={hintStyle}>Choose a server</span>
              {guilds.map((guild) => {
                const iconUrl = guildIconUrl(guild)
                const postable = guild.channels.length > 0
                return (
                  <button
                    key={guild.id}
                    type="button"
                    disabled={!postable}
                    onClick={() => {
                      setSelectedGuildId(guild.id)
                      setPostError(null)
                      setSuccess(null)
                    }}
                    style={{
                      ...rowBase,
                      cursor: postable ? 'pointer' : 'default',
                      opacity: postable ? 1 : 0.55,
                    }}
                    data-testid={`room-discord-guild-${guild.id}`}
                  >
                    {iconUrl ? (
                      <img
                        src={iconUrl}
                        alt=""
                        width={20}
                        height={20}
                        style={{ borderRadius: '50%', flexShrink: 0 }}
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          flexShrink: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'rgba(255,255,255,0.14)',
                          fontSize: '0.6rem',
                        }}
                      >
                        {guild.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {guild.name}
                    </span>
                    {!postable && (
                      <span style={hintStyle} data-testid={`room-discord-guild-${guild.id}-hint`}>
                        No channel the bot can post in
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* Step 2 — pick a channel. */}
          {selectedGuild && !selectedChannel && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <span style={hintStyle}>Choose a channel in {selectedGuild.name}</span>
              {selectedGuild.channels.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => {
                    setSelectedChannelId(channel.id)
                    setPostError(null)
                  }}
                  style={{ ...rowBase, cursor: 'pointer' }}
                  data-testid={`room-discord-channel-${channel.id}`}
                >
                  <span style={{ flex: 1 }}>#{channel.name}</span>
                  {postedChannelIds.has(channel.id) && <span style={hintStyle}>Posted</span>}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSelectedGuildId(null)}
                style={buttonBase}
                data-testid="room-discord-back"
              >
                Back to servers
              </button>
            </div>
          )}

          {/* Step 3 — confirm. */}
          {selectedGuild && selectedChannel && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span style={hintStyle}>
                Post this room to #{selectedChannel.name} in {selectedGuild.name}?
              </span>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  type="button"
                  onClick={() => void handlePost()}
                  disabled={posting}
                  style={{ ...buttonBase, flex: 1, cursor: posting ? 'default' : 'pointer' }}
                  data-testid="room-discord-confirm"
                >
                  {posting ? 'Posting…' : 'Post room'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedChannelId(null)}
                  disabled={posting}
                  style={{ ...buttonBase, flex: 1 }}
                  data-testid="room-discord-cancel"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {postError && (
            <span
              data-testid="room-discord-post-error"
              role="alert"
              style={{ ...hintStyle, color: colors.error }}
            >
              {describeDiscordShareError(postError)}
            </span>
          )}

          {success && (
            <span data-testid="room-discord-success" role="status" style={hintStyle}>
              {success}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
