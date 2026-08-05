/**
 * Discord room-posting client (issue #246).
 *
 * The host-initiated "Post to Discord" flow talks to two authenticated room-server
 * endpoints, both taking the Supabase access token as a bearer header:
 *
 * - `GET  /api/discord/targets`            → the guilds the caller is a *verified
 *   member* of that also have the Dicesuki bot installed, plus the channels the bot
 *   can post in. Membership filtering is enforced server-side: the raw bot-guild
 *   list never reaches the client, so this module never filters for privacy — it
 *   only renders what the server already scoped to this caller.
 * - `POST /api/rooms/:roomId/advertise`    → posts the room's advert embed to one
 *   chosen channel. Host-only and rate-limited server-side.
 *
 * Neither call throws for an expected failure: both resolve to a discriminated
 * result carrying a machine-readable {@link DiscordShareErrorCode} so the UI can
 * map every documented server code to one human sentence.
 */

import type { User } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabaseClient'
import { getRoomServerConfig, type RoomServerMode } from './multiplayerServer'

/** A channel the bot can post in, inside a guild the caller belongs to. */
export interface DiscordChannelTarget {
  id: string
  name: string
}

/**
 * A guild (Discord server) the caller is a verified member of AND the bot is in.
 * `icon` is Discord's raw icon hash, or null when the guild has no icon.
 * An empty `channels` array means the bot is present but cannot post anywhere —
 * the UI shows the guild disabled rather than dropping it, so a host does not
 * wonder why a server they know the bot is in went missing.
 */
export interface DiscordGuildTarget {
  id: string
  name: string
  icon: string | null
  channels: DiscordChannelTarget[]
}

/**
 * Every failure the share sheet can surface. The first block mirrors the server's
 * documented `{"error": <code>}` responses one-for-one; the last two are
 * client-side conditions with no server equivalent.
 */
export type DiscordShareErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'NOT_ROOM_HOST'
  | 'CHANNEL_NOT_VERIFIED'
  | 'NO_DISCORD_IDENTITY'
  | 'ROOM_NOT_FOUND'
  | 'TOO_MANY_ADVERTS'
  | 'RATE_LIMITED'
  | 'DISCORD_DISABLED'
  /** The request never completed (offline, DNS, CORS, aborted). */
  | 'NETWORK'
  /** The server answered with a status/body this client does not recognize. */
  | 'UNKNOWN'

export type DiscordTargetsResult =
  | { ok: true; guilds: DiscordGuildTarget[] }
  | { ok: false; code: DiscordShareErrorCode }

export type DiscordAdvertiseResult =
  | { ok: true; roomId: string }
  | { ok: false; code: DiscordShareErrorCode }

/** Options shared by both calls; every seam is injectable for tests. */
export interface DiscordShareRequestOptions {
  /** Room-server target. Defaults to the public server. */
  mode?: RoomServerMode
  /** Injected fetch (tests); defaults to the global. */
  fetchImpl?: typeof fetch
  /** Injected bearer token (tests); defaults to the live Supabase session. */
  accessToken?: string | null
  signal?: AbortSignal
}

const SERVER_ERROR_CODES: readonly string[] = [
  'AUTH_REQUIRED',
  'AUTH_INVALID',
  'NOT_ROOM_HOST',
  'CHANNEL_NOT_VERIFIED',
  'NO_DISCORD_IDENTITY',
  'ROOM_NOT_FOUND',
  'TOO_MANY_ADVERTS',
  'RATE_LIMITED',
  'DISCORD_DISABLED',
]

/** Human sentence for every code. Every branch is user-facing copy, not a log line. */
export function describeDiscordShareError(code: DiscordShareErrorCode): string {
  switch (code) {
    case 'AUTH_REQUIRED':
    case 'AUTH_INVALID':
      return 'Your sign-in expired. Sign in again and retry.'
    case 'NOT_ROOM_HOST':
      return 'Only the room host can post this room to Discord.'
    case 'CHANNEL_NOT_VERIFIED':
      return "You can't post to that channel. Pick one from your own servers."
    case 'NO_DISCORD_IDENTITY':
      return 'Link your Discord account to post rooms.'
    case 'ROOM_NOT_FOUND':
      return 'This room is no longer on the server.'
    case 'TOO_MANY_ADVERTS':
      return 'This room has already been posted to as many channels as allowed.'
    case 'RATE_LIMITED':
      return 'Too many requests — try again in a few seconds.'
    case 'DISCORD_DISABLED':
      return 'Discord posting is turned off on this server.'
    case 'NETWORK':
      return "Couldn't reach the room server. Check your connection and retry."
    case 'UNKNOWN':
    default:
      return 'Something went wrong posting to Discord.'
  }
}

/**
 * True only when the signed-in user actually linked Discord. Guests (`null`) and
 * email-only users are false, which is what hides the whole option — the server
 * would answer them with an empty guild list anyway, but there is no reason to
 * show a control that can never work.
 */
export function hasDiscordIdentity(user: User | null | undefined): boolean {
  if (!user) return false
  const identities = user.identities
  if (Array.isArray(identities) && identities.some((i) => i?.provider === 'discord')) {
    return true
  }
  // Fallback for sessions whose identities array was not hydrated: Supabase also
  // records the linked providers on app_metadata.
  const appMeta = user.app_metadata as
    | { provider?: unknown; providers?: unknown }
    | undefined
  if (appMeta?.provider === 'discord') return true
  return Array.isArray(appMeta?.providers) && appMeta.providers.includes('discord')
}

