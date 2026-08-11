import {
  isColdStartAborted,
  runColdStartWait,
  type ColdStartProgress,
  type ColdStartWaitOptions,
} from './coldStartWait'

/**
 * Room-server target. Solo no longer uses a native loopback server — it runs
 * in-browser against the WASM room worker (issue #114) — so `'public'` is the
 * only network room server that remains.
 */
export type RoomServerMode = 'public'

/**
 * `'aborted'` is not a server condition: it means the caller (usually an
 * unmounting component) cancelled the staged wait, and the result must be
 * dropped rather than rendered.
 */
export type RoomServerReadinessState = 'ready' | 'unavailable' | 'port-conflict' | 'aborted'

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

/**
 * Readiness options: the staged cold-start knobs (see {@link ColdStartWaitOptions})
 * plus this module's own injectables.
 */
export interface ReadinessOptions
  extends Pick<
    ColdStartWaitOptions,
    'phase2AtMs' | 'deadlineMs' | 'attemptTimeoutMs' | 'progressTickMs' | 'signal' | 'sleepImpl' | 'nowImpl'
  > {
  fetchImpl?: typeof fetch
  /**
   * Fires after each failed probe and on every progress tick while waiting, so
   * the UI can flip to cold-start copy and show elapsed time.
   */
  onProgress?: (progress: ColdStartProgress) => void
}

const DEFAULT_PUBLIC_WS_URL = 'ws://localhost:8080'

/** Transient HTTP statuses that mean "still waking", not "broken". */
export const READINESS_RETRY_STATUSES = new Set([404, 502, 503])

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
 * Returns the WebSocket URL for the public multiplayer room server.
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
  attemptTimeoutMs: number,
): Promise<ReadinessAttempt> {
  const fetchImpl = options.fetchImpl || fetch
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), attemptTimeoutMs)

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
 * Probe the room server's /health endpoint on the staged cold-start schedule
 * (see `coldStartWait.ts`): poll through the ~81s Render free-tier wake-up,
 * switching the caller's UI to honest cold-start copy at 30s and giving up only
 * after ~3 minutes.
 *
 * Both a dropped connection and a per-attempt timeout count as "still waking",
 * because a cold container does both. Success or a definitive failure (port
 * conflict / non-transient status) returns straight away, so the caller can
 * continue into the create flow with no extra click.
 *
 * On abort (caller unmounted) it resolves to a `'aborted'` readiness the caller
 * must ignore rather than render.
 */
export async function checkRoomServerReadiness(
  config: RoomServerConfig,
  options: ReadinessOptions = {},
): Promise<RoomServerReadiness> {
  try {
    return await runColdStartWait<RoomServerReadiness>(
      async ({ attemptTimeoutMs }) => {
        const outcome = await attemptRoomServerReadiness(config, options, attemptTimeoutMs)
        return {
          done: outcome.readiness.ok || !outcome.retryable,
          value: outcome.readiness,
        }
      },
      {
        phase2AtMs: options.phase2AtMs,
        deadlineMs: options.deadlineMs,
        attemptTimeoutMs: options.attemptTimeoutMs,
        progressTickMs: options.progressTickMs,
        signal: options.signal,
        sleepImpl: options.sleepImpl,
        nowImpl: options.nowImpl,
        onProgress: options.onProgress,
      },
    )
  } catch (error) {
    if (isColdStartAborted(error)) {
      return {
        state: 'aborted',
        ok: false,
        message: `${config.label} readiness check was cancelled.`,
        command: config.startCommand,
      }
    }
    throw error
  }
}
