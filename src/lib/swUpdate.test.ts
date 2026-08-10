import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { registerSW } from 'virtual:pwa-register'
import type { RegisterSWOptions } from 'vite-plugin-pwa/types'
import {
  SW_RELOAD_GUARD_KEY,
  SW_RELOAD_GUARD_WINDOW_MS,
  SW_UPDATE_CHECK_INTERVAL_MS,
  isSessionActive,
  readSessionSnapshot,
  startServiceWorkerUpdates,
  type SessionSnapshot,
} from './swUpdate'
import { useMultiplayerStore, type RoomTransportKind } from '../store/useMultiplayerStore'
import { useDiceStore } from '../store/useDiceStore'

// The plugin's virtual module is the seam the whole policy hangs off: mocking it
// at module level lets the tests drive `onNeedReload` / `onRegisteredSW` exactly
// as vite-plugin-pwa would, without a real service worker.
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }))

const registerSWMock = vi.mocked(registerSW)

/** The options the module under test handed to `registerSW`. */
function capturedOptions(): RegisterSWOptions {
  expect(registerSWMock).toHaveBeenCalledTimes(1)
  return registerSWMock.mock.calls[0][0] as RegisterSWOptions
}

function makeSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    connectionStatus: 'disconnected',
    roomId: null,
    transport: null,
    diceOnTable: 0,
    rollInFlight: false,
    ...overrides,
  }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

function enterRoom(transport: RoomTransportKind, diceIds: string[] = []) {
  useMultiplayerStore.setState({
    connectionStatus: 'connected',
    roomId: 'room-1',
    lastJoin: {
      roomId: 'room-1',
      displayName: 'Player',
      color: '#fff',
      serverUrl: transport === 'worker' ? 'worker://solo' : 'wss://example.test',
      token: 'token',
      transport,
    },
    dice: new Map(
      diceIds.map((id) => [
        id,
        { id, ownerId: 'p1', isRolling: false } as never,
      ]),
    ),
  })
}

function leaveRoom() {
  useMultiplayerStore.setState({
    connectionStatus: 'disconnected',
    roomId: null,
    lastJoin: null,
    dice: new Map(),
  })
}

describe('isSessionActive', () => {
  it('is false with no room — the returning-visitor case a reload is invisible in', () => {
    expect(isSessionActive(makeSnapshot())).toBe(false)
  })

  it('is true whenever a roll is in flight, even with no room state', () => {
    expect(isSessionActive(makeSnapshot({ rollInFlight: true }))).toBe(true)
  })

  it('is true for any live multiplayer room, including a reconnecting one', () => {
    for (const connectionStatus of ['connecting', 'connected', 'error'] as const) {
      expect(
        isSessionActive(makeSnapshot({ connectionStatus, roomId: 'r', transport: 'websocket' })),
      ).toBe(true)
    }
  })

  it('is false for a solo room with an empty table (nothing a reload can lose)', () => {
    expect(
      isSessionActive(
        makeSnapshot({ connectionStatus: 'connected', roomId: 'solo', transport: 'worker' }),
      ),
    ).toBe(false)
  })

  it('is true for a solo room with dice on the table (the wasm room is not resumable)', () => {
    expect(
      isSessionActive(
        makeSnapshot({
          connectionStatus: 'connected',
          roomId: 'solo',
          transport: 'worker',
          diceOnTable: 2,
        }),
      ),
    ).toBe(true)
  })

  it('ignores a stale transport once the room is gone', () => {
    expect(
      isSessionActive(makeSnapshot({ connectionStatus: 'disconnected', transport: 'websocket' })),
    ).toBe(false)
  })
})

describe('readSessionSnapshot', () => {
  it('projects the live room and roll stores', () => {
    enterRoom('websocket', ['die-1'])
    useDiceStore.setState({ rollingDice: new Set(['die-1']) })

    expect(readSessionSnapshot()).toEqual({
      connectionStatus: 'connected',
      roomId: 'room-1',
      transport: 'websocket',
      diceOnTable: 1,
      rollInFlight: true,
    })
  })

  it('reports a roll in flight while saved-roll waves are pending', () => {
    useDiceStore.setState({ savedRollWavesPending: true })
    expect(readSessionSnapshot().rollInFlight).toBe(true)
  })
})