/**
 * The self-serve "Add the Dicesuki bot to your server" URL, or null when unset.
 * Deployment configuration rather than API data — the room server deliberately
 * does not serve it — so the empty state hides the link when it is not provided.
 */
export function getDiscordBotInviteUrl(): string | null {
  try {
    const value = import.meta.env?.VITE_DISCORD_BOT_INVITE_URL
    return typeof value === 'string' && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

/** Discord CDN URL for a guild's icon, or null when the guild has none. */
export function guildIconUrl(guild: Pick<DiscordGuildTarget, 'id' | 'icon'>): string | null {
  if (!guild.icon) return null
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
}

/** Read the live Supabase access token, or null in guest / unconfigured mode. */
export async function getSupabaseAccessToken(): Promise<string | null> {
  try {
    const client = getSupabaseClient()
    if (!client) return null
    const { data } = await client.auth.getSession()
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

async function resolveToken(options: DiscordShareRequestOptions): Promise<string | null> {
  if (options.accessToken !== undefined) return options.accessToken
  return getSupabaseAccessToken()
}

/** Pull the machine-readable code out of an error body, falling back by status. */
async function readErrorCode(response: Response): Promise<DiscordShareErrorCode> {
  let body: { error?: unknown } | null = null
  try {
    body = (await response.json()) as { error?: unknown }
  } catch {
    body = null
  }
  const raw = typeof body?.error === 'string' ? body.error : null
  if (raw && SERVER_ERROR_CODES.includes(raw)) {
    return raw as DiscordShareErrorCode
  }
  if (response.status === 401) return 'AUTH_REQUIRED'
  if (response.status === 429) return 'RATE_LIMITED'
  if (response.status === 503) return 'DISCORD_DISABLED'
  return 'UNKNOWN'
}

function normalizeChannels(raw: unknown): DiscordChannelTarget[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const channel = entry as { id?: unknown; name?: unknown }
    if (typeof channel?.id !== 'string' || typeof channel?.name !== 'string') return []
    return [{ id: channel.id, name: channel.name }]
  })
}

function normalizeGuilds(raw: unknown): DiscordGuildTarget[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const guild = entry as { id?: unknown; name?: unknown; icon?: unknown; channels?: unknown }
    if (typeof guild?.id !== 'string' || typeof guild?.name !== 'string') return []
    return [
      {
        id: guild.id,
        name: guild.name,
        icon: typeof guild.icon === 'string' && guild.icon ? guild.icon : null,
        channels: normalizeChannels(guild.channels),
      },
    ]
  })
}

/**
 * Fetch the guilds/channels this caller may post to. An empty `guilds` array is a
 * success, not an error: it means the caller has no eligible servers yet and the
 * UI should offer the bot-invite path.
 */
export async function fetchDiscordTargets(
  options: DiscordShareRequestOptions = {},
): Promise<DiscordTargetsResult> {
  const token = await resolveToken(options)
  if (!token) return { ok: false, code: 'AUTH_REQUIRED' }

  const fetchImpl = options.fetchImpl ?? fetch
  const config = getRoomServerConfig(options.mode ?? 'public')

  let response: Response
  try {
    response = await fetchImpl(`${config.httpUrl}/api/discord/targets`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: options.signal,
    })
  } catch {
    return { ok: false, code: 'NETWORK' }
  }

  if (!response.ok) {
    return { ok: false, code: await readErrorCode(response) }
  }

  let body: { guilds?: unknown }
  try {
    body = (await response.json()) as { guilds?: unknown }
  } catch {
    return { ok: false, code: 'UNKNOWN' }
  }
  return { ok: true, guilds: normalizeGuilds(body.guilds) }
}

/**
 * Post `roomId`'s advert embed to `channelId`. Host-only server-side; a
 * `NOT_ROOM_HOST` response is mapped like any other code so a host transfer
 * between render and click surfaces a sentence rather than a silent no-op.
 */
export async function advertiseRoomToDiscord(
  roomId: string,
  channelId: string,
  options: DiscordShareRequestOptions = {},
): Promise<DiscordAdvertiseResult> {
  const token = await resolveToken(options)
  if (!token) return { ok: false, code: 'AUTH_REQUIRED' }

  const fetchImpl = options.fetchImpl ?? fetch
  const config = getRoomServerConfig(options.mode ?? 'public')

  let response: Response
  try {
    response = await fetchImpl(
      `${config.httpUrl}/api/rooms/${encodeURIComponent(roomId)}/advertise`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channelId }),
        signal: options.signal,
      },
    )
  } catch {
    return { ok: false, code: 'NETWORK' }
  }

  if (!response.ok) {
    return { ok: false, code: await readErrorCode(response) }
  }

  // 202 Accepted echoes the room id; a body we cannot read is still a success —
  // the post was accepted, and we already know which room we asked for.
  let echoed: string | null = null
  try {
    const body = (await response.json()) as { roomId?: unknown }
    if (typeof body?.roomId === 'string') echoed = body.roomId
  } catch {
    echoed = null
  }
  return { ok: true, roomId: echoed ?? roomId }
}
