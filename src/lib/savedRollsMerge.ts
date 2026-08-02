/**
 * Per-roll merge for cross-device saved-rolls sync.
 *
 * Why this exists
 * ---------------
 * `saved_rolls` is one jsonb blob per user, and the original sync policy was
 * whole-blob last-write-wins keyed off the server `updated_at`. That is correct
 * only while exactly one device ever has unsynced work. It is not, in practice:
 *
 * - Device A saves a roll while offline (or simply before the ~1s debounce
 *   fires) and the tab closes. The push never lands, so the device's last-synced
 *   stamp still equals the server's — and on the next sign-in the "remote is
 *   newer-or-equal" branch replays the server blob over the top, silently
 *   reverting the roll.
 * - Two devices each add a DIFFERENT roll offline. Whichever pushes second wins
 *   the whole blob, so the other device's roll is destroyed even though the two
 *   edits never touched the same object.
 * - A guest builds rolls on a second device and then signs in to an account that
 *   already has a row. Whole-blob LWW hands the account's blob down and the
 *   guest's work is gone; the "first sign-in pushes local up" path only ever
 *   fired when NO remote row existed.
 *
 * Saved rolls are an unordered-ish collection of independent objects keyed by a
 * stable `id`, which is exactly the shape that merges cleanly. So sync merges
 * per roll instead of per blob: the union of both sides, with a per-roll
 * revision breaking genuine same-roll conflicts.
 *
 * Revision & tombstones
 * ---------------------
 * `SavedRoll.updatedAt` is stamped by the store on every mutation. It is a
 * CLIENT clock, unavoidably — the server stamps the row, not the rolls inside
 * it — so a badly skewed device can win a conflict it should have lost. That is
 * strictly better than the blob-level behavior it replaces (which loses the
 * whole side rather than one field), and it only matters when the SAME roll was
 * edited on two devices between syncs. Rolls only one side touched merge by id
 * and never consult a clock at all.
 *
 * Deletes need tombstones. Without them a merge is a union, so a roll deleted on
 * A is simply re-supplied by B's copy on the next sync and appears to come back
 * from the dead. `deletedRolls` maps roll id -> deletion time; a tombstone
 * suppresses a roll whose revision is not newer than the delete, and loses to a
 * roll that was genuinely re-created or edited afterwards.
 *
 * Tombstones are garbage collected ({@link TOMBSTONE_TTL_MS}, {@link MAX_TOMBSTONES})
 * so the blob cannot grow without bound. A tombstone that ages out can no longer
 * suppress a straggler device's copy, which is why the TTL is months rather than
 * days.
 */

import type { SavedRoll } from '../types/savedRolls'

/**
 * Blob format version for the `saved_rolls` row.
 *
 * v1: `{ v: 1, savedRolls }` — no per-roll revision, no tombstones.
 * v2: `{ v: 2, savedRolls, deletedRolls }` — adds tombstones, and each roll may
 *     carry `updatedAt`.
 *
 * v2 is additive, so a v1 client reading a v2 blob still finds `savedRolls`
 * where it expects it and ignores the rest: it degrades to the old whole-blob
 * LWW behavior rather than breaking. (The cost of that degradation is real but
 * bounded — a v1 client that pushes drops the tombstones, so a roll deleted
 * elsewhere can reappear once.)
 */
export const SAVED_ROLLS_BLOB_VERSION = 2

/** Tombstones older than this are dropped. Long enough to outlive a device that has been offline for a season. */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

/** Hard cap on retained tombstones, newest first, so a delete-heavy account cannot bloat the blob. */
export const MAX_TOMBSTONES = 200

/** Roll id -> deletion timestamp (ms since epoch, client clock). */
export type SavedRollTombstones = Record<string, number>

/** The syncable half of the saved-rolls store. */
export interface SavedRollsSyncState {
  savedRolls: SavedRoll[]
  deletedRolls: SavedRollTombstones
}

/**
 * Ordering revision for a roll.
 *
 * Falls back to `createdAt` so pre-v2 rolls — which have no `updatedAt` at all —
 * compare EQUAL on both devices rather than arbitrarily. Equal means "remote
 * wins", i.e. exactly the legacy behavior, so upgrading a device cannot flip the
 * outcome of a conflict that legacy sync had already settled.
 */
export function savedRollRevision(roll: SavedRoll): number {
  if (typeof roll.updatedAt === 'number' && Number.isFinite(roll.updatedAt)) {
    return roll.updatedAt
  }
  if (typeof roll.createdAt === 'number' && Number.isFinite(roll.createdAt)) {
    return roll.createdAt
  }
  return 0
}

/** Coerce arbitrary persisted/remote input into a tombstone map. */
export function normalizeTombstones(value: unknown, now: number = Date.now()): SavedRollTombstones {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const entries: Array<[string, number]> = []
  for (const [id, at] of Object.entries(value as Record<string, unknown>)) {
    if (!id) continue
    const deletedAt = typeof at === 'number' && Number.isFinite(at) ? at : 0
    // A tombstone dated in the future would be un-expirable and would suppress
    // every future edit of that id, so clamp rather than trust the stamp.
    entries.push([id, Math.min(deletedAt, now)])
  }

  return collectTombstones(entries, now)
}

