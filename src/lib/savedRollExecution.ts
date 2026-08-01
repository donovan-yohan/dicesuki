/**
 * Saved Roll Execution
 *
 * Runs a saved roll as *physical* dice through the existing room protocol.
 * There is no server-side notion of a saved roll: keep/drop, reroll and
 * exploding are all orchestrated here as successive spawn waves, and the room
 * only ever sees `remove_dice` / `spawn_dice` / `roll`.
 *
 * ## Waves
 *
 * 1. **Base** — clear our dice, spawn `rollCount` dice per entry, `roll`, wait
 *    for every one to settle. This is the only wave that sends `roll`:
 *    `roll_player_dice` applies an impulse to *all* of the player's dice
 *    (`server/core/src/room.rs`), so a second `roll` would re-roll the dice
 *    that already landed. A spawned die drops from `SPAWN_HEIGHT` and settles
 *    on its own, so for follow-up waves the spawn IS the roll.
 * 2. **Reroll** — dice matching the reroll condition are removed and replaced.
 *    Once only: the replacement's face is final.
 * 3. **Explosions** — every die showing the trigger face spawns one more die
 *    whose face adds to it, repeating while dice keep exploding, bounded by
 *    {@link MAX_EXPLOSION_WAVES} and by the room's dice capacity.
 *
 * The panel closes as soon as the base wave starts rolling, so failures split
 * in two: anything before that throws and renders as the panel's inline error;
 * anything after sets `useDiceStore.rollNotice`, which the result HUD shows.
 * Either way the caller's reentrancy latch is held until the whole sequence
 * ends, so a second roll can never interleave with a half-finished plan.
 */

import { nanoid } from 'nanoid'

import type { DiceBackendState } from '../contexts/DiceBackendContext'
import { ROLL_DICE_CAPACITY_MESSAGE, ROOM_DICE_CAPACITY } from '../config/roomCapacity'
import { useDiceStore } from '../store/useDiceStore'
import { useInventoryStore } from '../store/useInventoryStore'
import { useMultiplayerStore, type MultiplayerDie } from '../store/useMultiplayerStore'
import type { DiceShape } from './geometries'
import type { DicePresentationMetadata } from './multiplayerMessages'
import type { DiceEntry, SavedRoll } from '../types/savedRolls'
import {
  isPercentileEntry,
  percentileOnesPresentation,
  percentileTensPresentation,
  PERCENTILE_TENS_SHAPE,
} from './percentileRolls'
import { expandDiceEntrySpawns, getRollDiceCount, type RollSpawn } from './rollSources'
import { isBasicDiePresentation } from './basicDice'
import {
  MAX_EXPLOSION_WAVES,
  addGroup,
  addPercentileGroup,
  attachGroupMember,
  cloneSavedRollPlan,
  createSavedRollPlan,
  facesFromSettled,
  getPlanDiceIds,
  getPlanPerDieBonuses,
  markGroupRerolled,
  replaceGroupMembers,
  selectExplosionTargets,
  selectRerollTargets,
  type SavedRollPlan,
} from './savedRollPlan'

/** Protocol acknowledgements (clear, spawn, roll start) are near-instant. */
const ROOM_ACK_TIMEOUT_MS = 5_000

/**
 * Dice have to physically come to rest, which the room only declares after
 * `REST_DURATION_MS` of stillness. Generous enough for a full table of dice
 * that ricochet before settling, short enough that a wedged wave gives up.
 */
const SETTLE_TIMEOUT_MS = 20_000

type MultiplayerState = ReturnType<typeof useMultiplayerStore.getState>
type DiceState = ReturnType<typeof useDiceStore.getState>

export type SavedRollBackend = Pick<
  DiceBackendState,
  'addDie' | 'addGenericDie' | 'removeDie' | 'clearAll' | 'roll'
>

export interface SavedRollExecutionOptions {
  backend: SavedRollBackend
  ownerId: string
  /**
   * Fired once the base wave is rolling. The panel closes here so the player
   * watches the dice instead of the sheet; follow-up waves run behind it.
   */
  onBaseWaveStarted?: () => void
}

function sameIdSet(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((id) => actual.includes(id))
}

