import { describe, expect, it } from 'vitest'
import {
  MAX_TOMBSTONES,
  TOMBSTONE_TTL_MS,
  mergeSavedRollsState,
  normalizeTombstones,
  savedRollRevision,
  savedRollsStateMatchesRemote,
  type SavedRollsSyncState,
} from './savedRollsMerge'
import type { SavedRoll } from '../types/savedRolls'

const NOW = 1_700_000_000_000

function roll(id: string, overrides: Partial<SavedRoll> = {}): SavedRoll {
  return { id, name: id, dice: [], flatBonus: 0, createdAt: 1_000, ...overrides }
}

function state(
  savedRolls: SavedRoll[],
  deletedRolls: Record<string, number> = {},
): SavedRollsSyncState {
  return { savedRolls, deletedRolls }
}

describe('savedRollRevision', () => {
  it('falls back to createdAt so pre-v2 rolls compare EQUAL rather than arbitrarily', () => {
    // Both devices hold the same legacy roll. Neither has `updatedAt`, so the
    // revisions must tie — a tie hands the roll to remote, which is exactly what
    // whole-blob LWW already did. Anything else would let an upgraded client
    // silently re-decide conflicts legacy sync had settled.
    expect(savedRollRevision(roll('r1'))).toBe(1_000)
    expect(savedRollRevision(roll('r1', { updatedAt: 5_000 }))).toBe(5_000)
    expect(savedRollRevision({ ...roll('r1'), createdAt: undefined as never })).toBe(0)
  })
})

describe('mergeSavedRollsState', () => {
  it('keeps BOTH sides when two devices added different rolls offline', () => {
    // The headline whole-blob failure: neither edit touched the other's roll,
    // yet LWW would have destroyed one of them wholesale.
    const local = state([roll('local-only')])
    const remote = state([roll('remote-only')])

    const merged = mergeSavedRollsState(local, remote, NOW)

    expect(merged.savedRolls.map(r => r.id)).toEqual(['local-only', 'remote-only'])
  })

  it('resolves a genuine same-roll conflict by per-roll revision', () => {
    const local = state([roll('shared', { name: 'local edit', updatedAt: 2_000 })])
    const remote = state([roll('shared', { name: 'remote edit', updatedAt: 1_500 })])

    expect(mergeSavedRollsState(local, remote, NOW).savedRolls[0].name).toBe('local edit')
    expect(mergeSavedRollsState(remote, local, NOW).savedRolls[0].name).toBe('local edit')
  })

  it('gives ties to remote so both devices reach the same answer', () => {
    const localRoll = roll('shared', { name: 'local' })
    const remoteRoll = roll('shared', { name: 'remote' })

    const merged = mergeSavedRollsState(state([localRoll]), state([remoteRoll]), NOW)

    expect(merged.savedRolls[0]).toBe(remoteRoll)
  })

  it('propagates a delete instead of letting the other device resurrect the roll', () => {
    // Device A deleted `gone`; device B still has its copy. A plain union would
    // hand it straight back.
    const local = state([roll('kept')], { gone: NOW - 1_000 })
    const remote = state([roll('kept'), roll('gone')])

    const merged = mergeSavedRollsState(local, remote, NOW)

    expect(merged.savedRolls.map(r => r.id)).toEqual(['kept'])
    expect(merged.deletedRolls.gone).toBe(NOW - 1_000)
  })

  it('lets a roll re-created after its delete beat the tombstone, and retires it', () => {
    const local = state([], { gone: NOW - 5_000 })
    const remote = state([roll('gone', { updatedAt: NOW - 1_000 })])

    const merged = mergeSavedRollsState(local, remote, NOW)

    expect(merged.savedRolls.map(r => r.id)).toEqual(['gone'])
    // Retained, the tombstone would kill every future revision of this id.
    expect(merged.deletedRolls).not.toHaveProperty('gone')
  })

  it('keeps the newest delete when both devices deleted the same roll', () => {
    const merged = mergeSavedRollsState(
      state([], { gone: NOW - 9_000 }),
      state([], { gone: NOW - 2_000 }),
      NOW,
    )

    expect(merged.deletedRolls.gone).toBe(NOW - 2_000)
  })

  it('preserves local order and appends remote-only rolls', () => {
    const merged = mergeSavedRollsState(
      state([roll('b'), roll('a')]),
      state([roll('a'), roll('z')]),
      NOW,
    )

    expect(merged.savedRolls.map(r => r.id)).toEqual(['b', 'a', 'z'])
  })

  it('converges: merging an already-merged result changes nothing', () => {
    const local = state([roll('l', { updatedAt: 3_000 })], { d: NOW - 100 })
    const remote = state([roll('r', { updatedAt: 4_000 })])

    const once = mergeSavedRollsState(local, remote, NOW)
    const twice = mergeSavedRollsState(once, once, NOW)

    expect(twice.savedRolls.map(r => r.id)).toEqual(once.savedRolls.map(r => r.id))
    expect(twice.deletedRolls).toEqual(once.deletedRolls)
  })
})

