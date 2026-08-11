import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkRoomServerReadiness,
  getHttpServerUrl,
  getRoomServerConfig,
  getWsServerUrl,
  type RoomServerConfig,
} from './multiplayerServer'
import { COLDSTART_DEADLINE_MS, COLDSTART_PHASE2_AT_MS } from './coldStartWait'

function useStagedFakeTimers() {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
}

function okHealth(): Response {
  return { ok: true, status: 200, json: async () => ({ status: 'ok', instanceId: 'srv123' }) } as Response
}

function statusResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as Response
}

describe('multiplayerServer config', () => {
  it('resolves the public multiplayer room server config', () => {
    expect(getWsServerUrl('public')).toBe('ws://localhost:8080')
    expect(getHttpServerUrl('public')).toBe('http://localhost:8080')

    const config = getRoomServerConfig('public')
    expect(config.mode).toBe('public')
    expect(config.label).toBe('Public multiplayer server')
    expect(config.startCommand).toBeNull()
  })
})

describe('checkRoomServerReadiness', () => {
  const config: RoomServerConfig = {
    mode: 'public',
    label: 'Public multiplayer server',
    wsUrl: 'ws://localhost:8080',
    httpUrl: 'http://localhost:8080',
    startCommand: null,
  }

  it('reports ready when the Dicesuki health payload responds', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', instanceId: 'srv123' }),
    } as Response)

    await expect(checkRoomServerReadiness(config, { fetchImpl })).resolves.toMatchObject({
      ok: true,
      state: 'ready',
    })
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:8080/health', expect.objectContaining({ method: 'GET' }))
  })

  // Port-conflict and unreachable each had a second, weaker copy here that
  // asserted the same state without the call-count. They were merged into the
  // staged-wait suite below, which pins both the state and the polling shape.

  it('gives up with an unavailable readiness once the deadline expires', async () => {
    useStagedFakeTimers()
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))

    const promise = checkRoomServerReadiness(config, { fetchImpl })
    await vi.advanceTimersByTimeAsync(COLDSTART_DEADLINE_MS + 10_000)

    await expect(promise).resolves.toMatchObject({
      ok: false,
      state: 'unavailable',
      command: null,
    })
    vi.useRealTimers()
  })
})

describe('checkRoomServerReadiness staged cold-start wait', () => {
  const publicConfig: RoomServerConfig = {
    mode: 'public',
    label: 'Public multiplayer server',
    wsUrl: 'wss://rooms.example.com',
    httpUrl: 'https://rooms.example.com',
    startCommand: null,
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls through transient statuses and succeeds (404 → 404 → 200)', async () => {
    useStagedFakeTimers()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(statusResponse(404))
      .mockResolvedValueOnce(statusResponse(404))
      .mockResolvedValueOnce(okHealth())
    const onProgress = vi.fn()

    const promise = checkRoomServerReadiness(publicConfig, { fetchImpl, onProgress })
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(promise).resolves.toMatchObject({ ok: true, state: 'ready' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    // Under 30s the caller stays on the ordinary "checking" copy.
    expect(onProgress.mock.calls.every(([p]) => p.phase === 'connecting')).toBe(true)
  })

  it('polls network errors before succeeding', async () => {
    useStagedFakeTimers()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okHealth())

    const promise = checkRoomServerReadiness(publicConfig, { fetchImpl })
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(promise).resolves.toMatchObject({ ok: true, state: 'ready' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('switches to the waking phase at 30s and keeps polling past the old 12s budget', async () => {
    useStagedFakeTimers()
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(statusResponse(503))
    const onProgress = vi.fn()

    const promise = checkRoomServerReadiness(publicConfig, { fetchImpl, onProgress })

    await vi.advanceTimersByTimeAsync(COLDSTART_PHASE2_AT_MS - 1_000)
    expect(onProgress.mock.calls.at(-1)?.[0].phase).toBe('connecting')

    await vi.advanceTimersByTimeAsync(2_000)
    expect(onProgress.mock.calls.at(-1)?.[0].phase).toBe('waking')
    // Still probing at ~81s, where the old fixed-retry policy had long given up.
    const callsAt31s = fetchImpl.mock.calls.length
    await vi.advanceTimersByTimeAsync(50_000)
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(callsAt31s)

    await vi.advanceTimersByTimeAsync(COLDSTART_DEADLINE_MS)
    await expect(promise).resolves.toMatchObject({ ok: false, state: 'unavailable' })
  })

  it('resolves as ready the moment a sleeping server answers mid-wait', async () => {
    useStagedFakeTimers()
    const wakesAt = performance.now() + COLDSTART_PHASE2_AT_MS + 20_000
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        performance.now() >= wakesAt ? okHealth() : statusResponse(503),
      )

    const promise = checkRoomServerReadiness(publicConfig, { fetchImpl })
    await vi.advanceTimersByTimeAsync(COLDSTART_PHASE2_AT_MS + 30_000)

    await expect(promise).resolves.toMatchObject({ ok: true, state: 'ready' })
  })

  it('reports an aborted readiness when the caller cancels the wait', async () => {
    useStagedFakeTimers()
    const controller = new AbortController()
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(statusResponse(503))

    const promise = checkRoomServerReadiness(publicConfig, { fetchImpl, signal: controller.signal })
    await vi.advanceTimersByTimeAsync(4_000)
    controller.abort()
    await vi.advanceTimersByTimeAsync(2_000)

    await expect(promise).resolves.toMatchObject({ ok: false, state: 'aborted' })
  })

  it('does not poll a non-transient status (e.g. HTTP 500)', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(statusResponse(500))

    await expect(checkRoomServerReadiness(publicConfig, { fetchImpl })).resolves.toMatchObject({
      ok: false,
      state: 'unavailable',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not poll a port conflict (wrong payload from another app)', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      { ok: true, status: 200, json: async () => ({ status: 'ok' }) } as Response,
    )

    await expect(checkRoomServerReadiness(publicConfig, { fetchImpl })).resolves.toMatchObject({
      ok: false,
      state: 'port-conflict',
      command: null,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
