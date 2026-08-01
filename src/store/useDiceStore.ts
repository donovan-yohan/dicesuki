import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { createClientId } from '../lib/clientId'
import type { DicePresentationMetadata } from '../lib/multiplayerMessages'
import { percentileSumCorrection } from '../lib/percentileRolls'
import {
  aggregateSavedRollPlan,
  facesFromSettled,
  type SavedRollPlan,
} from '../lib/savedRollPlan'

/**
 * Represents a single die that has settled with a face value
 */
export interface DieSettledState {
  diceId: string
  value: number
  type: string
  settledAt: number
  presentation?: DicePresentationMetadata
}

/**
 * Represents a snapshot of a completed roll cycle for history
 */
export interface RollSnapshot {
  /**
   * Stable unique id for this row, minted by whichever writer records it.
   *
   * The history list is keyed on this. `timestamp` cannot serve: two rolls that
   * land in the same millisecond — a remote player's `roll_complete` arriving
   * alongside ours, or any burst — collide into duplicate React keys.
   */
  id: string
  dice: DieSettledState[]
  /**
   * Roll total. Percentile pairs are already combined here (`00 + 0` = 100), so
   * this can differ from a plain sum of `dice[].value` — see
   * `percentileSumCorrection`.
   */
  sum: number
  timestamp: number
  /** Multiplayer-only: who rolled. Null/undefined in local mode. */
  player?: {
    id: string
    displayName: string
    color: string
  }
}

/**
 * Tracks the active saved roll context for bonus display.
 * This is transient state (not persisted) — do not add to partialize.
 * perDieBonuses uses Map which does not serialize to JSON.
 */
export interface ActiveSavedRoll {
  name: string
  flatBonus: number
  perDieBonuses: Map<string, number> // dice instance ID → per-die bonus
  /**
   * Advanced mechanics for this roll, mapped onto the physical dice the room
   * spawned. Present only for rolls that use keep/drop, exploding, reroll,
   * clamps or success counting; without it the total is the plain
   * faces + bonuses sum. See `src/lib/savedRollPlan.ts`.
   */
  plan?: SavedRollPlan
}

/**
 * Score the settled dice of a saved roll, mechanics included.
 *
 * Dice outside the plan (another player's, or ones the user dropped on the
 * table by hand) keep contributing their raw face, which is what the HUD has
 * always shown; the plan only changes how the roll's own dice are counted.
 */
function totalWithPlan(
  plan: SavedRollPlan,
  settled: Map<string, DieSettledState>,
  scope: Iterable<string>,
): number {
  const aggregate = aggregateSavedRollPlan(plan, facesFromSettled(settled))
  let total = aggregate.total

  const unplanned: DieSettledState[] = []
  for (const id of scope) {
    if (aggregate.dice.has(id)) continue
    const die = settled.get(id)
    if (!die) continue
    total += die.value
    unplanned.push(die)
  }

  // The plan combines its OWN percentile pairs (`combinePercentile`), so the
  // correction applies only to dice it does not own — a d100 the player dropped
  // on the table by hand, say. Applying it to planned dice would double-count.
  return total + percentileSumCorrection(unplanned)
}

/**
 * Zustand store for per-die roll state tracking
 *
 * Each die independently reports when it starts moving (markDiceRolling)
 * and when it settles (recordDieSettled). The UI sums all settled dice.
 *
 * Roll cycles:
 * - A "roll cycle" starts when rollingDice goes from empty to non-empty
 * - All dice that enter rollingDice during the cycle accumulate in currentRollCycleDice
 * - When rollingDice empties, the cycle closes (currentRollCycleDice is cleared)
 *
 * History has exactly ONE writer per roll (issue #211):
 * - ordinary rolls (solo and multiplayer, local and remote): the `roll_complete`
 *   handler in `useMultiplayerStore` calls `addRollToHistory`
 * - saved rolls with follow-up waves, where `roll_complete` is suppressed:
 *   `finishSavedRollWaves` snapshots the cycle
 * Closing a cycle never records one.
 */
