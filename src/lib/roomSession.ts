/** Durable same-browser room resume metadata (Shared-ADR-011).
 *
 * Reconnect credentials are bearer secrets. They live only in localStorage,
 * never in URLs, logs, DOM, or analytics payloads. Server URLs are deliberately
 * not persisted: reconnect always derives the currently configured endpoint.
 */

const STORAGE_KEY = 'dicesuki:room-sessions'
const SCHEMA_VERSION = 1
export const ROOM_SESSION_MAX_RECORDS = 12
/** Browser resume metadata outlives the server's ten-minute held-seat grace.
 * After grace, the same credential simply joins a fresh seat if the room exists. */
export const ROOM_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface RoomSession {
  version: 1
  roomId: string
  displayName: string
  color: string
  reconnectToken: string
  updatedAt: number
}

interface Envelope {
  version: 1
  sessions: RoomSession[]
}

function isSession(value: unknown): value is RoomSession {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.version === SCHEMA_VERSION
    && typeof record.roomId === 'string'
    && record.roomId.length > 0
    && typeof record.displayName === 'string'
    && record.displayName.length > 0
    && typeof record.color === 'string'
    && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(record.color)
    && typeof record.reconnectToken === 'string'
    && record.reconnectToken.length >= 16
    && typeof record.updatedAt === 'number'
    && Number.isFinite(record.updatedAt)
}

function readAll(storage: Pick<Storage, 'getItem'>): RoomSession[] {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as unknown
    if (!parsed || typeof parsed !== 'object') return []
    const envelope = parsed as Partial<Envelope>
    if (envelope.version !== SCHEMA_VERSION || !Array.isArray(envelope.sessions)) return []
    return envelope.sessions.filter(isSession)
  } catch {
    return []
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Mint an opaque CSPRNG credential. No weak/random-time fallback is allowed. */
export function mintReconnectToken(cryptoImpl: Crypto = crypto): string {
  if (typeof cryptoImpl.randomUUID === 'function') return cryptoImpl.randomUUID()
  const bytes = new Uint8Array(32)
  cryptoImpl.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function loadRoomSession(
  roomId: string,
  now = Date.now(),
  storage: Storage | null = browserStorage(),
): RoomSession | null {
  if (!storage) return null
  const record = readAll(storage).find((candidate) => candidate.roomId === roomId)
  if (!record || now - record.updatedAt > ROOM_SESSION_MAX_AGE_MS || record.updatedAt > now + 60_000) {
    return null
  }
  return record
}

export function saveRoomSession(
  input: Omit<RoomSession, 'version' | 'updatedAt'>,
  now = Date.now(),
  storage: Storage | null = browserStorage(),
): RoomSession {
  const record: RoomSession = { version: SCHEMA_VERSION, ...input, updatedAt: now }
  if (!storage) return record
  try {
    const sessions = readAll(storage)
      .filter((candidate) => candidate.roomId !== input.roomId)
    sessions.unshift(record)
    const envelope: Envelope = {
      version: SCHEMA_VERSION,
      sessions: sessions.slice(0, ROOM_SESSION_MAX_RECORDS),
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope))
  } catch {
    // Storage denial/quota must not prevent joining; this session is ephemeral.
  }
  return record
}

export function clearRoomSession(
  roomId: string,
  storage: Storage | null = browserStorage(),
): void {
  if (!storage) return
  try {
    const sessions = readAll(storage).filter((candidate) => candidate.roomId !== roomId)
    if (sessions.length === 0) {
      storage.removeItem(STORAGE_KEY)
    } else {
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, sessions }))
    }
  } catch {
    // Best-effort cleanup when browser storage is unavailable.
  }
}
