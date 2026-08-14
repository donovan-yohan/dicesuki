import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COLDSTART_DEADLINE_MS,
  COLDSTART_PHASE1_INTERVAL_MS,
  COLDSTART_PHASE1_MAX_INTERVAL_MS,
  COLDSTART_PHASE2_AT_MS,
  COLDSTART_PHASE2_INTERVAL_MS,
  coldStartGapMs,
  coldStartPhaseAt,
  formatColdStartElapsed,
  isColdStartAborted,
  runColdStartWait,
  type ColdStartProgress,
} from './coldStartWait'

/**
 * Fake both `performance` (the wait's clock, per Frontend-ADR-004) and the timer
 * APIs its sleeps use, so advancing timers advances elapsed time in lockstep.
 */
function useStagedFakeTimers() {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
}

describe('cold-start staging policy', () => {
  it('flips to the waking phase exactly at the 30s threshold', () => {
    expect(coldStartPhaseAt(0)).toBe('connecting')
    expect(coldStartPhaseAt(COLDSTART_PHASE2_AT_MS - 1)).toBe('connecting')
    expect(coldStartPhaseAt(COLDSTART_PHASE2_AT_MS)).toBe('waking')
    expect(coldStartPhaseAt(COLDSTART_DEADLINE_MS)).toBe('waking')
  })

  it('backs off gently in phase 1 and polls at a fixed <=5s cadence in phase 2', () => {
    expect(coldStartGapMs(1, 'connecting')).toBe(COLDSTART_PHASE1_INTERVAL_MS)
    expect(coldStartGapMs(2, 'connecting')).toBeGreaterThan(COLDSTART_PHASE1_INTERVAL_MS)
    expect(coldStartGapMs(20, 'connecting')).toBe(COLDSTART_PHASE1_MAX_INTERVAL_MS)
    expect(coldStartGapMs(1, 'waking')).toBe(COLDSTART_PHASE2_INTERVAL_MS)
    expect(COLDSTART_PHASE2_INTERVAL_MS).toBeLessThanOrEqual(5_000)
  })

  it('formats the elapsed progress hint in whole seconds', () => {
    expect(formatColdStartElapsed(0)).toBe('0s elapsed')
    expect(formatColdStartElapsed(48_900)).toBe('48s elapsed')
    expect(formatColdStartElapsed(-5)).toBe('0s elapsed')
  })
})

