import {
  READINESS_MAX_RETRIES,
  READINESS_RETRY_DELAY_MS,
  READINESS_RETRY_STATUSES,
  type ReadinessRetryInfo,
} from './multiplayerServer'

/**
 * Preflight a room link before opening a WebSocket (issue #78). A `404` means the
 * room is gone (expired/cleaned up); a network failure means the server is
 * unreachable. Catching these here gives a fast, kind message instead of waiting
 * out the WS reconnect backoff. `'ok'` means the room exists and we may connect.
 */
export type PreflightResult = 'ok' | 'room-gone' | 'server-down'

export interface PreflightOptions {
  /** Retries after the first attempt. Defaults to {@link READINESS_MAX_RETRIES}. */
  maxRetries?: number
  /** Delay between attempts in ms. Defaults to {@link READINESS_RETRY_DELAY_MS}. */
  retryDelayMs?: number
  /** Fires before each backoff wait so the UI can show a "waking" state. */
  onRetry?: (info: ReadinessRetryInfo) => void
  /** Injectable delay, for tests. */
  sleepImpl?: (ms: number) => Promise<void>
  /** Injectable fetch, for tests. */
  fetchImpl?: typeof fetch
}

function preflightSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function attemptPreflight(
  fetchImpl: typeof fetch,
  httpUrl: string,
  roomId: string,
): Promise<{ result: PreflightResult; retryable: boolean }> {
  try {
    const response = await fetchImpl(`${httpUrl}/api/rooms/${encodeURIComponent(roomId)}`)
    // A 404 is authoritative: the room is gone (a restarted server also loses
    // its in-memory rooms), so retrying can't bring it back. Retry only the
    // transient cold-start / deploy blips.
    if (response.status === 404) return { result: 'room-gone', retryable: false }
    if (!response.ok) {
      return { result: 'server-down', retryable: READINESS_RETRY_STATUSES.has(response.status) }
    }
    return { result: 'ok', retryable: false }
  } catch {
    return { result: 'server-down', retryable: true }
  }
}

/**
 * Preflight with retry through cold starts (#109): a public room server on
 * Render can answer 502/503 (or drop the connection) for a few seconds after
 * spinning down, so retry transient failures before giving up.
 */
export async function preflightRoom(
  httpUrl: string,
  roomId: string,
  options: PreflightOptions = {},
): Promise<PreflightResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const maxRetries = options.maxRetries ?? READINESS_MAX_RETRIES
  const retryDelayMs = options.retryDelayMs ?? READINESS_RETRY_DELAY_MS
  const sleep = options.sleepImpl ?? preflightSleep

  let lastResult: PreflightResult = 'server-down'
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const outcome = await attemptPreflight(fetchImpl, httpUrl, roomId)
    if (outcome.result === 'ok' || !outcome.retryable) return outcome.result
    lastResult = outcome.result
    if (attempt < maxRetries) {
      options.onRetry?.({ attempt: attempt + 1, maxRetries, reason: outcome.result })
      await sleep(retryDelayMs)
    }
  }
  return lastResult
}
