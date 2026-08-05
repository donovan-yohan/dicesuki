import { describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import {
  advertiseRoomToDiscord,
  describeDiscordShareError,
  fetchDiscordTargets,
  getDiscordBotInviteUrl,
  guildIconUrl,
  hasDiscordIdentity,
  type DiscordShareErrorCode,
} from './discordShare'
import { getRoomServerConfig } from './multiplayerServer'

const HTTP = getRoomServerConfig().httpUrl

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): Response {
  const status = init.status ?? 200
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => body,
  } as Response
}

function makeUser(overrides: Partial<User>): User {
  return {
    id: 'user-1',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as User
}

describe('hasDiscordIdentity', () => {
  it('is false for a guest (no user)', () => {
    // Arrange / Act / Assert — guests never see the option.
    expect(hasDiscordIdentity(null)).toBe(false)
    expect(hasDiscordIdentity(undefined)).toBe(false)
  })

  it('is false for an email-only user', () => {
    const user = makeUser({
      identities: [{ provider: 'email' }] as unknown as User['identities'],
      app_metadata: { provider: 'email', providers: ['email'] },
    })
    expect(hasDiscordIdentity(user)).toBe(false)
  })

  it('is true when a Discord identity is linked', () => {
    const user = makeUser({
      identities: [{ provider: 'discord' }] as unknown as User['identities'],
    })
    expect(hasDiscordIdentity(user)).toBe(true)
  })

  it('falls back to app_metadata when identities are not hydrated', () => {
    const user = makeUser({ app_metadata: { provider: 'discord' } })
    expect(hasDiscordIdentity(user)).toBe(true)

    const multi = makeUser({ app_metadata: { providers: ['email', 'discord'] } })
    expect(hasDiscordIdentity(multi)).toBe(true)
  })
})

describe('guildIconUrl', () => {
  it('builds the Discord CDN URL from the icon hash', () => {
    expect(guildIconUrl({ id: '123', icon: 'abc' })).toBe(
      'https://cdn.discordapp.com/icons/123/abc.png',
    )
  })

  it('returns null when the guild has no icon', () => {
    expect(guildIconUrl({ id: '123', icon: null })).toBeNull()
  })
})

describe('getDiscordBotInviteUrl', () => {
  it('returns null when the env var is unset in the test environment', () => {
    // The test env sets no VITE_DISCORD_BOT_INVITE_URL, so the link is hidden.
    expect(getDiscordBotInviteUrl()).toBeNull()
  })
})

describe('describeDiscordShareError', () => {
  const codes: DiscordShareErrorCode[] = [
    'AUTH_REQUIRED',
    'AUTH_INVALID',
    'NOT_ROOM_HOST',
    'CHANNEL_NOT_VERIFIED',
    'NO_DISCORD_IDENTITY',
    'ROOM_NOT_FOUND',
    'TOO_MANY_ADVERTS',
    'RATE_LIMITED',
    'DISCORD_DISABLED',
    'NETWORK',
    'UNKNOWN',
  ]

  it('maps every code to a non-empty human sentence', () => {
    for (const code of codes) {
      const message = describeDiscordShareError(code)
      expect(message.length).toBeGreaterThan(0)
      // No machine codes leak into user-facing copy.
      expect(message).not.toContain('_')
    }
  })

  it('tells a rate-limited caller to wait a few seconds', () => {
    expect(describeDiscordShareError('RATE_LIMITED')).toContain('few seconds')
  })

  it('names the host constraint for NOT_ROOM_HOST', () => {
    expect(describeDiscordShareError('NOT_ROOM_HOST')).toContain('host')
  })
})

describe('fetchDiscordTargets', () => {
  it('sends the bearer token and normalizes the guild list', async () => {
    // Arrange
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        guilds: [
          {
            id: 'g1',
            name: 'Table Talk',
            icon: 'hash1',
            channels: [{ id: 'c1', name: 'general' }],
          },
          { id: 'g2', name: 'Empty', icon: null, channels: [] },
        ],
      }),
    )

    // Act
    const result = await fetchDiscordTargets({ fetchImpl, accessToken: 'tok-123' })

    // Assert
    expect(result).toEqual({
      ok: true,
      guilds: [
        { id: 'g1', name: 'Table Talk', icon: 'hash1', channels: [{ id: 'c1', name: 'general' }] },
        { id: 'g2', name: 'Empty', icon: null, channels: [] },
      ],
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      `${HTTP}/api/discord/targets`,
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer tok-123' },
      }),
    )
  })

  it('treats an empty guild list as a success', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ guilds: [] }))
    await expect(fetchDiscordTargets({ fetchImpl, accessToken: 'tok' })).resolves.toEqual({
      ok: true,
      guilds: [],
    })
  })

  it('drops malformed guild and channel entries', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        guilds: [
          { id: 'g1', name: 'Good', channels: [{ id: 'c1', name: 'ok' }, { id: 5 }] },
          { name: 'no id' },
        ],
      }),
    )
    const result = await fetchDiscordTargets({ fetchImpl, accessToken: 'tok' })
    expect(result).toEqual({
      ok: true,
      guilds: [{ id: 'g1', name: 'Good', icon: null, channels: [{ id: 'c1', name: 'ok' }] }],
    })
  })

  it('fails with AUTH_REQUIRED without a token, making no request', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(fetchDiscordTargets({ fetchImpl, accessToken: null })).resolves.toEqual({
      ok: false,
      code: 'AUTH_REQUIRED',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps a 429 body to RATE_LIMITED', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: 'RATE_LIMITED' }, { status: 429 }))
    await expect(fetchDiscordTargets({ fetchImpl, accessToken: 'tok' })).resolves.toEqual({
      ok: false,
      code: 'RATE_LIMITED',
    })
  })

  it('maps a network failure to NETWORK', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))
    await expect(fetchDiscordTargets({ fetchImpl, accessToken: 'tok' })).resolves.toEqual({
      ok: false,
      code: 'NETWORK',
    })
  })
})

