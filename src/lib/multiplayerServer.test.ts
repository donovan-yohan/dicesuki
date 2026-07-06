import { describe, expect, it, vi } from 'vitest'
import {
  checkRoomServerReadiness,
  getHttpServerUrl,
  getRoomServerConfig,
  getWsServerUrl,
  type RoomServerConfig,
} from './multiplayerServer'

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
})
