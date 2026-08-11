/**
 * Staged cold-start wait for the public room server (#109 follow-up).
 *
 * The public room server runs on Render's free tier: it spins down after ~15
 * minutes of idleness and a measured cold start takes ~81 seconds. A single
 * short health probe (or a handful of 2.5s retries) always expires long before
 * the container is back, so the user was shown a hard "server is not reachable"
 * error for what is really a wake-up delay.
 *
 * This module owns the one staged policy both room entry points share
 * ({@link ../lib/multiplayerServer.checkRoomServerReadiness} for room creation
 * and {@link ../lib/roomPreflight.preflightRoom} for joining a room link):
 *
 * | Phase        | Window        | UI                                   | Poll gap   |
 * |--------------|---------------|--------------------------------------|------------|
 * | `connecting` | 0s – 30s      | ordinary "checking…" spinner          | 2s → 6s    |
 * | `waking`     | 30s – 3min    | honest cold-start copy + elapsed      | 5s (fixed) |
 * | (fail)       | after 3min    | existing server-down error + retry    | —          |
 *
 * A success at *any* point resolves immediately, so the caller continues
 * straight into the join/create flow with no extra click.
 *
 * Solo play runs the wasm room in-browser and never touches this path.
 */

/**
 * Per-probe request budget, in ms.
 *
 * Recommended range: 5_000–10_000. A cold Render container both drops
 * connections *and* holds them open without answering, so every probe needs its
 * own abort budget — otherwise one hung request eats the whole wait. 8s is long
 * enough for a genuinely slow-but-alive server on mobile data, short enough that
 * we still get ~4 probes into the first 30 seconds.
 */
export const COLDSTART_ATTEMPT_TIMEOUT_MS = 8_000

/**
 * Elapsed time at which the UI switches from "checking" to cold-start copy, in ms.
 *
 * Recommended range: 20_000–45_000. Below ~20s we cry wolf on an ordinary slow
 * network; above ~45s the user has already decided the app is broken. 30s is
 * comfortably past a warm server's worst case and well before the ~81s cold
 * start completes.
 */
export const COLDSTART_PHASE2_AT_MS = 30_000

/**
 * Total wait budget before surfacing a hard failure, in ms.
 *
 * Recommended range: 120_000–240_000. The measured cold start is ~81s; 3
 * minutes leaves better than 2x headroom for a slow deploy or a congested
 * network while still bounding how long a user stares at a truly dead server.
 */
export const COLDSTART_DEADLINE_MS = 180_000

/**
 * First inter-probe gap during phase 1, in ms.
 *
 * Recommended range: 1_500–3_000. Short enough that a warm server (or a server
 * that wakes early) is picked up almost immediately.
 */
export const COLDSTART_PHASE1_INTERVAL_MS = 2_000

/**
 * Ceiling for the phase-1 exponential backoff, in ms.
 *
 * Recommended range: 4_000–8_000. Keeps the gentle 1.5x backoff from stretching
 * past the point where phase 2's fixed cadence takes over.
 */
export const COLDSTART_PHASE1_MAX_INTERVAL_MS = 6_000

/** Growth factor applied to the phase-1 gap after each failed probe. */
export const COLDSTART_PHASE1_BACKOFF_FACTOR = 1.5

/**
 * Fixed inter-probe gap during phase 2, in ms.
 *
 * Recommended range: 3_000–5_000. Must stay at or below 5s so the first
 * successful health response mid-wait transitions the user promptly instead of
 * leaving them on the waking screen after the server is already up.
 */
export const COLDSTART_PHASE2_INTERVAL_MS = 5_000

/**
 * Cadence at which {@link ColdStartWaitOptions.onProgress} fires while waiting
 * between probes, in ms. Drives the elapsed-time hint and the phase flip, so it
 * must be well under {@link COLDSTART_PHASE2_INTERVAL_MS}.
 */
export const COLDSTART_PROGRESS_TICK_MS = 1_000

