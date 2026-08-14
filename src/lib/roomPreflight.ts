import {
  isColdStartAborted,
  runColdStartWait,
  type ColdStartProgress,
  type ColdStartWaitOptions,
} from './coldStartWait'
import { READINESS_RETRY_STATUSES } from './multiplayerServer'

/**
 * Preflight a room link before opening a WebSocket (issue #78). A `404` means the
 * room is gone (expired/cleaned up); a network failure means the server is
 * unreachable. Catching these here gives a fast, kind message instead of waiting
 * out the WS reconnect backoff. `'ok'` means the room exists and we may connect.
 *
 * `'aborted'` is not a server condition: the caller cancelled the staged wait
 * (usually by unmounting) and must drop the result instead of rendering it.
 */
export type PreflightResult = 'ok' | 'room-gone' | 'server-down' | 'aborted'

/**
 * Preflight options: the staged cold-start knobs (see {@link ColdStartWaitOptions})
 * plus this module's own injectables.
 */
export interface PreflightOptions
  extends Pick<
    ColdStartWaitOptions,
    'phase2AtMs' | 'deadlineMs' | 'attemptTimeoutMs' | 'progressTickMs' | 'signal' | 'sleepImpl' | 'nowImpl'
  > {
  /** Fires after each failed probe and on every progress tick while waiting. */
  onProgress?: (progress: ColdStartProgress) => void
  /** Injectable fetch, for tests. */
  fetchImpl?: typeof fetch
}

async function attemptPreflight(
  fetchImpl: typeof fetch,
  httpUrl: string,
  roomId: string,
  attemptTimeoutMs: number,
): Promise<{ result: PreflightResult; retryable: boolean }> {
  // A cold Render container can accept the connection and then never answer, so
  // each probe gets its own abort budget; an expired budget counts as "still
  // waking", exactly like a dropped connection.
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), attemptTimeoutMs)
  try {
    const response = await fetchImpl(`${httpUrl}/api/rooms/${encodeURIComponent(roomId)}`, {
      signal: controller.signal,
    })
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
  } finally {
    window.clearTimeout(timeout)
  }
}

/**
 * Preflight a room link on the staged cold-start schedule (see `coldStartWait.ts`).
 *
 * The public room server sleeps on Render's free tier and takes ~81s to wake, so
 * we poll through it: ordinary "checking" UI for the first 30s, honest
 * cold-start copy from 30s, hard failure only after ~3 minutes. Success at any
 * point resolves immediately so the caller joins with no extra click.
 */
export async function preflightRoom(
  httpUrl: string,
  roomId: string,
  options: PreflightOptions = {},
): Promise<PreflightResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  try {
    return await runColdStartWait<PreflightResult>(
      async ({ attemptTimeoutMs }) => {
        const outcome = await attemptPreflight(fetchImpl, httpUrl, roomId, attemptTimeoutMs)
        return { done: !outcome.retryable, value: outcome.result }
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
    if (isColdStartAborted(error)) return 'aborted'
    throw error
  }
}
