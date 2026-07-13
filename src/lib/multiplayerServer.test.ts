import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkRoomServerReadiness,
  getHttpServerUrl,
  getRoomServerConfig,
  getWsServerUrl,
  READINESS_MAX_RETRIES,
  type RoomServerConfig,
} from './multiplayerServer'

function okHealth(): Response {
  return { ok: true, status: 200, json: async () => ({ status: 'ok', instanceId: 'srv123' }) } as Response
}

function statusResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as Response
}

describe('multiplayerServer config', () => {
  it('keeps public multiplayer and local loopback config separate', () => {
    expect(getWsServerUrl('public')).toBe('ws://localhost:8080')
    expect(getHttpServerUrl('public')).toBe('http://localhost:8080')

    expect(getWsServerUrl('local-loopback')).toBe('ws://127.0.0.1:8080')
    expect(getHttpServerUrl('local-loopback')).toBe('http://127.0.0.1:8080')
    expect(getRoomServerConfig('local-loopback').startCommand).toBe('npm run dev:local-room')
  })
})

describe('checkRoomServerReadiness', () => {
  const config: RoomServerConfig = {
    mode: 'local-loopback',
    label: 'Local loopback room server',
    wsUrl: 'ws://127.0.0.1:8080',
    httpUrl: 'http://127.0.0.1:8080',
    startCommand: 'npm run dev:local-room',
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
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8080/health', expect.objectContaining({ method: 'GET' }))
  })

  it('reports a port conflict when another service answers on the loopback port', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
    } as Response)

    await expect(checkRoomServerReadiness(config, { fetchImpl })).resolves.toMatchObject({
      ok: false,
      state: 'port-conflict',
      command: 'npm run dev:local-room',
    })
  })

  it('reports unavailable when the server cannot be reached', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(checkRoomServerReadiness(config, { fetchImpl })).resolves.toMatchObject({
      ok: false,
      state: 'unavailable',
      command: 'npm run dev:local-room',
    })
  })

  it('does not retry in local-loopback mode (fast-fail preserved, #109)', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(checkRoomServerReadiness(config, { fetchImpl })).resolves.toMatchObject({
      ok: false,
      state: 'unavailable',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('checkRoomServerReadiness retry through cold starts (#109)', () => {
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

  it('retries transient statuses and succeeds (404 → 404 → 200)', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(statusResponse(404))
      .mockResolvedValueOnce(statusResponse(404))
      .mockResolvedValueOnce(okHealth())
    const onRetry = vi.fn()

    const promise = checkRoomServerReadiness(publicConfig, { fetchImpl, onRetry })
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toMatchObject({ ok: true, state: 'ready' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenLastCalledWith(
      expect.objectContaining({ attempt: 2, maxRetries: READINESS_MAX_RETRIES }),
    )
  })

  it('retries network errors before succeeding', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okHealth())

    const promise = checkRoomServerReadiness(publicConfig, { fetchImpl })
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toMatchObject({ ok: true, state: 'ready' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('exhausts retries and surfaces the last transient failure as an error', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(statusResponse(503))

    const promise = checkRoomServerReadiness(publicConfig, { fetchImpl })
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toMatchObject({ ok: false, state: 'unavailable' })
    expect(fetchImpl).toHaveBeenCalledTimes(READINESS_MAX_RETRIES + 1)
  })

  it('does not retry a non-transient status (e.g. HTTP 500)', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(statusResponse(500))

    await expect(checkRoomServerReadiness(publicConfig, { fetchImpl })).resolves.toMatchObject({
      ok: false,
      state: 'unavailable',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not retry a port conflict (wrong payload from another app)', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      { ok: true, status: 200, json: async () => ({ status: 'ok' }) } as Response,
    )

    await expect(checkRoomServerReadiness(publicConfig, { fetchImpl })).resolves.toMatchObject({
      ok: false,
      state: 'port-conflict',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
