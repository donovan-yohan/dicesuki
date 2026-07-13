export type RoomServerMode = 'public' | 'local-loopback'

export type RoomServerReadinessState = 'ready' | 'unavailable' | 'port-conflict'

export interface RoomServerConfig {
  mode: RoomServerMode
  label: string
  wsUrl: string
  httpUrl: string
  startCommand: string | null
}

export interface RoomServerReadiness {
  state: RoomServerReadinessState
  ok: boolean
  message: string
  command: string | null
}

/** Details passed to {@link ReadinessOptions.onRetry} before each retry wait. */
export interface ReadinessRetryInfo {
  /** 1-based index of the retry about to be attempted (1 == first retry). */
  attempt: number
  /** Total number of retries that will be attempted before giving up. */
  maxRetries: number
  /** The transient failure that triggered the retry (message from the attempt). */
  reason: string
}

interface ReadinessOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /**
   * Number of retries after the first attempt. Defaults per mode: public servers
   * retry through cold starts ({@link READINESS_MAX_RETRIES}); local loopback
   * fast-fails (0) because localhost never cold-starts and long waits there hide
   * real errors (#109).
   */
  maxRetries?: number
  /** Delay between attempts in ms. Defaults to {@link READINESS_RETRY_DELAY_MS}. */
  retryDelayMs?: number
  /** Called once before each backoff wait so the UI can surface a "waking" state. */
  onRetry?: (info: ReadinessRetryInfo) => void
  /** Injectable delay, for tests. Defaults to a `setTimeout`-based sleep. */
  sleepImpl?: (ms: number) => Promise<void>
}

const DEFAULT_PUBLIC_WS_URL = 'ws://localhost:8080'
const DEFAULT_LOCAL_LOOPBACK_WS_URL = 'ws://127.0.0.1:8080'
const LOCAL_ROOM_START_COMMAND = 'npm run dev:local-room'
const READINESS_TIMEOUT_MS = 2_500

/**
 * Retry tuning for public room-server readiness (#109). Render free-tier
 * instances spin down when idle and have no zero-downtime deploys, so a cold
 * start or mid-deploy blip answers /health with 404/502/503 (or a network
 * error) for a few seconds before becoming ready.
 *
 * Policy: 4 retries (5 attempts total) at a fixed 2.5s spacing. That covers a
 * ~10s+ readiness window (plus per-attempt request timeouts) — long enough to
 * ride out a typical warm-up blip, short enough that a truly-down server still
 * surfaces a clear error before the user gives up. Beyond this the user can
 * simply retry manually rather than stare at a spinner for a full cold start.
 */
export const READINESS_MAX_RETRIES = 4
/** Fixed backoff between readiness attempts, in ms (see {@link READINESS_MAX_RETRIES}). */
export const READINESS_RETRY_DELAY_MS = 2_500
/** Transient HTTP statuses that warrant a readiness retry (cold start / deploy blip). */
export const READINESS_RETRY_STATUSES = new Set([404, 502, 503])

function readinessSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function readEnv(key: keyof ImportMetaEnv): string | undefined {
  try {
    return import.meta.env?.[key]
  } catch {
    return undefined
  }
}

function toHttpUrl(serverUrl: string): string {
  if (serverUrl.startsWith('ws://')) {
    return `http://${serverUrl.slice('ws://'.length)}`
  }
  if (serverUrl.startsWith('wss://')) {
    return `https://${serverUrl.slice('wss://'.length)}`
  }
  return serverUrl
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '')
}

export function getRoomServerConfig(mode: RoomServerMode = 'public'): RoomServerConfig {
  if (mode === 'local-loopback') {
    const wsUrl = normalizeBaseUrl(readEnv('VITE_LOCAL_ROOM_SERVER_URL') || DEFAULT_LOCAL_LOOPBACK_WS_URL)
    return {
      mode,
      label: 'Local loopback room server',
      wsUrl,
      httpUrl: normalizeBaseUrl(readEnv('VITE_LOCAL_ROOM_SERVER_HTTP_URL') || toHttpUrl(wsUrl)),
      startCommand: LOCAL_ROOM_START_COMMAND,
    }
  }

  const wsUrl = normalizeBaseUrl(readEnv('VITE_MULTIPLAYER_SERVER_URL') || DEFAULT_PUBLIC_WS_URL)
  return {
    mode,
    label: 'Public multiplayer server',
    wsUrl,
    httpUrl: normalizeBaseUrl(readEnv('VITE_MULTIPLAYER_SERVER_HTTP_URL') || toHttpUrl(wsUrl)),
    startCommand: null,
  }
}

/**
 * Returns the WebSocket URL for the selected room server.
 * Public multiplayer and local loopback modes intentionally use separate env keys.
 */
export function getWsServerUrl(mode: RoomServerMode = 'public'): string {
  return getRoomServerConfig(mode).wsUrl
}

/**
 * Returns the HTTP URL for the selected room server REST API.
 */
export function getHttpServerUrl(mode: RoomServerMode = 'public'): string {
  return getRoomServerConfig(mode).httpUrl
}

/**
 * A single public room as returned by the server's `GET /api/rooms` listing (#79).
 * `name` and `themeId` are null when the host has not set them.
 */
