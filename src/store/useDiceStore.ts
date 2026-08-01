import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
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
 * Roll cycles for history:
 * - A "roll cycle" starts when rollingDice goes from empty to non-empty
 * - All dice that enter rollingDice during the cycle accumulate in currentRollCycleDice
 * - When rollingDice empties, a history snapshot is saved containing only those dice
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
   * Transient, non-blocking notice about the roll currently on the table —
   * "the table filled up, 2 explosions were skipped". Follow-up waves run after
   * the saved-rolls panel has closed, so this is their only way to speak.
   */
  rollNotice: string | null

  markDiceRolling: (diceIds: string[]) => void
  recordDieSettled: (diceId: string, value: number, type: string, presentation?: DicePresentationMetadata) => void
  addRollToHistory: (snapshot: RollSnapshot) => void
  removeDieState: (diceId: string) => void
  clearAllDieStates: () => void
  setActiveSavedRoll: (roll: ActiveSavedRoll) => void
  clearActiveSavedRoll: () => void
  beginSavedRollWaves: () => void
  finishSavedRollWaves: (player?: RollSnapshot['player']) => void
  setRollNotice: (notice: string | null) => void
  clearHistory: () => void
  reset: () => void
}

/**
 * Build the history snapshot for a finished roll cycle.
 * Returns null when the cycle produced nothing worth recording.
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

  return { dice: cycleDice, sum, timestamp: Date.now() }
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
      rollNotice: null,

      markDiceRolling: (diceIds: string[]) => {
        set((state) => {
          const newSettled = new Map(state.settledDice)
          const wasEmpty = state.rollingDice.size === 0
          const newRolling = new Set(state.rollingDice)
          // A saved roll's follow-up waves join the cycle that is already in
          // flight instead of starting a new one: the first wave's dice have
          // all settled by then, so without this each explosion wave would
          // become its own history row with its own partial total.
          const newCycleDice = wasEmpty && !state.savedRollWavesPending
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

          // If all rolling dice have settled, save history snapshot — unless a
          // saved roll still owes follow-up waves, in which case the cycle is
          // not over and `finishSavedRollWaves` will close it out.
          if (
            newRolling.size === 0
            && state.currentRollCycleDice.size > 0
            && !state.savedRollWavesPending
          ) {
            const snapshot = buildCycleSnapshot(
              newSettled,
              state.currentRollCycleDice,
              state.activeSavedRoll,
            )

            if (snapshot) {
              return {
                settledDice: newSettled,
                rollingDice: newRolling,
                currentRollCycleDice: new Set<string>(),
                rollHistory: [...state.rollHistory, snapshot],
              }
            }
          }

          return {
            settledDice: newSettled,
            rollingDice: newRolling,
          }
        })
      },

      addRollToHistory: (snapshot: RollSnapshot) => {
        set((state) => ({
          rollHistory: [...state.rollHistory, snapshot],
        }))
      },

      removeDieState: (diceId: string) => {
        set((state) => {
          const newSettled = new Map(state.settledDice)
          newSettled.delete(diceId)

          const newRolling = new Set(state.rollingDice)
          newRolling.delete(diceId)

          const newCycleDice = new Set(state.currentRollCycleDice)
          newCycleDice.delete(diceId)

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

      beginSavedRollWaves: () => {
        set({ savedRollWavesPending: true })
      },

      /**
       * End the wave sequence and close its history row.
       *
       * Called whether the waves finished, ran out of table, or failed — an
       * abandoned sequence must still record what landed and must never leave
       * `savedRollWavesPending` stuck true, which would suppress every later
       * roll's history entry.
       */
      finishSavedRollWaves: (player?: RollSnapshot['player']) => {
        set((state) => {
          if (!state.savedRollWavesPending) return state
          if (state.rollingDice.size > 0 || state.currentRollCycleDice.size === 0) {
            return { savedRollWavesPending: false }
          }

          const snapshot = buildCycleSnapshot(
            state.settledDice,
            state.currentRollCycleDice,
            state.activeSavedRoll,
          )

          return {
            savedRollWavesPending: false,
            currentRollCycleDice: new Set<string>(),
            rollHistory: snapshot
              // This row stands in for the `roll_complete` row the wave path
              // suppresses, so it carries the same attribution — otherwise a
              // multiplayer wave roll would land in history with no player.
              ? [...state.rollHistory, player ? { ...snapshot, player } : snapshot]
              : state.rollHistory,
          }
        })
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
          rollNotice: null,
        })
      },
    }),
    {
      name: 'dicesuki-dice-rolls',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        rollHistory: state.rollHistory,
      }),
    }
  )
)