interface DiceStore {
  settledDice: Map<string, DieSettledState>
  rollingDice: Set<string>
  currentRollCycleDice: Set<string>
  rollHistory: RollSnapshot[]
  activeSavedRoll: ActiveSavedRoll | null
  /**
   * True while a saved roll still has follow-up waves (reroll replacements or
   * explosions) to spawn. The whole sequence is ONE roll cycle, so history must
   * not snapshot at the end of the first wave — see `savedRollExecution.ts`.
   */
  savedRollWavesPending: boolean
  /**
   * The dice of the ONE explicit roll whose `roll_complete` row a wave sequence
   * stands in for — a ticket naming the roll, not a "suppress the next one" flag.
   *
   * Identity, not timing. `savedRollWavesPending` says only that waves are in
   * flight RIGHT NOW, and a saved roll that configures reroll/exploding but
   * triggers neither finishes its waves in the same task the base dice settle
   * in — before `roll_complete` has crossed the socket. Keying suppression off
   * the latch therefore let that message arrive to a cleared latch and write a
   * second row (issue #211 again). Matching on the roll's dice-id set drops
   * exactly the spoken-for roll, whenever it lands.
   *
   * One-shot: consumed on match, and dropped when a new cycle opens so a later
   * roll of an unchanged table can never inherit it.
   */
  suppressedRollDiceIds: readonly string[] | null
  /**
   * Inventory dice a roll being spawned has PINNED by id but has not put on the
   * table yet.
   *
   * A plain entry fills owned-first, and it picks from the same collection a
   * `specific` source elsewhere in the SAME roll is waiting to claim. Without a
   * reservation the plain source can take that die first, and the pinned source
   * then finds it "already on the table" and degrades to a basic — a wrong
   * result that also reports a die as missing when the player still owns it, and
   * one that depends on entry order and on `Math.random`.
   *
   * Held only for the base-wave spawn loop (see `savedRollExecution.ts`), which
   * is the only window in which the two can race.
   */
  reservedInventoryDieIds: Set<string>
  /**
   * Transient, non-blocking notice about the roll currently on the table —
   * "the table filled up, 2 explosions were skipped". Follow-up waves run after
   * the saved-rolls panel has closed, so this is their only way to speak.
   */
  rollNotice: string | null

  markDiceRolling: (diceIds: string[]) => void
  recordDieSettled: (diceId: string, value: number, type: string, presentation?: DicePresentationMetadata) => void
  /** Record a finished roll. The row's `id` is minted here, not by the caller. */
  addRollToHistory: (snapshot: Omit<RollSnapshot, 'id'>) => void
  /**
   * Drop a die. `player` attributes the compensating row written when the die
   * belonged to a roll still in flight — see the implementation.
   */
  removeDieState: (diceId: string, player?: RollSnapshot['player']) => void
  clearAllDieStates: () => void
  setActiveSavedRoll: (roll: ActiveSavedRoll) => void
  clearActiveSavedRoll: () => void
  /** `rollDiceIds` claims that roll's `roll_complete`. See `suppressedRollDiceIds`. */
  beginSavedRollWaves: (rollDiceIds?: readonly string[]) => void
  finishSavedRollWaves: (player?: RollSnapshot['player']) => void
  /** Consume the suppression ticket (the spoken-for `roll_complete` arrived). */
  clearSuppressedRollComplete: () => void
  reserveInventoryDice: (dieIds: readonly string[]) => void
  clearInventoryDiceReservations: () => void
  setRollNotice: (notice: string | null) => void
  clearHistory: () => void
  reset: () => void
}

/** Mint a history row id. See `RollSnapshot.id`. */
function newRollSnapshotId(): string {
  return createClientId('roll')
}

/**
 * Build the history snapshot for a finished roll cycle.
 * Returns null when the cycle produced nothing worth recording.
 *
 * Only `finishSavedRollWaves` uses this. An ordinary roll's row is written by
 * the `roll_complete` handler instead — see `recordDieSettled`.
 */