describe('advertiseRoomToDiscord', () => {
  it('POSTs the channel id with the bearer token and returns the room id', async () => {
    // Arrange
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ roomId: 'ROOM42' }, { status: 202 }))

    // Act
    const result = await advertiseRoomToDiscord('ROOM42', 'c1', {
      fetchImpl,
      accessToken: 'tok-123',
    })

    // Assert
    expect(result).toEqual({ ok: true, roomId: 'ROOM42' })
    expect(fetchImpl).toHaveBeenCalledWith(
      `${HTTP}/api/rooms/ROOM42/advertise`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer tok-123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channelId: 'c1' }),
      }),
    )
  })

  it('url-encodes the room id', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, { status: 202 }))
    await advertiseRoomToDiscord('a/b', 'c1', { fetchImpl, accessToken: 'tok' })
    expect(fetchImpl.mock.calls[0][0]).toBe(`${HTTP}/api/rooms/a%2Fb/advertise`)
  })

  it.each([
    ['NOT_ROOM_HOST', 403],
    ['CHANNEL_NOT_VERIFIED', 403],
    ['NO_DISCORD_IDENTITY', 403],
    ['ROOM_NOT_FOUND', 404],
    ['TOO_MANY_ADVERTS', 409],
    ['RATE_LIMITED', 429],
    ['DISCORD_DISABLED', 503],
    ['AUTH_REQUIRED', 401],
    ['AUTH_INVALID', 401],
  ] as const)('maps the %s error body', async (code, status) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: code, instanceId: 'abc' }, { status }))
    await expect(
      advertiseRoomToDiscord('ROOM42', 'c1', { fetchImpl, accessToken: 'tok' }),
    ).resolves.toEqual({ ok: false, code })
  })

  it('falls back by status when the body carries no known code', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: 'WAT' }, { status: 500 }))
    await expect(
      advertiseRoomToDiscord('ROOM42', 'c1', { fetchImpl, accessToken: 'tok' }),
    ).resolves.toEqual({ ok: false, code: 'UNKNOWN' })
  })

  it('still succeeds when the 202 body is unreadable', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => {
        throw new Error('no body')
      },
    } as unknown as Response)
    await expect(
      advertiseRoomToDiscord('ROOM42', 'c1', { fetchImpl, accessToken: 'tok' }),
    ).resolves.toEqual({ ok: true, roomId: 'ROOM42' })
  })
})
