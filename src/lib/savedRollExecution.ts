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

import type { DiceBackendState } from '../contexts/DiceBackendContext'
import { ROLL_DICE_CAPACITY_MESSAGE, ROOM_DICE_CAPACITY } from '../config/roomCapacity'
import { useDiceStore } from '../store/useDiceStore'
import { useMultiplayerStore, type MultiplayerDie } from '../store/useMultiplayerStore'
import type { SavedRoll } from '../types/savedRolls'
import { expandDiceEntrySources, getRollDiceCount } from './rollSources'
import {
  MAX_EXPLOSION_WAVES,
  addGroup,
  attachGroupMember,
  cloneSavedRollPlan,
  createSavedRollPlan,
  facesFromSettled,
  getPlanPerDieBonuses,
  replaceGroupMembers,
  selectExplosionTargets,
  selectRerollTargets,
  type SavedRollPlan,
  type WaveTarget,
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
 * Spawn one die for a wave target.
 * Returns the client request id, or throws with the room's own message.
 */
function spawnDie(
  backend: SavedRollBackend,
  type: WaveTarget['type'],
  inventoryDieId?: string,
): string {
  const id = inventoryDieId
    ? backend.addDie(type, inventoryDieId)
    : backend.addGenericDie(type)

  if (!id) {
    const actionError = useMultiplayerStore.getState().roomActionError
    throw new Error(actionError?.message ?? `Could not spawn ${type.toUpperCase()}.`)
  }
  return id
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
  targets.forEach((target, index) => {
    const id = spawnDie(backend, target.type, inventoryDieIds[index])
    replaceGroupMembers(plan, target.entryId, target.groupIndex, id)
    spawnedIds.push(id)
  })

  await waitForSpawns(spawnedIds, ownerId)
  useDiceStore.getState().markDiceRolling(spawnedIds)
  publishPlan(plan, roll)
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

    const budget = availableRoomCapacityNow()
    const affordable = targets.slice(0, budget)
    skipped += targets.length - affordable.length

    if (affordable.length === 0) break

    const spawnedIds: string[] = []
    for (const target of affordable) {
      // An explosion is always a fresh generic die: the owned die that
      // triggered it is still on the table and cannot be spawned twice.
      const id = spawnDie(backend, target.type)
      attachGroupMember(plan, target.entryId, target.groupIndex, id)
      spawnedIds.push(id)
    }

    await waitForSpawns(spawnedIds, ownerId)
    useDiceStore.getState().markDiceRolling(spawnedIds)
    publishPlan(plan, roll)
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
  const baseIds: string[] = []

  for (const entry of roll.dice) {
    for (const source of expandDiceEntrySources(entry)) {
      const id = spawnDie(
        backend,
        entry.type,
        source.kind === 'specific' ? source.dieId : undefined,
      )
      addGroup(plan, entry.id, id)
      baseIds.push(id)
    }
  }

  if (baseIds.length === 0) {
    throw new Error('This saved roll has no dice to roll.')
  }

  await waitForSpawns(baseIds, ownerId)

  const hasWaves = needsFollowUpWaves(roll)
  // Claim the roll cycle before `roll_started` lands, so the settle handler
  // already knows this is a multi-wave roll and holds the history row open.
  if (hasWaves) useDiceStore.getState().beginSavedRollWaves()
  publishPlan(plan, roll)

  const rollSequence = useMultiplayerStore.getState().rollStartedSequence
  backend.roll()
  await waitForRoom('start the saved roll', (state) => (
    state.rollStartedSequence > rollSequence
    && sameIdSet(state.lastRollStartedDiceIds, baseIds)
  ))

  onBaseWaveStarted?.()

  if (!hasWaves) return

  // ── Follow-up waves ─────────────────────────────────────────────────────
  // Past this point the panel is gone, so nothing here may throw at the caller.
  try {
    await waitForSettle(baseIds)
    await runRerollWave(plan, roll, options)
    const skipped = await runExplosionWaves(plan, roll, options)
    if (skipped > 0) {
      useDiceStore.getState().setRollNotice(describeSkippedExplosions(skipped))
    }
  } catch (error) {
    useDiceStore.getState().setRollNotice(
      error instanceof Error
        ? `Follow-up dice stopped early: ${error.message}`
        : 'Follow-up dice stopped early.',
    )
  } finally {
    // Always closes the history row and releases the wave latch, so a failed
    // sequence cannot suppress the next roll's history entry.
    useDiceStore.getState().finishSavedRollWaves()
  }
}