/**
 * Resolve when `predicate` holds, reject on a room error or timeout.
 * Checks immediately so an already-satisfied condition costs no round trip.
 */
function waitForStore<S>(
  store: {
    getState: () => S
    subscribe: (listener: (state: S) => void) => () => void
  },
  description: string,
  predicate: (state: S) => boolean,
  timeoutMs: number,
): Promise<void> {
  // Any room error present during a wait aborts it. Scoping is done by the
  // CALLER clearing `roomActionError` before each wave (see `beginWave`), not
  // by filtering here: an action and the error it raises are synchronous, so a
  // wait must be able to see the error its own trigger just produced.
  const evaluate = (state: S) => {
    const roomError = useMultiplayerStore.getState().roomActionError
    if (roomError) throw new Error(roomError.message)
    return predicate(state)
  }

  return new Promise((resolve, reject) => {
    let settled = false
    let unsubscribe = () => {}
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      unsubscribe()
      if (error) reject(error)
      else resolve()
    }
    const check = (state: S) => {
      try {
        if (evaluate(state)) finish()
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const timeout = setTimeout(
      () => finish(new Error(`Timed out waiting for the room to ${description}.`)),
      timeoutMs,
    )
    unsubscribe = store.subscribe(check)
    check(store.getState())
  })
}

function waitForRoom(
  description: string,
  predicate: (state: MultiplayerState) => boolean,
  timeoutMs = ROOM_ACK_TIMEOUT_MS,
): Promise<void> {
  return waitForStore(useMultiplayerStore, description, predicate, timeoutMs)
}

function waitForSpawns(ids: string[], ownerId: string): Promise<void> {
  return waitForRoom('spawn every saved-roll die', (state) => ids.every((id) => {
    const die = state.dice.get(id)
    return die !== undefined && die.ownerId === ownerId
  }))
}

function waitForRemovals(ids: string[]): Promise<void> {
  return waitForRoom('clear the rerolled dice', (state) => ids.every((id) => !state.dice.has(id)))
}

/**
 * Wait for a wave's dice to come to rest.
 *
 * `settledDice` is the right signal rather than the room's `isRolling`: a die
 * knocked back into motion by a later collision keeps its recorded face, and a
 * wave must not hang because an unrelated die nudged it.
 */
function waitForSettle(ids: string[]): Promise<void> {
  return waitForStore(
    useDiceStore,
    'settle the dice',
    (state: DiceState) => ids.every((id) => state.settledDice.has(id)),
    SETTLE_TIMEOUT_MS,
  )
}

/** Free room slots, counting every player's dice — the cap is room-wide. */
function availableRoomCapacityNow(): number {
  return Math.max(0, ROOM_DICE_CAPACITY - useMultiplayerStore.getState().dice.size)
}

/** Publish the plan so the HUD, history and `roll_complete` all score alike. */
function publishPlan(plan: SavedRollPlan, roll: SavedRoll): void {
  useDiceStore.getState().setActiveSavedRoll({
    name: roll.name,
    flatBonus: roll.flatBonus,
    perDieBonuses: getPlanPerDieBonuses(plan),
    plan: cloneSavedRollPlan(plan),
  })
}

/**
 * Who to credit for the wave row, matching what `roll_complete` would have
 * attributed. Undefined when the room has no player record for us.
 */
function localRollingPlayer() {
  const { players, localPlayerId } = useMultiplayerStore.getState()
  if (!localPlayerId) return undefined
  const player = players.get(localPlayerId)
  if (!player) return undefined
  return { id: localPlayerId, displayName: player.displayName, color: player.color }
}

/**
 * Open a wave.
 *
 * Follow-up waves run long after the panel closed, so a stale `roomActionError`
 * — a rejected manual spawn from before the roll, say — would otherwise abort a
 * wave that is doing nothing wrong. Clearing here means every error a wave's
 * waits can see was raised by that wave.
 */
function beginWave(): void {
  useMultiplayerStore.getState().clearRoomActionError()
}

function currentFaces(): Map<string, number> {
  return facesFromSettled(useDiceStore.getState().settledDice)
}

/** Does this roll need anything beyond the base wave? */
function needsFollowUpWaves(roll: SavedRoll): boolean {
  return roll.dice.some((entry) => entry.reroll !== undefined || entry.exploding !== undefined)
}

/**
 * Guard the roll against the room's dice cap.
 *
 * `clearAll` only removes our own dice, so another player's stay put and eat
 * capacity. Failing here keeps the table intact instead of clearing it and
 * then taking a server-side `DICE_LIMIT` rejection mid-spawn. Explosions are
 * deliberately NOT pre-counted — their worst case is unbounded, so they are
 * budgeted per wave against whatever is actually free at the time.
 */
function assertCapacity(roll: SavedRoll, ownerId: string): void {
  const room = useMultiplayerStore.getState()
  const ownedCount = Array.from(room.dice.values())
    .filter((die: MultiplayerDie) => die.ownerId === ownerId).length
  const foreignDiceCount = room.dice.size - ownedCount
  const availableCapacity = Math.max(0, ROOM_DICE_CAPACITY - foreignDiceCount)
  const requestedDiceCount = getRollDiceCount(roll.dice)

  if (requestedDiceCount > availableCapacity) {
    throw new Error(
      foreignDiceCount > 0
        ? `Only ${availableCapacity} of the room's ${ROOM_DICE_CAPACITY} dice are free — "${roll.name}" needs ${requestedDiceCount}.`
        : `${ROLL_DICE_CAPACITY_MESSAGE}. "${roll.name}" needs ${requestedDiceCount} — edit it to continue.`,
    )
  }
}

/**
 * How a wave target picks the physical die it puts on the table.
 *
 * - `named` — the roll pinned a specific owned die by id.
 * - `owned-first` — a plain entry: use any owned die of the type that is not
 *   already in play, and fall back to a basic once they run out.
 * - `generic` — deliberately never an owned die: the percentile TENS half (no
 *   player owns one) and follow-up wave dice, which are extra dice the entry did
 *   not ask for and must not silently consume the player's collection.
 */
type SpawnKind = 'named' | 'owned-first' | 'generic'

/**
 * Spawn one die for a wave target.
 * Returns the client request id, or throws with the room's own message.
 *
 * Inventory scarcity NEVER throws: `addDie` substitutes a basic die so the rest
 * of the roll still lands (see {@link describeMissingNamedDice} and
 * {@link describeBasicFill}). Only a ROOM refusal — disconnected, at capacity —
 * fails here.
 */
function spawnDie(
  backend: SavedRollBackend,
  kind: SpawnKind,
  type: DiceShape,
  inventoryDieId?: string,
  presentation?: DicePresentationMetadata,
  label?: string,
): string {
  const id = kind === 'generic'
    ? backend.addGenericDie(type, presentation)
    : backend.addDie(type, inventoryDieId, presentation)

  if (!id) {
    const actionError = useMultiplayerStore.getState().roomActionError
    throw new Error(actionError?.message ?? `Could not spawn ${label ?? type.toUpperCase()}.`)
  }
  return id
}

/**
 * How many of `spawnIds` came back from the room as basic dice.
 *
 * Read from the room's own echo rather than predicted before the spawn, so the
 * notice is ground truth instead of a second copy of `addDie`'s fallback rules,
 * which could drift from it.
 */
function countBasicSpawns(spawnIds: readonly string[]): number {
  const { dice } = useMultiplayerStore.getState()
  return spawnIds.filter((id) => isBasicDiePresentation(dice.get(id)?.presentation)).length
}

function describeMissingNamedDice(count: number): string {
  return count === 1
    ? 'One die in this roll is no longer in your collection, so a basic die was rolled instead.'
    : `${count} dice in this roll are no longer in your collection, so basic dice were rolled instead.`
}

function describeBasicFill(count: number): string {
  return count === 1
    ? 'You ran out of owned dice, so 1 basic die filled in.'
    : `You ran out of owned dice, so ${count} basic dice filled in.`
}

/** Where each of an entry's base-wave dice came from, for the roll notice. */
interface EntrySpawnLedger {
  /** Dice the roll pinned by inventory id. A basic here means the die is gone. */
  named: string[]
  /**
   * Dice from PLAIN sources, recorded only when the player owns at least one die
   * of that type. A basic here means their owned dice ran short mid-roll, which
   * is worth saying. Owning none of a type is not "running short" — it is the
   * default state, so those spawns are deliberately not tracked and a player with
   * an empty collection is never nagged.
   */
  ownedFirst: string[]
}

/**
 * Spawn one entry's physical dice and record them in the plan.
 *
 * `expandDiceEntrySpawns` is the SAME expansion `getRollDiceCount` counts, so
 * the capacity guard and this loop can never disagree about how many dice a
 * roll puts on the table. A d100 is not one die: it is a TENS die (00-90) plus
 * its ones d10, spawned as a pair sharing a `percentilePairId` in each die's
 * `presentation` block, and recorded as ONE plan group so the halves combine
 * into a single 1-100 result instead of summing.
 *
 * A PLAIN source spawns owned-first: `addDie(type)` picks any owned die of the
 * type that is not already in play and falls back to a basic once they run out
 * (PO decision (d), 2026-07-28). "Already in play" includes dice spawned earlier
 * in THIS roll — `spawnDice` marks an inventory die pending the moment it is
 * sent, so the same owned die can never fill two slots of one roll, nor be
 * claimed twice by two entries of the same type.
 */
function spawnEntry(
  backend: SavedRollBackend,
  plan: SavedRollPlan,
  entry: DiceEntry,
  ledger: EntrySpawnLedger,
): void {
  const label = isPercentileEntry(entry) ? 'D100' : entry.type.toUpperCase()
  const pairIds = new Map<number, string>()
  const pendingTens = new Map<number, string>()
  // Sampled once per entry, before any of its dice are sent: whether the player
  // owns this type at all does not change mid-entry, only how many are free does.
  const ownsAnyOfType = useInventoryStore.getState().getDiceByType(entry.type).length > 0

  const kindOf = (source: RollSpawn['source']): SpawnKind =>
    source.kind === 'specific' ? 'named' : 'owned-first'

  /** File the spawned die under the source that asked for it. */
  const track = (id: string, source: RollSpawn['source']): string => {
    if (source.kind === 'specific') ledger.named.push(id)
    else if (ownsAnyOfType) ledger.ownedFirst.push(id)
    return id
  }

  for (const spawn of expandDiceEntrySpawns(entry)) {
    const pair = spawn.percentile

    if (!pair) {
      addGroup(plan, entry.id, track(spawnDie(
        backend,
        kindOf(spawn.source),
        entry.type,
        spawn.source.kind === 'specific' ? spawn.source.dieId : undefined,
        undefined,
        label,
      ), spawn.source))
      continue
    }

    let pairId = pairIds.get(pair.pairIndex)
    if (!pairId) {
      pairId = `pct_${nanoid(10)}`
      pairIds.set(pair.pairIndex, pairId)
    }

    if (pair.role === 'tens') {
      // The tens half is always a plain engine die and carries no bonus — a
      // per-die bonus applies once, to the COMBINED value. No player can own a
      // `d10tens`, so it is spawned generic rather than owned-first.
      pendingTens.set(pair.pairIndex, spawnDie(
        backend,
        'generic',
        PERCENTILE_TENS_SHAPE,
        undefined,
        percentileTensPresentation(pairId),
        label,
      ))
      continue
    }

    const onesId = track(spawnDie(
      backend,
      kindOf(spawn.source),
      entry.type,
      spawn.source.kind === 'specific' ? spawn.source.dieId : undefined,
      percentileOnesPresentation(pairId),
      label,
    ), spawn.source)
    const tensId = pendingTens.get(pair.pairIndex)
    /* c8 ignore next -- expandDiceEntrySpawns always emits tens before ones */
    if (tensId === undefined) continue
    addPercentileGroup(plan, entry.id, tensId, onesId)
  }
}

/**
 * Replace every die that met its entry's reroll condition.
 *
 * Removal is awaited before respawning: an owned die counts as "already on the
 * table" until the room confirms it is gone, and `addDie` refuses to spawn a
 * duplicate of it.
 */
async function runRerollWave(
  plan: SavedRollPlan,
  roll: SavedRoll,
  { backend, ownerId }: SavedRollExecutionOptions,
): Promise<boolean> {
  const targets = selectRerollTargets(plan, currentFaces())
  if (targets.length === 0) return false

  beginWave()

  const doomedIds = targets.flatMap((target) => target.memberIds)
  // Owned dice are re-spawned as themselves so a reroll keeps the die's look.
  const inventoryDieIds = targets.map((target) => (
    target.memberIds
      .map((id) => useMultiplayerStore.getState().dice.get(id)?.presentation?.inventoryDieId)
      .find((id): id is string => id !== undefined)
  ))

  for (const id of doomedIds) backend.removeDie(id)
  await waitForRemovals(doomedIds)

  const spawnedIds: string[] = []
  try {
    targets.forEach((target, index) => {
      // A rerolled OWNED die comes back as itself; a rerolled plain die stays
      // plain rather than newly claiming an owned die the roll never asked for.
      const inventoryDieId = inventoryDieIds[index]
      const id = spawnDie(
        backend,
        inventoryDieId ? 'named' : 'generic',
        target.type,
        inventoryDieId,
      )
      replaceGroupMembers(plan, target.entryId, target.groupIndex, id)
      spawnedIds.push(id)
    })
  } catch (error) {
    // The dice for the unspawned targets are already gone from the table.
    // Retire their groups so the plan stops referencing dice that will never
    // settle — otherwise the HUD and the history row disagree about which
    // dice this roll owns.
    for (const target of targets) {
      const group = plan.entries
        .find((entry) => entry.entryId === target.entryId)?.groups[target.groupIndex]
      if (group && !group.rerolled) markGroupRerolled(plan, target.entryId, target.groupIndex)
    }
    publishPlan(plan, roll)
    throw error
  }

  // Published before `markDiceRolling`: every spawn above ran through
  // `addDie`/`addGenericDie`, which clear `activeSavedRoll` (and with it the
  // plan). Nothing may observe a settle while the plan is missing.
  publishPlan(plan, roll)
  await waitForSpawns(spawnedIds, ownerId)
  useDiceStore.getState().markDiceRolling(spawnedIds)
  await waitForSettle(spawnedIds)
  return true
}

/**
 * Run explosion waves until nothing explodes, the depth cap is reached, or the
 * table runs out of room.
 *
 * Returns how many explosions had to be skipped for want of capacity so the
 * caller can say so — silently dropping them would make the total look wrong.
 */
async function runExplosionWaves(
  plan: SavedRollPlan,
  roll: SavedRoll,
  { backend, ownerId }: SavedRollExecutionOptions,
): Promise<number> {
  let skipped = 0

  for (let wave = 0; wave < MAX_EXPLOSION_WAVES; wave++) {
    const targets = selectExplosionTargets(plan, currentFaces())
    if (targets.length === 0) break

    beginWave()

    const budget = availableRoomCapacityNow()
    const affordable = targets.slice(0, budget)
    skipped += targets.length - affordable.length

    if (affordable.length === 0) break

    const spawnedIds: string[] = []
    for (const target of affordable) {
      // An explosion is always a fresh basic die. It is a bonus die the entry
      // never asked for, so it must not silently consume an owned die the
      // player was saving — and the die that triggered it is still on the table
      // and cannot be spawned twice anyway.
      const id = spawnDie(backend, 'generic', target.type)
      attachGroupMember(plan, target.entryId, target.groupIndex, id)
      spawnedIds.push(id)
    }

    // Republished before anything can observe a settle: the spawns above
    // cleared `activeSavedRoll` via the backend's own side effect.
    publishPlan(plan, roll)
    await waitForSpawns(spawnedIds, ownerId)
    useDiceStore.getState().markDiceRolling(spawnedIds)
    await waitForSettle(spawnedIds)

    if (affordable.length < targets.length) break
  }

  return skipped
}

function describeSkippedExplosions(skipped: number): string {
  return skipped === 1
    ? 'The table was full, so 1 explosion was skipped.'
    : `The table was full, so ${skipped} explosions were skipped.`
}

/**
 * Execute a saved roll on the table.
 *
 * Rejects only for failures that happen before the base wave starts rolling —
 * the caller renders those inline. Once `onBaseWaveStarted` has fired the
 * promise always resolves, and any later trouble is reported through
 * `useDiceStore.rollNotice`.
 */
export async function executePhysicalSavedRoll(
  roll: SavedRoll,
  options: SavedRollExecutionOptions,
): Promise<void> {
  const { backend, ownerId, onBaseWaveStarted } = options
  const diceStore = useDiceStore.getState()

  assertCapacity(roll, ownerId)

  const room = useMultiplayerStore.getState()
  const existingOwnedIds = Array.from(room.dice.values())
    .filter((die: MultiplayerDie) => die.ownerId === ownerId)
    .map((die) => die.id)

  room.clearRoomActionError()
  diceStore.clearAllDieStates()
  backend.clearAll()
  await waitForRoom('clear the current table', (state) => (
    existingOwnedIds.every((id) => !state.dice.has(id))
  ))

  // ── Base wave ───────────────────────────────────────────────────────────
  const plan = createSavedRollPlan(roll)
  const ledger: EntrySpawnLedger = { named: [], ownedFirst: [] }

  for (const entry of roll.dice) {
    spawnEntry(backend, plan, entry, ledger)
  }

  // The plan is the single record of which dice this roll owns; deriving the
  // wait set from it keeps a second parallel list from drifting out of sync.
  const baseIds = getPlanDiceIds(plan)

  if (baseIds.length === 0) {
    throw new Error('This saved roll has no dice to roll.')
  }

  await waitForSpawns(baseIds, ownerId)

  // Only now, with the room's echo in the store, is it known which dice actually
  // landed as basics. Published as a notice rather than an error: the roll is
  // complete and correct, some dice just look plain.
  const rollNotices = [
    countBasicSpawns(ledger.named),
    countBasicSpawns(ledger.ownedFirst),
  ] as const
  const spawnNotice = [
    rollNotices[0] > 0 ? describeMissingNamedDice(rollNotices[0]) : null,
    rollNotices[1] > 0 ? describeBasicFill(rollNotices[1]) : null,
  ].filter((line): line is string => line !== null).join(' ')

  const hasWaves = needsFollowUpWaves(roll)
  // Claim the roll cycle before `roll_started` lands, so the settle handler
  // already knows this is a multi-wave roll and holds the history row open.
  if (hasWaves) useDiceStore.getState().beginSavedRollWaves()

  try {
    publishPlan(plan, roll)

    const rollSequence = useMultiplayerStore.getState().rollStartedSequence
    backend.roll()
    await waitForRoom('start the saved roll', (state) => (
      state.rollStartedSequence > rollSequence
      && sameIdSet(state.lastRollStartedDiceIds, baseIds)
    ))
  } catch (error) {
    // The base roll never started, so the wave sequence opened above will never
    // run and nothing else would ever close it. Leaving the flag set is a
    // session-wide lockout: every saved roll and the HUD's Roll button stay
    // disabled, `recordDieSettled` never closes a cycle, and `roll_complete`
    // stays suppressed until the page is reloaded. Reachable from an ack
    // timeout, a socket drop, a room rejection, or a spawn-id mismatch.
    useDiceStore.getState().finishSavedRollWaves()
    throw error
  }

  onBaseWaveStarted?.()

  if (spawnNotice.length > 0) {
    useDiceStore.getState().setRollNotice(spawnNotice)
  }

  if (!hasWaves) return

  // ── Follow-up waves ─────────────────────────────────────────────────────
  // Past this point the panel is gone, so nothing here may throw at the caller.
  try {
    await waitForSettle(baseIds)
    await runRerollWave(plan, roll, options)
    const skipped = await runExplosionWaves(plan, roll, options)
    if (skipped > 0) {
      // Appended, not replaced: a substitution notice from the base wave is
      // still true, and the HUD shows one line.
      const existing = useDiceStore.getState().rollNotice
      useDiceStore.getState().setRollNotice(
        existing
          ? `${existing} ${describeSkippedExplosions(skipped)}`
          : describeSkippedExplosions(skipped),
      )
    }
  } catch (error) {
    useDiceStore.getState().setRollNotice(
      error instanceof Error
        ? `Follow-up dice stopped early: ${error.message}`
        : 'Follow-up dice stopped early.',
    )
  } finally {
    // Always closes the history row and releases the wave latch, so a failed
    // sequence cannot suppress the next roll's history entry. The attribution
    // mirrors the `roll_complete` row this path suppresses.
    useDiceStore.getState().finishSavedRollWaves(localRollingPlayer())
  }
}
