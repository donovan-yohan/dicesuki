import { describe, expect, it } from 'vitest'
import {
  ROOM_SESSION_MAX_AGE_MS,
  ROOM_SESSION_MAX_RECORDS,
  clearRoomSession,
  loadRoomSession,
  mintReconnectToken,
  saveRoomSession,
} from './roomSession'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => { data.delete(key) },
    setItem: (key, value) => { data.set(key, value) },
  }
}

describe('roomSession', () => {
  it('round-trips a per-room record and clears only that room', () => {
    const storage = memoryStorage()
    saveRoomSession({ roomId: 'one', displayName: 'A', color: '#abcdef', reconnectToken: 'token-token-token-one' }, 100, storage)
    saveRoomSession({ roomId: 'two', displayName: 'B', color: '#123456', reconnectToken: 'token-token-token-two' }, 100, storage)
    expect(loadRoomSession('one', 101, storage)?.displayName).toBe('A')
    clearRoomSession('one', storage)
    expect(loadRoomSession('one', 101, storage)).toBeNull()
    expect(loadRoomSession('two', 101, storage)?.displayName).toBe('B')
  })

  it('fails safely for malformed and stale storage', () => {
    const storage = memoryStorage()
    storage.setItem('dicesuki:room-sessions', '{broken')
    expect(loadRoomSession('one', 100, storage)).toBeNull()
    saveRoomSession({ roomId: 'one', displayName: 'A', color: '#abcdef', reconnectToken: 'token-token-token-one' }, 100, storage)
    expect(loadRoomSession('one', 100 + ROOM_SESSION_MAX_AGE_MS + 1, storage)).toBeNull()
  })

  it('outlives server seat grace but rejects far-future records', () => {
    const storage = memoryStorage()
    saveRoomSession({ roomId: 'one', displayName: 'A', color: '#abcdef', reconnectToken: 'token-token-token-one' }, 100, storage)
    expect(loadRoomSession('one', 100 + 10 * 60 * 1000 + 1, storage)).not.toBeNull()

    saveRoomSession({ roomId: 'future', displayName: 'F', color: '#abcdef', reconnectToken: 'token-token-token-future' }, 100_000, storage)
    expect(loadRoomSession('future', 0, storage)).toBeNull()
  })

  it('retains only the newest bounded set of room records', () => {
    const storage = memoryStorage()
    for (let index = 0; index <= ROOM_SESSION_MAX_RECORDS; index += 1) {
      saveRoomSession({
        roomId: `room-${index}`,
        displayName: `P${index}`,
        color: '#abcdef',
        reconnectToken: `token-token-token-${index}`,
      }, 100 + index, storage)
    }
    expect(loadRoomSession('room-0', 200, storage)).toBeNull()
    expect(loadRoomSession(`room-${ROOM_SESSION_MAX_RECORDS}`, 200, storage)).not.toBeNull()
  })

  it('mints credentials from browser cryptography', () => {
    const cryptoImpl = { randomUUID: () => '12345678-1234-4234-9234-123456789abc' } as unknown as Crypto
    expect(mintReconnectToken(cryptoImpl)).toBe('12345678-1234-4234-9234-123456789abc')
  })
})