describe('runColdStartWait', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately when the first probe is done', async () => {
    const probe = vi.fn(async () => ({ done: true, value: 'ready' }))
    await expect(runColdStartWait(probe)).resolves.toBe('ready')
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('reports the connecting phase for the first 30s, then waking', async () => {
    useStagedFakeTimers()
    const phases: ColdStartProgress[] = []
    const promise = runColdStartWait(async () => ({ done: false, value: 'waiting' }), {
      onProgress: (p) => phases.push(p),
    })

    // Just before the threshold we are still an ordinary "checking" connection.
    await vi.advanceTimersByTimeAsync(COLDSTART_PHASE2_AT_MS - 1_000)
    expect(phases.at(-1)?.phase).toBe('connecting')

    // Crossing 30s flips the copy even though no probe outcome changed.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(phases.at(-1)?.phase).toBe('waking')
    expect(phases.at(-1)!.elapsedMs).toBeGreaterThanOrEqual(COLDSTART_PHASE2_AT_MS)

    await vi.advanceTimersByTimeAsync(COLDSTART_DEADLINE_MS)
    await expect(promise).resolves.toBe('waiting')
  })

  it('resolves as soon as a probe succeeds mid phase 2 (auto-continue)', async () => {
    useStagedFakeTimers()
    // The server answers 50s in — well into phase 2, well before the deadline.
    const succeedAt = performance.now() + COLDSTART_PHASE2_AT_MS + 20_000
    const probe = vi.fn(async () => {
      const up = performance.now() >= succeedAt
      return { done: up, value: up ? 'ready' : 'waiting' }
    })

    const promise = runColdStartWait(probe, {})
    // Well short of the 3-minute deadline: the wait must end on success, not
    // on exhaustion.
    await vi.advanceTimersByTimeAsync(COLDSTART_PHASE2_AT_MS + 30_000)

    await expect(promise).resolves.toBe('ready')
    const callsAtSuccess = probe.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(probe).toHaveBeenCalledTimes(callsAtSuccess)
  })

  it('polls at least every 5s in phase 2 so a mid-wait recovery is picked up fast', async () => {
    useStagedFakeTimers()
    const probe = vi.fn(async () => ({ done: false, value: 'waiting' }))
    const promise = runColdStartWait(probe, {})

    await vi.advanceTimersByTimeAsync(COLDSTART_PHASE2_AT_MS + 1_000)
    const before = probe.mock.calls.length
    await vi.advanceTimersByTimeAsync(20_000)
    // 20s of phase-2 polling at a 5s cadence is ~4 probes; assert we are not
    // silently stretching the gap.
    expect(probe.mock.calls.length - before).toBeGreaterThanOrEqual(3)

    await vi.advanceTimersByTimeAsync(COLDSTART_DEADLINE_MS)
    await expect(promise).resolves.toBe('waiting')
  })

  it('gives up with the last transient value after the 3-minute deadline', async () => {
    useStagedFakeTimers()
    const probe = vi.fn(async () => ({ done: false, value: 'server-down' }))
    const promise = runColdStartWait(probe, {})

    // Nothing resolves before the deadline.
    let settled = false
    void promise.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(COLDSTART_DEADLINE_MS - 5_000)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(10_000)
    await expect(promise).resolves.toBe('server-down')
  })

  it('clamps each probe budget to the remaining deadline', async () => {
    useStagedFakeTimers()
    const budgets: number[] = []
    const promise = runColdStartWait(
      async ({ attemptTimeoutMs }) => {
        budgets.push(attemptTimeoutMs)
        return { done: false, value: 'waiting' }
      },
      { deadlineMs: 5_000, attemptTimeoutMs: 8_000 },
    )
    await vi.advanceTimersByTimeAsync(10_000)
    await promise

    expect(budgets[0]).toBe(5_000)
    expect(Math.max(...budgets)).toBeLessThanOrEqual(5_000)
  })

  it('aborts the wait without resolving normally when the signal fires', async () => {
    useStagedFakeTimers()
    const controller = new AbortController()
    const probe = vi.fn(async () => ({ done: false, value: 'waiting' }))
    const promise = runColdStartWait(probe, { signal: controller.signal })
    const caught = promise.catch((error) => error)

    await vi.advanceTimersByTimeAsync(4_000)
    controller.abort()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(isColdStartAborted(await caught)).toBe(true)
    const callsAtAbort = probe.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(probe).toHaveBeenCalledTimes(callsAtAbort)
  })

  it('leaves no armed timer behind when the signal aborts mid-gap', async () => {
    useStagedFakeTimers()
    const controller = new AbortController()
    const promise = runColdStartWait(async () => ({ done: false, value: 'waiting' }), {
      signal: controller.signal,
    })
    void promise.catch(() => {})

    // Land inside an inter-probe gap, where a sleep timer is armed.
    await vi.advanceTimersByTimeAsync(2_500)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    // The orphaned timeout must be cleared, not left to fire later.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not accumulate abort listeners across a long wait', async () => {
    useStagedFakeTimers()
    const controller = new AbortController()
    const addSpy = vi.spyOn(controller.signal, 'addEventListener')
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')

    const promise = runColdStartWait(async () => ({ done: false, value: 'waiting' }), {
      signal: controller.signal,
      deadlineMs: 30_000,
    })
    await vi.advanceTimersByTimeAsync(35_000)
    await promise

    // Every sleep that resolved normally dropped its listener again.
    expect(addSpy.mock.calls.length).toBeGreaterThan(5)
    expect(removeSpy).toHaveBeenCalledTimes(addSpy.mock.calls.length)
  })
})