/** Apply the TTL + cap policy to a set of tombstone entries. */
function collectTombstones(entries: Array<[string, number]>, now: number): SavedRollTombstones {
  const fresh = entries
    .filter(([, deletedAt]) => now - deletedAt < TOMBSTONE_TTL_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOMBSTONES)

  return Object.fromEntries(fresh)
}

/**
 * Merge a remote snapshot into the local one.
 *
 * Both sides are treated as peers — there is no base revision to diff against,
 * so this is a union with per-roll conflict resolution, not a three-way merge:
 *
 * - A roll present on one side only is kept (this is what rescues offline work
 *   and guest rolls on a second device).
 * - A roll present on both is resolved by {@link savedRollRevision}, ties going
 *   to REMOTE so the result is stable no matter which device merges first.
 * - A tombstone suppresses a roll unless the roll's revision is strictly newer,
 *   which is how a re-created roll beats its own stale delete.
 *
 * Local order is preserved and remote-only rolls are appended, so a device's
 * list does not reshuffle under it. Order is deliberately NOT part of the
 * convergence contract (see {@link savedRollsStateMatchesRemote}) — making it so
 * would have two devices ping-pong pushes forever, each rewriting the other's
 * ordering.
 */
export function mergeSavedRollsState(
  local: SavedRollsSyncState,
  remote: SavedRollsSyncState,
  now: number = Date.now(),
): SavedRollsSyncState {
  const localRolls = Array.isArray(local.savedRolls) ? local.savedRolls : []
  const remoteRolls = Array.isArray(remote.savedRolls) ? remote.savedRolls : []

  const remoteById = new Map(remoteRolls.map(roll => [roll.id, roll]))
  const localById = new Map(localRolls.map(roll => [roll.id, roll]))

  // Newest delete per id across both sides.
  const tombstoneEntries = new Map<string, number>()
  for (const source of [local.deletedRolls, remote.deletedRolls]) {
    for (const [id, at] of Object.entries(normalizeTombstones(source, now))) {
      const existing = tombstoneEntries.get(id)
      if (existing === undefined || at > existing) tombstoneEntries.set(id, at)
    }
  }

  const pick = (id: string): SavedRoll | null => {
    const localRoll = localById.get(id)
    const remoteRoll = remoteById.get(id)
    // Ties go to remote so both devices reach the same answer.
    const winner = !localRoll
      ? remoteRoll
      : !remoteRoll
        ? localRoll
        : savedRollRevision(localRoll) > savedRollRevision(remoteRoll)
          ? localRoll
          : remoteRoll
    if (!winner) return null

    const deletedAt = tombstoneEntries.get(id)
    if (deletedAt !== undefined) {
      // The roll came back (re-created or edited after the delete) — it wins and
      // the tombstone is retired, otherwise it would keep killing every future
      // revision of this id.
      if (savedRollRevision(winner) > deletedAt) {
        tombstoneEntries.delete(id)
        return winner
      }
      return null
    }
    return winner
  }

  const savedRolls: SavedRoll[] = []
  const emitted = new Set<string>()
  for (const roll of localRolls) {
    if (emitted.has(roll.id)) continue
    emitted.add(roll.id)
    const picked = pick(roll.id)
    if (picked) savedRolls.push(picked)
  }
  for (const roll of remoteRolls) {
    if (emitted.has(roll.id)) continue
    emitted.add(roll.id)
    const picked = pick(roll.id)
    if (picked) savedRolls.push(picked)
  }

  return {
    savedRolls,
    deletedRolls: collectTombstones([...tombstoneEntries.entries()], now),
  }
}

/**
 * Does the merged state already match what the server holds?
 *
 * Used to decide whether a hydrate has to push the merge result back up. The
 * comparison is by roll IDENTITY (reference) rather than deep equality, which is
 * exact here: {@link mergeSavedRollsState} never builds a new roll object, it
 * only re-emits one of the two inputs. A roll that came from `remote` is
 * literally the remote object, so a reference match proves the server already
 * has that revision.
 *
 * Order is ignored on purpose. Treating it as significant would make every merge
 * on device A look "changed" to device B and vice versa, and the two would push
 * reordered blobs at each other indefinitely.
 */
export function savedRollsStateMatchesRemote(
  merged: SavedRollsSyncState,
  remote: SavedRollsSyncState,
): boolean {
  const remoteRolls = Array.isArray(remote.savedRolls) ? remote.savedRolls : []
  if (merged.savedRolls.length !== remoteRolls.length) return false

  const remoteById = new Map(remoteRolls.map(roll => [roll.id, roll]))
  for (const roll of merged.savedRolls) {
    if (remoteById.get(roll.id) !== roll) return false
  }

  const mergedTombstones = Object.entries(merged.deletedRolls)
  const remoteTombstones = Object.entries(remote.deletedRolls ?? {})
  if (mergedTombstones.length !== remoteTombstones.length) return false
  for (const [id, at] of mergedTombstones) {
    if (remote.deletedRolls?.[id] !== at) return false
  }

  return true
}
