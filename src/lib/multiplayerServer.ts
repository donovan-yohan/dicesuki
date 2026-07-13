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

interface ReadinessOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const DEFAULT_PUBLIC_WS_URL = 'ws://localhost:8080'
const DEFAULT_LOCAL_LOOPBACK_WS_URL = 'ws://127.0.0.1:8080'
const LOCAL_ROOM_START_COMMAND = 'npm run dev:local-room'
const READINESS_TIMEOUT_MS = 2_500

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

export async function checkRoomServerReadiness(
  config: RoomServerConfig,
  options: ReadinessOptions = {},
): Promise<RoomServerReadiness> {
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
        state: 'unavailable',
        ok: false,
        message: `${config.label} answered /health with HTTP ${response.status}.`,
        command: config.startCommand,
      }
    }

    let body: { status?: unknown; instanceId?: unknown }
    try {
      body = await response.json() as { status?: unknown; instanceId?: unknown }
    } catch {
      return {
        state: 'port-conflict',
        ok: false,
        message: `${config.httpUrl} is responding, but /health did not return the Dicesuki room server payload. Another app may be using the port.`,
        command: config.startCommand,
      }
    }

    if (body.status === 'ok' && typeof body.instanceId === 'string') {
      return {
        state: 'ready',
        ok: true,
        message: `${config.label} is ready.`,
        command: config.startCommand,
      }
    }

    return {
      state: 'port-conflict',
      ok: false,
      message: `${config.httpUrl} is responding, but it does not look like the Dicesuki room server. Another app may be using the port.`,
      command: config.startCommand,
    }
  } catch {
    return {
      state: 'unavailable',
      ok: false,
      message: `${config.label} is not reachable at ${config.httpUrl}.`,
      command: config.startCommand,
    }
  } finally {
    window.clearTimeout(timeout)
  }
}