/** Which stage of the staged wait we are in. */
export type ColdStartPhase = 'connecting' | 'waking'

/** Snapshot handed to {@link ColdStartWaitOptions.onProgress}. */
export interface ColdStartProgress {
  phase: ColdStartPhase
  /** Milliseconds since the wait began. */
  elapsedMs: number
  /** Total budget before the wait gives up, in ms. */
  deadlineMs: number
  /** 1-based count of probes completed so far. */
  attempt: number
}

/** Context handed to each probe so it can size its own request budget. */
export interface ColdStartProbeContext {
  /** Abort budget for this probe, already clamped to the remaining deadline. */
  attemptTimeoutMs: number
  /** 1-based index of this probe. */
  attempt: number
  elapsedMs: number
  phase: ColdStartPhase
}

/** What a probe reports back: a value, and whether the wait is over. */
export interface ColdStartProbeResult<T> {
  /** True to stop the wait and resolve with `value` (success or hard failure). */
  done: boolean
  /** The outcome to resolve with, or the transient failure to remember. */
  value: T
}

export interface ColdStartWaitOptions {
  /** Overrides {@link COLDSTART_PHASE2_AT_MS}. */
  phase2AtMs?: number
  /** Overrides {@link COLDSTART_DEADLINE_MS}. */
  deadlineMs?: number
  /** Overrides {@link COLDSTART_ATTEMPT_TIMEOUT_MS}. */
  attemptTimeoutMs?: number
  /** Overrides {@link COLDSTART_PROGRESS_TICK_MS}. */
  progressTickMs?: number
  /** Fires after each probe and on every progress tick while waiting. */
  onProgress?: (progress: ColdStartProgress) => void
  /** Aborts the wait (e.g. the component unmounted). */
  signal?: AbortSignal
  /** Injectable delay, for tests. Defaults to a `setTimeout`-based sleep. */
  sleepImpl?: (ms: number) => Promise<void>
  /** Injectable clock, for tests. Defaults to `performance.now()`. */
  nowImpl?: () => number
}

/**
 * Honest phase-2 copy. The server really is asleep and really does take about a
 * minute and a half, so say so rather than implying something is broken.
 */
export const COLDSTART_WAKING_TITLE = 'Waking the dice server'
export const COLDSTART_WAKING_BODY =
  'Free hosting naps when idle. Usually under 2 minutes.'

/** Elapsed hint shown beside the phase-2 copy, e.g. `"48s elapsed"`. */
export function formatColdStartElapsed(elapsedMs: number): string {
  return `${Math.max(0, Math.floor(elapsedMs / 1000))}s elapsed`
}

/** Thrown when {@link ColdStartWaitOptions.signal} aborts an in-flight wait. */
export class ColdStartAbortedError extends Error {
  constructor() {
    super('Cold-start wait aborted')
    this.name = 'ColdStartAbortedError'
  }
}

/** Narrowing helper so callers can map an abort onto their own result type. */
export function isColdStartAborted(error: unknown): error is ColdStartAbortedError {
  return error instanceof ColdStartAbortedError
}

