import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'

// The picker reads the live Supabase session for its bearer token. Mock the
// client module so the component's real (un-injected) code path resolves a token
// exactly as it would in the browser.
vi.mock('../../lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'tok-test' } } }),
    },
  }),
  isSupabaseConfigured: () => true,
  getSupabaseUrl: () => 'https://example.supabase.co',
  getSupabasePublishableKey: () => 'sb_publishable_test',
  resetSupabaseClientForTests: () => {},
}))

import { ThemeContext } from '../../contexts/ThemeContext'
import { useAuthStore } from '../../store/useAuthStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { defaultTheme } from '../../themes/tokens'
import { RoomDiscordPost } from './RoomDiscordPost'

function makeUser(providers: string[]): User {
  return {
    id: 'user-1',
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
    app_metadata: { providers },
    user_metadata: {},
    identities: providers.map((provider) => ({ provider })),
  } as unknown as User
}

const DISCORD_USER = makeUser(['discord'])
const EMAIL_USER = makeUser(['email'])

const GUILDS = [
  {
    id: 'g1',
    name: 'Table Talk',
    icon: 'iconhash',
    channels: [
      { id: 'c1', name: 'general' },
      { id: 'c2', name: 'dice' },
    ],
  },
  { id: 'g2', name: 'Silent Server', icon: null, channels: [] },
]

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as Response
}

/**
 * Route the mocked fetch by URL: the targets GET and the advertise POST are
 * separate endpoints, and several tests exercise both in one flow.
 */