export interface PublicRoomEntry {
  roomId: string
  name: string | null
  playerCount: number
  themeId: string | null
}

/** The paginated public room listing response shape. */
export interface PublicRoomsPage {
  rooms: PublicRoomEntry[]
  page: number
  pageSize: number
  total: number
}

interface FetchPublicRoomsOptions {
  page?: number
  pageSize?: number
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

/**
 * Fetch a page of public rooms from the room server's listing endpoint. Returns
 * a normalized {@link PublicRoomsPage}; throws on network error or non-OK status
 * so callers can surface an actionable message.
 */
export async function fetchPublicRooms(
  config: RoomServerConfig,
  options: FetchPublicRoomsOptions = {},
): Promise<PublicRoomsPage> {
  const fetchImpl = options.fetchImpl || fetch
  const params = new URLSearchParams()
  if (options.page !== undefined) params.set('page', String(options.page))
  if (options.pageSize !== undefined) params.set('pageSize', String(options.pageSize))
  const query = params.toString()
  const url = `${config.httpUrl}/api/rooms${query ? `?${query}` : ''}`

  const response = await fetchImpl(url, { method: 'GET', signal: options.signal })
  if (!response.ok) {
    throw new Error(`Room listing request failed with HTTP ${response.status}`)
  }
  const body = await response.json() as Partial<PublicRoomsPage>
  return {
    rooms: Array.isArray(body.rooms) ? body.rooms : [],
    page: typeof body.page === 'number' ? body.page : 0,
    pageSize: typeof body.pageSize === 'number' ? body.pageSize : 0,
    total: typeof body.total === 'number' ? body.total : 0,
  }
}

/** Result of a single readiness attempt, tagged with whether a retry may help. */
interface ReadinessAttempt {
  readiness: RoomServerReadiness
  /** True only for transient failures (network error / 404·502·503) worth retrying. */
  retryable: boolean
}

async function attemptRoomServerReadiness(
  config: RoomServerConfig,
  options: ReadinessOptions,
): Promise<ReadinessAttempt> {
  const fetchImpl = options.fetchImpl || fetch
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || READINESS_TIMEOUT_MS)

  try {
    const response = await fetchImpl(`${config.httpUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        retryable: READINESS_RETRY_STATUSES.has(response.status),
        readiness: {
          state: 'unavailable',
          ok: false,
          message: `${config.label} answered /health with HTTP ${response.status}.`,
          command: config.startCommand,
        },
      }
    }

    let body: { status?: unknown; instanceId?: unknown }
    try {
      body = await response.json() as { status?: unknown; instanceId?: unknown }
    } catch {
      // A parseable-failure means *something* is answering with the wrong
      // payload: a different app on the port, not a warming server. Don't retry.
      return {
        retryable: false,
        readiness: {
          state: 'port-conflict',
          ok: false,
          message: `${config.httpUrl} is responding, but /health did not return the Dicesuki room server payload. Another app may be using the port.`,
          command: config.startCommand,
        },
      }
    }

    if (body.status === 'ok' && typeof body.instanceId === 'string') {
      return {
        retryable: false,
        readiness: {
          state: 'ready',
          ok: true,
          message: `${config.label} is ready.`,
          command: config.startCommand,
        },
      }
    }

    return {
      retryable: false,
      readiness: {
        state: 'port-conflict',
        ok: false,
        message: `${config.httpUrl} is responding, but it does not look like the Dicesuki room server. Another app may be using the port.`,
        command: config.startCommand,
      },
    }
  } catch {
    return {
      retryable: true,
      readiness: {
        state: 'unavailable',
        ok: false,
        message: `${config.label} is not reachable at ${config.httpUrl}.`,
        command: config.startCommand,
      },
    }
  } finally {
    window.clearTimeout(timeout)
  }
}

/**
 * Probe the room server's /health endpoint, retrying transient failures
 * (network errors and HTTP 404/502/503) through cold starts and deploy blips
 * before giving up (#109). Public servers retry per {@link READINESS_MAX_RETRIES};
 * local loopback fast-fails so real misconfiguration surfaces immediately.
 *
 * On success or a definitive failure (port conflict / non-transient status) it
 * returns straight away. `onRetry` fires before each backoff wait so callers can
 * surface a "server waking up, retrying…" state.
 */
export async function checkRoomServerReadiness(
  config: RoomServerConfig,
  options: ReadinessOptions = {},
): Promise<RoomServerReadiness> {
  const maxRetries =
    options.maxRetries ?? (config.mode === 'local-loopback' ? 0 : READINESS_MAX_RETRIES)
  const retryDelayMs = options.retryDelayMs ?? READINESS_RETRY_DELAY_MS
  const sleep = options.sleepImpl ?? readinessSleep

  let lastReadiness: RoomServerReadiness | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const outcome = await attemptRoomServerReadiness(config, options)
    if (outcome.readiness.ok || !outcome.retryable) {
      return outcome.readiness
    }
    lastReadiness = outcome.readiness
    if (attempt < maxRetries) {
      options.onRetry?.({
        attempt: attempt + 1,
        maxRetries,
        reason: outcome.readiness.message,
      })
      await sleep(retryDelayMs)
    }
  }
  // Exhausted all retries — surface the last transient failure as the error.
  return lastReadiness as RoomServerReadiness
}