describe('tombstone garbage collection', () => {
  it('drops tombstones past the TTL so the blob stays bounded', () => {
    const normalized = normalizeTombstones(
      { fresh: NOW - 1_000, ancient: NOW - TOMBSTONE_TTL_MS - 1 },
      NOW,
    )

    expect(normalized).toEqual({ fresh: NOW - 1_000 })
  })

  it('caps retained tombstones at the newest MAX_TOMBSTONES', () => {
    const many: Record<string, number> = {}
    for (let i = 0; i < MAX_TOMBSTONES + 25; i += 1) many[`r${i}`] = NOW - i

    const normalized = normalizeTombstones(many, NOW)

    expect(Object.keys(normalized)).toHaveLength(MAX_TOMBSTONES)
    expect(normalized).toHaveProperty('r0')
    expect(normalized).not.toHaveProperty(`r${MAX_TOMBSTONES + 24}`)
  })

  it('clamps a future-dated tombstone so a skewed clock cannot make it permanent', () => {
    // Left alone, a tombstone from the year 3000 never expires and suppresses
    // every future revision of that id.
    expect(normalizeTombstones({ skewed: NOW + 10_000_000 }, NOW)).toEqual({ skewed: NOW })
  })

  it('reads a missing or malformed tombstone map as "no deletions known"', () => {
    expect(normalizeTombstones(undefined)).toEqual({})
    expect(normalizeTombstones('nope')).toEqual({})
    expect(normalizeTombstones([1, 2, 3])).toEqual({})
  })
})

describe('savedRollsStateMatchesRemote', () => {
  it('is true when the merge contributed nothing, so no push is needed', () => {
    const remoteRoll = roll('shared')
    const remote = state([remoteRoll])

    const merged = mergeSavedRollsState(state([roll('shared')]), remote, NOW)

    expect(savedRollsStateMatchesRemote(merged, remote)).toBe(true)
  })

  it('is false when local contributed a roll the server has never seen', () => {
    const remote = state([roll('remote-only')])
    const merged = mergeSavedRollsState(state([roll('local-only')]), remote, NOW)

    expect(savedRollsStateMatchesRemote(merged, remote)).toBe(false)
  })

  it('is false when local won a same-roll conflict', () => {
    const remote = state([roll('shared', { updatedAt: 1_000 })])
    const merged = mergeSavedRollsState(
      state([roll('shared', { updatedAt: 9_000 })]),
      remote,
      NOW,
    )

    expect(savedRollsStateMatchesRemote(merged, remote)).toBe(false)
  })

  it('is false when local holds a delete the server has not recorded', () => {
    const remote = state([roll('gone')])
    const merged = mergeSavedRollsState(state([], { gone: NOW - 10 }), remote, NOW)

    expect(savedRollsStateMatchesRemote(merged, remote)).toBe(false)
  })

  it('ignores ORDER, so two devices cannot ping-pong reordered pushes forever', () => {
    // Both devices hold the same two rolls in opposite order. If order counted,
    // each merge would look "changed" to the other device and the two would push
    // rewritten blobs at each other indefinitely.
    const a = roll('a')
    const b = roll('b')
    const remote = state([a, b])
    const merged = mergeSavedRollsState(state([b, a]), remote, NOW)

    expect(merged.savedRolls.map(r => r.id)).toEqual(['b', 'a'])
    expect(savedRollsStateMatchesRemote(merged, remote)).toBe(true)
  })
})