function mockServer(options: {
  targets?: Response
  advertise?: Response
}): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    if (url.includes('/api/discord/targets')) {
      return options.targets ?? jsonResponse({ guilds: GUILDS })
    }
    if (url.includes('/advertise')) {
      return options.advertise ?? jsonResponse({ roomId: 'ROOM42' }, 202)
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPicker() {
  return render(
    <ThemeContext.Provider
      value={{
        currentTheme: defaultTheme,
        setTheme: vi.fn(),
        availableThemes: [defaultTheme],
        ownedThemes: [defaultTheme.id],
        purchaseTheme: vi.fn(async () => true),
      }}
    >
      <RoomDiscordPost />
    </ThemeContext.Provider>,
  )
}

/** Open the picker and walk to the confirm step for #general in Table Talk. */
async function openAndSelectGeneral() {
  renderPicker()
  fireEvent.click(screen.getByTestId('room-discord-toggle'))
  await screen.findByTestId('room-discord-guild-g1')
  fireEvent.click(screen.getByTestId('room-discord-guild-g1'))
  fireEvent.click(screen.getByTestId('room-discord-channel-c1'))
  fireEvent.click(screen.getByTestId('room-discord-confirm'))
}

describe('RoomDiscordPost', () => {
  beforeEach(() => {
    useMultiplayerStore.setState({ roomId: 'ROOM42', isHost: true })
    useAuthStore.setState({ status: 'authenticated', user: DISCORD_USER })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    useMultiplayerStore.getState().reset()
    useAuthStore.setState({ status: 'guest', user: null, profile: null })
  })

  describe('visibility gating', () => {
    it('renders nothing for a guest', () => {
      // Arrange
      useAuthStore.setState({ status: 'guest', user: null })
      // Act
      const { container } = renderPicker()
      // Assert
      expect(container.querySelector('[data-testid="room-discord-post"]')).toBeNull()
    })

    it('renders nothing for an email-only user', () => {
      useAuthStore.setState({ status: 'authenticated', user: EMAIL_USER })
      const { container } = renderPicker()
      expect(container.querySelector('[data-testid="room-discord-post"]')).toBeNull()
    })

    it('renders nothing for a user who unlinked Discord (stale app_metadata)', () => {
      // Arrange — `identities` empties on unlink while app_metadata still says
      // discord; the option must disappear with the identity.
      useAuthStore.setState({
        status: 'authenticated',
        user: {
          id: 'user-1',
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00Z',
          app_metadata: { provider: 'discord', providers: ['discord'] },
          user_metadata: {},
          identities: [],
        } as unknown as User,
      })
      // Act
      const { container } = renderPicker()
      // Assert
      expect(container.querySelector('[data-testid="room-discord-post"]')).toBeNull()
    })

    it('renders nothing for a Discord user who is not the host', () => {
      // The room protocol already carries hostId/isHost, so the client can gate
      // without a protocol change.
      useMultiplayerStore.setState({ isHost: false })
      const { container } = renderPicker()
      expect(container.querySelector('[data-testid="room-discord-post"]')).toBeNull()
    })

    it('renders nothing when there is no room', () => {
      useMultiplayerStore.setState({ roomId: null })
      const { container } = renderPicker()
      expect(container.querySelector('[data-testid="room-discord-post"]')).toBeNull()
    })

    it('renders the option for a Discord-linked host', () => {
      renderPicker()
      expect(screen.getByTestId('room-discord-toggle')).toHaveTextContent('Post to Discord')
    })
  })

  describe('target picker', () => {
    it('fetches targets on open with a bearer token and lists the guilds', async () => {
      // Arrange
      const fetchMock = mockServer({})

      // Act
      renderPicker()
      fireEvent.click(screen.getByTestId('room-discord-toggle'))

      // Assert
      expect(screen.getByTestId('room-discord-loading')).toBeInTheDocument()
      await screen.findByTestId('room-discord-guild-g1')
      expect(screen.getByTestId('room-discord-guild-g2')).toBeInTheDocument()

      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-test')
      expect(String(fetchMock.mock.calls[0][0])).toContain('/api/discord/targets')
    })

    it('disables a guild the bot cannot post in and explains why', async () => {
      mockServer({})
      renderPicker()
      fireEvent.click(screen.getByTestId('room-discord-toggle'))

      const silent = await screen.findByTestId('room-discord-guild-g2')
      expect(silent).toBeDisabled()
      expect(screen.getByTestId('room-discord-guild-g2-hint')).toHaveTextContent(
        'No channel the bot can post in',
      )
      // The postable guild stays enabled.
      expect(screen.getByTestId('room-discord-guild-g1')).toBeEnabled()
    })

    it('renders the guild icon from the Discord CDN when present', async () => {
      mockServer({})
      renderPicker()
      fireEvent.click(screen.getByTestId('room-discord-toggle'))

      const guild = await screen.findByTestId('room-discord-guild-g1')
      expect(guild.querySelector('img')).toHaveAttribute(
        'src',
        'https://cdn.discordapp.com/icons/g1/iconhash.png',
      )
    })

    it('lists the channels of the chosen guild and can go back', async () => {
      mockServer({})
      renderPicker()
      fireEvent.click(screen.getByTestId('room-discord-toggle'))
      fireEvent.click(await screen.findByTestId('room-discord-guild-g1'))

      expect(screen.getByTestId('room-discord-channel-c1')).toHaveTextContent('#general')
      expect(screen.getByTestId('room-discord-channel-c2')).toHaveTextContent('#dice')

      fireEvent.click(screen.getByTestId('room-discord-back'))
      expect(screen.getByTestId('room-discord-guild-g1')).toBeInTheDocument()
    })

    it('explains the empty state and hides the invite link when unset', async () => {
      mockServer({ targets: jsonResponse({ guilds: [] }) })
      renderPicker()
      fireEvent.click(screen.getByTestId('room-discord-toggle'))

      await screen.findByTestId('room-discord-empty')
      expect(screen.queryByTestId('room-discord-invite')).toBeNull()
    })

    it('offers the bot invite link when VITE_DISCORD_BOT_INVITE_URL is set', async () => {
      vi.stubEnv('VITE_DISCORD_BOT_INVITE_URL', 'https://discord.com/oauth2/authorize?x=1')
      mockServer({ targets: jsonResponse({ guilds: [] }) })
      renderPicker()
      fireEvent.click(screen.getByTestId('room-discord-toggle'))

      const link = await screen.findByTestId('room-discord-invite')
      expect(link).toHaveAttribute('href', 'https://discord.com/oauth2/authorize?x=1')
      expect(link).toHaveTextContent('Add the Dicesuki bot to your server')
    })

    it('surfaces a load failure with a retry that refetches', async () => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ error: 'DISCORD_DISABLED' }, 503))
        .mockResolvedValueOnce(jsonResponse({ guilds: GUILDS }))
      vi.stubGlobal('fetch', fetchMock)

      renderPicker()
      fireEvent.click(screen.getByTestId('room-discord-toggle'))

      expect(await screen.findByTestId('room-discord-load-error')).toHaveTextContent(
        'Discord posting is turned off on this server.',
      )
      fireEvent.click(screen.getByTestId('room-discord-retry'))
      await screen.findByTestId('room-discord-guild-g1')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('posting', () => {
    it('posts the chosen channel and confirms by name', async () => {
      // Arrange
      const fetchMock = mockServer({})

      // Act
      await openAndSelectGeneral()

      // Assert
      expect(await screen.findByTestId('room-discord-success')).toHaveTextContent(
        'Posted to #general',
      )
      const advertiseCall = fetchMock.mock.calls.find((call) =>
        String(call[0]).includes('/advertise'),
      )
      expect(String(advertiseCall?.[0])).toContain('/api/rooms/ROOM42/advertise')
      const init = advertiseCall?.[1] as RequestInit
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-test')
      expect(init.body).toBe(JSON.stringify({ channelId: 'c1' }))
    })

    it('lets the host cancel at the confirm step without posting', async () => {
      const fetchMock = mockServer({})
      renderPicker()
      fireEvent.click(screen.getByTestId('room-discord-toggle'))
      fireEvent.click(await screen.findByTestId('room-discord-guild-g1'))
      fireEvent.click(screen.getByTestId('room-discord-channel-c1'))
      fireEvent.click(screen.getByTestId('room-discord-cancel'))

      expect(screen.getByTestId('room-discord-channel-c1')).toBeInTheDocument()
      expect(
        fetchMock.mock.calls.some((call) => String(call[0]).includes('/advertise')),
      ).toBe(false)
    })

    it.each([
      ['NOT_ROOM_HOST', 403, 'Only the room host can post this room to Discord.'],
      [
        'CHANNEL_NOT_VERIFIED',
        403,
        "You can't post to that channel. Pick one from your own servers.",
      ],
      ['NO_DISCORD_IDENTITY', 403, 'Link your Discord account to post rooms.'],
      ['ROOM_NOT_FOUND', 404, 'This room is no longer on the server.'],
      [
        'TOO_MANY_ADVERTS',
        409,
        'This room has already been posted to as many channels as allowed.',
      ],
      ['RATE_LIMITED', 429, 'Too many requests — try again in a few seconds.'],
      ['DISCORD_DISABLED', 503, 'Discord posting is turned off on this server.'],
      ['AUTH_REQUIRED', 401, 'Your sign-in expired. Sign in again and retry.'],
      ['AUTH_INVALID', 401, 'Your sign-in expired. Sign in again and retry.'],
    ] as const)('renders the %s message', async (code, status, message) => {
      mockServer({ advertise: jsonResponse({ error: code }, status) })
      await openAndSelectGeneral()

      expect(await screen.findByTestId('room-discord-post-error')).toHaveTextContent(message)
      expect(screen.queryByTestId('room-discord-success')).toBeNull()
    })

    it('reports an unreachable server as a network failure', async () => {
      const fetchMock = vi.fn<typeof fetch>(async (input) => {
        if (String(input).includes('/advertise')) throw new Error('offline')
        return jsonResponse({ guilds: GUILDS })
      })
      vi.stubGlobal('fetch', fetchMock)

      await openAndSelectGeneral()

      expect(await screen.findByTestId('room-discord-post-error')).toHaveTextContent(
        "Couldn't reach the room server. Check your connection and retry.",
      )
    })

    it('does not carry a success line into a reopened picker', async () => {
      // Arrange — post once, then close and reopen the picker.
      mockServer({})
      await openAndSelectGeneral()
      await screen.findByTestId('room-discord-success')

      // Act
      fireEvent.click(screen.getByTestId('room-discord-toggle')) // close
      fireEvent.click(screen.getByTestId('room-discord-toggle')) // reopen

      // Assert — a stale "Posted to #general" must not greet the next pick.
      expect(screen.queryByTestId('room-discord-success')).toBeNull()
    })

    it('does not carry a success line into a second post in the same session', async () => {
      // Arrange — post to #general, then walk to #dice without closing.
      mockServer({})
      await openAndSelectGeneral()
      await screen.findByTestId('room-discord-success')

      // Act
      fireEvent.click(screen.getByTestId('room-discord-guild-g1'))
      fireEvent.click(screen.getByTestId('room-discord-channel-c2'))

      // Assert — the confirm step for #dice shows no stale #general line.
      expect(screen.queryByTestId('room-discord-success')).toBeNull()

      // And the new post reports its own channel, never the previous one.
      fireEvent.click(screen.getByTestId('room-discord-confirm'))
      expect(await screen.findByTestId('room-discord-success')).toHaveTextContent(
        'Posted to #dice',
      )
    })

    it('clears a previous success while a new post is in flight', async () => {
      // Arrange — hold the second advertise open so the in-flight state is
      // observable: the success line must already be gone at that point.
      let releaseSecond: (value: Response) => void = () => {}
      let advertiseCalls = 0
      const fetchMock = vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.includes('/api/discord/targets')) return jsonResponse({ guilds: GUILDS })
        advertiseCalls += 1
        if (advertiseCalls === 1) return jsonResponse({ roomId: 'ROOM42' }, 202)
        return new Promise<Response>((resolve) => {
          releaseSecond = resolve
        })
      })
      vi.stubGlobal('fetch', fetchMock)

      await openAndSelectGeneral()
      await screen.findByTestId('room-discord-success')

      // Act — start a second post and stop at the in-flight state.
      fireEvent.click(screen.getByTestId('room-discord-guild-g1'))
      fireEvent.click(screen.getByTestId('room-discord-channel-c2'))
      fireEvent.click(screen.getByTestId('room-discord-confirm'))

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('room-discord-confirm')).toHaveTextContent('Posting…')
      })
      expect(screen.queryByTestId('room-discord-success')).toBeNull()

      releaseSecond(jsonResponse({ roomId: 'ROOM42' }, 202))
      expect(await screen.findByTestId('room-discord-success')).toHaveTextContent(
        'Posted to #dice',
      )
    })

    it('marks an already-posted channel on a second visit', async () => {
      mockServer({})
      await openAndSelectGeneral()
      await screen.findByTestId('room-discord-success')

      // Walk back in: the channel we posted to is flagged.
      fireEvent.click(screen.getByTestId('room-discord-guild-g1'))
      await waitFor(() => {
        expect(screen.getByTestId('room-discord-channel-c1')).toHaveTextContent('Posted')
      })
      expect(screen.getByTestId('room-discord-channel-c2')).not.toHaveTextContent('Posted')
    })
  })
})