function buildCycleSnapshot(
  settled: Map<string, DieSettledState>,
  cycleIds: Set<string>,
  activeSavedRoll: ActiveSavedRoll | null,
): RollSnapshot | null {
  const cycleDice: DieSettledState[] = []
  for (const cycleId of cycleIds) {
    const die = settled.get(cycleId)
    if (die) cycleDice.push(die)
  }
  if (cycleDice.length === 0) return null

  const plan = activeSavedRoll?.plan
  const sum = plan
    ? totalWithPlan(plan, settled, cycleIds)
    // `00 + 0` reads 100, so a plain face sum needs the percentile correction.
    // The pairing is read off the dice's own presentation blocks, so it holds
    // regardless of what happened to the active saved roll (the room's own
    // total stays a plain sum by design — see src/lib/percentileRolls.ts).
    : cycleDice.reduce((acc, d) => acc + d.value, 0) + percentileSumCorrection(cycleDice)

  return { id: newRollSnapshotId(), dice: cycleDice, sum, timestamp: Date.now() }
}

export const useDiceStore = create<DiceStore>()(
  persist(
    (set) => ({
      settledDice: new Map(),
      rollingDice: new Set(),
      currentRollCycleDice: new Set(),
      rollHistory: [],
      activeSavedRoll: null,
      savedRollWavesPending: false,
      suppressedRollDiceIds: null,
      reservedInventoryDieIds: new Set(),
      rollNotice: null,

      markDiceRolling: (diceIds: string[]) => {
        set((state) => {
          const newSettled = new Map(state.settledDice)
          const wasEmpty = state.rollingDice.size === 0
          // A brand-new cycle means a brand-new explicit roll, so any unclaimed
          // ticket is stale. Without this, re-rolling an unchanged table after a
          // saved roll whose waves never triggered would present the SAME dice
          // ids and be swallowed as the already-recorded roll.
          const startsFreshCycle = wasEmpty && !state.savedRollWavesPending
          const newRolling = new Set(state.rollingDice)
          // A saved roll's follow-up waves join the cycle that is already in
          // flight instead of starting a new one: the first wave's dice have
          // all settled by then, so without this each explosion wave would
          // become its own history row with its own partial total.
          const newCycleDice = startsFreshCycle
            ? new Set<string>()
            : new Set(state.currentRollCycleDice)

          for (const id of diceIds) {
            newSettled.delete(id)
            newRolling.add(id)
            newCycleDice.add(id)
          }

          return {
            settledDice: newSettled,
            rollingDice: newRolling,
            currentRollCycleDice: newCycleDice,
            ...(startsFreshCycle ? { suppressedRollDiceIds: null } : {}),
          }
        })
      },

      recordDieSettled: (diceId: string, value: number, type: string, presentation?: DicePresentationMetadata) => {
        set((state) => {
          const newSettled = new Map(state.settledDice)
          newSettled.set(diceId, {
            diceId,
            value,
            type,
            settledAt: Date.now(),
            presentation,
          })

          const newRolling = new Set(state.rollingDice)
          newRolling.delete(diceId)

          // Draining the cycle CLOSES it; it does not record it.
          //
          // Snapshotting here as well as in the `roll_complete` handler wrote
          // the same roll twice — one unattributed row from this drain beside
          // one attributed row from the handler ("Roll #1 / 85" next to
          // "You / 85"), issue #211. The handler's row is the better survivor:
          // it is attributed, it is the only row a remote player's roll ever
          // had, and it covers the identical dice set (`pending.dice_ids`).
          //
          // A cycle only opens on `roll_started`, which the room emits solely
          // from `roll_player_dice`, and that always registers a pending roll.
          // Every cycle therefore has exactly one of three ends — and each one
          // records the roll somewhere, which is what makes recording nothing
          // here safe:
          //
          //  1. `roll_complete` arrives → the handler writes the row.
          //  2. A saved roll with follow-up waves claimed it → the handler drops
          //     that one message by ticket (`suppressedRollDiceIds`) and
          //     `finishSavedRollWaves` writes the attributed row instead. The
          //     close below is gated on the same latch so the cycle stays open
          //     across the waves and that snapshot sees every die.
          //  3. A die of the roll is REMOVED → the room cancels `pending_roll`
          //     and no `roll_complete` ever comes. `removeDieState` compensates
          //     by recording what had settled.
          //
          // Clearing the cycle here is also what stops a later knock and
          // re-settle from resurrecting a finished roll (`dice_knocked` never
          // reopens a cycle, so the re-settle lands with an empty cycle set).
          if (
            newRolling.size === 0
            && state.currentRollCycleDice.size > 0
            && !state.savedRollWavesPending
          ) {
            return {
              settledDice: newSettled,
              rollingDice: newRolling,
              currentRollCycleDice: new Set<string>(),
            }
          }

          return {
            settledDice: newSettled,
            rollingDice: newRolling,
          }
        })
      },

      addRollToHistory: (snapshot: Omit<RollSnapshot, 'id'>) => {
        set((state) => ({
          rollHistory: [...state.rollHistory, { ...snapshot, id: newRollSnapshotId() }],
        }))
      },

      removeDieState: (diceId: string, player?: RollSnapshot['player']) => {
        set((state) => {
          const newSettled = new Map(state.settledDice)
          newSettled.delete(diceId)

          const newRolling = new Set(state.rollingDice)
          newRolling.delete(diceId)

          const newCycleDice = new Set(state.currentRollCycleDice)
          newCycleDice.delete(diceId)

          // Removing a die the room is still tracking for an explicit roll
          // CANCELS that roll server-side (`remove_dice` drops `pending_roll` in
          // `server/core/src/room.rs`), so no `roll_complete` is ever coming and
          // the roll would leave no trace at all. Record what settled — a
          // partial row, the way the old settle-drain behaved — rather than lose
          // it. Compensation only; the real fix is the room completing or
          // explicitly cancelling the roll, which is a core change for both
          // targets and is tracked separately.
          //
          // Only for a cycle that is genuinely OPEN mid-roll. A die removed from
          // a settled table has already been recorded (the cycle closed on
          // drain), and the wave path removes rerolled dice on purpose, which is
          // its own business — hence the latch check.
          const cancelsRollInFlight = state.currentRollCycleDice.has(diceId)
            && !state.savedRollWavesPending

          if (cancelsRollInFlight) {
            const snapshot = newCycleDice.size > 0
              ? buildCycleSnapshot(newSettled, newCycleDice, state.activeSavedRoll)
              : null
            if (snapshot) {
              return {
                settledDice: newSettled,
                rollingDice: newRolling,
                currentRollCycleDice: new Set<string>(),
                rollHistory: [
                  ...state.rollHistory,
                  player ? { ...snapshot, player } : snapshot,
                ],
              }
            }
          }

          return {
            settledDice: newSettled,
            rollingDice: newRolling,
            currentRollCycleDice: newCycleDice,
          }
        })
      },

      clearAllDieStates: () => {
        set({
          settledDice: new Map(),
          rollingDice: new Set(),
          currentRollCycleDice: new Set(),
          // The notice describes the roll being cleared away, so it goes with it.
          rollNotice: null,
        })
      },

      setActiveSavedRoll: (roll: ActiveSavedRoll) => {
        set({ activeSavedRoll: roll })
      },

      /**
       * Forget the saved-roll context.
       *
       * MUST NOT touch `savedRollWavesPending`. Every spawn goes through
       * `useMultiplayerDiceBackend.addDie`/`addGenericDie`, whose first act is
       * to call this — including the spawns that `savedRollExecution` itself
       * issues for reroll and explosion waves. Clearing the wave flag here
       * tore down wave tracking on the first follow-up spawn, splitting the
       * roll across several history rows. The flag is owned exclusively by
       * `beginSavedRollWaves` / `finishSavedRollWaves`; the executor
       * re-publishes the plan after each wave's spawns.
       */
      clearActiveSavedRoll: () => {
        set({ activeSavedRoll: null })
      },

      beginSavedRollWaves: (rollDiceIds?: readonly string[]) => {
        set({
          savedRollWavesPending: true,
          ...(rollDiceIds ? { suppressedRollDiceIds: [...rollDiceIds] } : {}),
        })
      },

      /**
       * End the wave sequence and close its history row.
       *
       * Called whether the waves finished, ran out of table, or failed — an
       * abandoned sequence must still record what landed and must never leave
       * `savedRollWavesPending` stuck true, which would suppress every later
       * roll's history entry.
       *
       * Two outcomes, and never zero rows between them:
       * - Anything from the cycle has settled → record it, partial or complete.
       *   A sequence that gives up while dice are still in the air (a wave
       *   failure, a wait that timed out) used to bail out here and record
       *   NOTHING while its `roll_complete` stayed spoken for — the roll simply
       *   vanished. `buildCycleSnapshot` already takes only the cycle dice that
       *   have settled, so the partial roll is recorded instead of lost.
       * - Nothing settled at all → hand the roll back to `roll_complete` by
       *   releasing the ticket, rather than swallowing a row nobody wrote.
       *
       * The latch is released either way: leaving it set is a session-wide
       * lockout of every later roll's history entry.
       */
      finishSavedRollWaves: (player?: RollSnapshot['player']) => {
        set((state) => {
          if (!state.savedRollWavesPending) return state

          const snapshot = state.currentRollCycleDice.size > 0
            ? buildCycleSnapshot(
              state.settledDice,
              state.currentRollCycleDice,
              state.activeSavedRoll,
            )
            : null

          if (!snapshot) {
            return { savedRollWavesPending: false, suppressedRollDiceIds: null }
          }

          return {
            savedRollWavesPending: false,
            currentRollCycleDice: new Set<string>(),
            // This row stands in for the `roll_complete` row the wave path
            // suppresses, so it carries the same attribution — otherwise a
            // multiplayer wave roll would land in history with no player. The
            // ticket stays until that message arrives and is dropped.
            rollHistory: [...state.rollHistory, player ? { ...snapshot, player } : snapshot],
          }
        })
      },

      clearSuppressedRollComplete: () => {
        set((state) => (
          state.suppressedRollDiceIds === null ? state : { suppressedRollDiceIds: null }
        ))
      },

      /**
       * Claim inventory dice for a roll that is about to spawn, so its own
       * owned-first picks cannot take a die one of its `specific` sources has
       * pinned. Replaces any previous claim: only one roll spawns at a time
       * (the caller holds a reentrancy latch for the whole sequence).
       */
      reserveInventoryDice: (dieIds: readonly string[]) => {
        set({ reservedInventoryDieIds: new Set(dieIds) })
      },

      clearInventoryDiceReservations: () => {
        set((state) => (
          state.reservedInventoryDieIds.size === 0
            ? state
            : { reservedInventoryDieIds: new Set<string>() }
        ))
      },

      setRollNotice: (notice: string | null) => {
        set({ rollNotice: notice })
      },

      clearHistory: () => {
        set({ rollHistory: [] })
      },

      reset: () => {
        set({
          settledDice: new Map(),
          rollingDice: new Set(),
          currentRollCycleDice: new Set(),
          rollHistory: [],
          activeSavedRoll: null,
          savedRollWavesPending: false,
          suppressedRollDiceIds: null,
          reservedInventoryDieIds: new Set(),
          rollNotice: null,
        })
      },
    }),
    {
      name: 'dicesuki-dice-rolls',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      /**
       * v1 gave every history row a stable `id` (`RollSnapshot.id`). Rows saved
       * before that have none, and the list used to key on `timestamp`, so
       * backfill an id per row rather than leaving the UI to collide on ties.
       */
      migrate: (persistedState) => {
        // No version check: `persist` only calls this when the stored version is
        // BELOW the current one, so v0 is the only input this can ever see.
        const state = persistedState as { rollHistory?: RollSnapshot[] } | null | undefined
        if (!state) return { rollHistory: [] } as unknown as DiceStore
        return {
          ...state,
          rollHistory: (state.rollHistory ?? []).map((roll) => (
            roll.id ? roll : { ...roll, id: newRollSnapshotId() }
          )),
        } as unknown as DiceStore
      },
      partialize: (state) => ({
        rollHistory: state.rollHistory,
      }),
    }
  )
)