/**
 * Abort-aware sleep. The wait's inter-probe gap is the only place a caller can
 * unmount mid-flight, and a plain `setTimeout` would keep an orphaned timer
 * armed for up to a full poll interval after the abort throws out of the loop.
 * Cancel the timer on abort, and drop the listener on normal resolution so a
 * long wait doesn't accumulate one listener per tick.
 *
 * Resolves rather than rejects on abort: the caller re-checks the signal
 * immediately after every sleep and raises {@link ColdStartAbortedError} there,
 * keeping one abort path instead of two.
 */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const onAbort = () => {
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/** The stage a given elapsed time falls in. Phase 2 starts *at* the threshold. */
export function coldStartPhaseAt(elapsedMs: number, phase2AtMs = COLDSTART_PHASE2_AT_MS): ColdStartPhase {
  return elapsedMs >= phase2AtMs ? 'waking' : 'connecting'
}

/**
 * Gap before the next probe: a gentle 1.5x backoff (capped) while we still look
 * like an ordinary connection, then a fixed ≤5s cadence once we admit the server
 * is waking, so a mid-wait recovery is noticed promptly.
 */
export function coldStartGapMs(attempt: number, phase: ColdStartPhase): number {
  if (phase === 'waking') return COLDSTART_PHASE2_INTERVAL_MS
  const grown =
    COLDSTART_PHASE1_INTERVAL_MS * Math.pow(COLDSTART_PHASE1_BACKOFF_FACTOR, Math.max(0, attempt - 1))
  return Math.min(grown, COLDSTART_PHASE1_MAX_INTERVAL_MS)
}

/**
 * Drive `probe` on the staged schedule until it reports `done`, the deadline
 * expires, or the signal aborts.
 *
 * Returns the `done` value on success/hard failure, or the last transient value
 * once the deadline expires. Throws {@link ColdStartAbortedError} on abort so a
 * caller that unmounted can drop the result instead of setting state.
 */
export async function runColdStartWait<T>(
  probe: (context: ColdStartProbeContext) => Promise<ColdStartProbeResult<T>>,
  options: ColdStartWaitOptions = {},
): Promise<T> {
  const now = options.nowImpl ?? defaultNow
  const sleep = options.sleepImpl ?? ((ms: number) => defaultSleep(ms, options.signal))
  const phase2AtMs = options.phase2AtMs ?? COLDSTART_PHASE2_AT_MS
  const deadlineMs = options.deadlineMs ?? COLDSTART_DEADLINE_MS
  const attemptTimeoutMs = options.attemptTimeoutMs ?? COLDSTART_ATTEMPT_TIMEOUT_MS
  const tickMs = Math.max(1, options.progressTickMs ?? COLDSTART_PROGRESS_TICK_MS)

  const startedAt = now()
  const elapsed = () => now() - startedAt

  const throwIfAborted = () => {
    if (options.signal?.aborted) throw new ColdStartAbortedError()
  }

  let attempt = 0
  let lastValue: T | undefined

  const emit = () => {
    const elapsedMs = elapsed()
    options.onProgress?.({
      phase: coldStartPhaseAt(elapsedMs, phase2AtMs),
      elapsedMs,
      deadlineMs,
      attempt,
    })
  }

  for (;;) {
    throwIfAborted()
    const remaining = deadlineMs - elapsed()
    if (remaining <= 0) break

    attempt += 1
    const elapsedAtStart = elapsed()
    const outcome = await probe({
      // Never let one hung request outlive the overall budget.
      attemptTimeoutMs: Math.max(1, Math.min(attemptTimeoutMs, remaining)),
      attempt,
      elapsedMs: elapsedAtStart,
      phase: coldStartPhaseAt(elapsedAtStart, phase2AtMs),
    })
    lastValue = outcome.value
    if (outcome.done) return outcome.value

    throwIfAborted()
    emit()

    // Wait out the gap in progress-tick slices so the elapsed hint keeps moving
    // and the phase flips on time even between probes.
    const gapEndsAt = elapsed() + coldStartGapMs(attempt, coldStartPhaseAt(elapsed(), phase2AtMs))
    for (;;) {
      throwIfAborted()
      const nowElapsed = elapsed()
      const untilGapEnd = gapEndsAt - nowElapsed
      const untilDeadline = deadlineMs - nowElapsed
      const slice = Math.min(untilGapEnd, untilDeadline, tickMs)
      if (slice <= 0) break
      await sleep(slice)
      throwIfAborted()
      emit()
    }
  }

  throwIfAborted()
  // Deadline expired: surface the last transient failure as the hard error. At
  // least one probe always runs (the loop only breaks after the first pass), so
  // `lastValue` is populated.
  return lastValue as T
}