describe('startServiceWorkerUpdates', () => {
  let stop: (() => void) | null = null
  let reload: Mock<() => void>

  beforeEach(() => {
    registerSWMock.mockReset()
    window.sessionStorage.clear()
    setVisibility('visible')
    leaveRoom()
    useDiceStore.setState({
      rollingDice: new Set(),
      currentRollCycleDice: new Set(),
      savedRollWavesPending: false,
    })
    reload = vi.fn<() => void>()
  })

  afterEach(() => {
    stop?.()
    stop = null
    vi.useRealTimers()
  })

  it('registers immediately and owns the reload via onNeedReload', () => {
    stop = startServiceWorkerUpdates({ reload })

    const options = capturedOptions()
    expect(options.immediate).toBe(true)
    // Without this the plugin calls window.location.reload() itself, mid-session.
    expect(typeof options.onNeedReload).toBe('function')
  })

  it('reloads straight away when the new worker activates and nothing is in play', () => {
    stop = startServiceWorkerUpdates({ reload })

    capturedOptions().onNeedReload?.()

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('defers the reload while a multiplayer room is live, then fires on room exit', () => {
    enterRoom('websocket', ['die-1'])
    stop = startServiceWorkerUpdates({ reload })

    capturedOptions().onNeedReload?.()
    expect(reload).not.toHaveBeenCalled()

    leaveRoom()

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('defers while dice are rolling on a solo table, then fires once they settle', () => {
    enterRoom('worker', ['die-1'])
    useDiceStore.setState({ rollingDice: new Set(['die-1']) })
    stop = startServiceWorkerUpdates({ reload })

    capturedOptions().onNeedReload?.()
    expect(reload).not.toHaveBeenCalled()

    // Dice settle and the table is cleared — solo with an empty table is safe.
    useDiceStore.setState({ rollingDice: new Set() })
    useMultiplayerStore.setState({ dice: new Map() })

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads a deferred update as soon as the tab is hidden', () => {
    enterRoom('websocket', ['die-1'])
    stop = startServiceWorkerUpdates({ reload })

    capturedOptions().onNeedReload?.()
    expect(reload).not.toHaveBeenCalled()

    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('never reloads twice, however many activations arrive', () => {
    stop = startServiceWorkerUpdates({ reload })
    const options = capturedOptions()

    options.onNeedReload?.()
    options.onNeedReload?.()
    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('suppresses a reload that lands inside the loop-guard window of a previous one', () => {
    window.sessionStorage.setItem(SW_RELOAD_GUARD_KEY, '1000')
    stop = startServiceWorkerUpdates({ reload, now: () => 1000 + SW_RELOAD_GUARD_WINDOW_MS - 1 })

    capturedOptions().onNeedReload?.()

    expect(reload).not.toHaveBeenCalled()
  })

  it('allows a reload once the loop-guard window has elapsed', () => {
    window.sessionStorage.setItem(SW_RELOAD_GUARD_KEY, '1000')
    const now = 1000 + SW_RELOAD_GUARD_WINDOW_MS
    stop = startServiceWorkerUpdates({ reload, now: () => now })

    capturedOptions().onNeedReload?.()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(SW_RELOAD_GUARD_KEY)).toBe(String(now))
  })

  it('checks for a new worker on registration, on an interval, and when the tab returns', () => {
    vi.useFakeTimers()
    const update = vi.fn().mockResolvedValue(undefined)
    const registration = { update } as unknown as ServiceWorkerRegistration

    stop = startServiceWorkerUpdates({ reload })
    capturedOptions().onRegisteredSW?.('/sw.js', registration)

    expect(update).toHaveBeenCalledTimes(1) // on registration

    vi.advanceTimersByTime(SW_UPDATE_CHECK_INTERVAL_MS)
    expect(update).toHaveBeenCalledTimes(2) // periodic poll

    document.dispatchEvent(new Event('visibilitychange'))
    expect(update).toHaveBeenCalledTimes(3) // tab became visible
  })

  it('does not poll when the browser gave no registration', () => {
    vi.useFakeTimers()
    stop = startServiceWorkerUpdates({ reload })

    expect(() => capturedOptions().onRegisteredSW?.('/sw.js', undefined)).not.toThrow()
    expect(() => vi.advanceTimersByTime(SW_UPDATE_CHECK_INTERVAL_MS)).not.toThrow()
  })

  it('stops listening after teardown', () => {
    enterRoom('websocket')
    stop = startServiceWorkerUpdates({ reload })
    capturedOptions().onNeedReload?.()

    stop()
    stop = null
    leaveRoom()

    expect(reload).not.toHaveBeenCalled()
  })
})
