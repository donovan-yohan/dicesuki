/**
 * Repair saved rolls that name dice which no longer exist.
 *
 * A saved roll can pin a SPECIFIC owned die (`{ kind: 'specific', dieId }`).
 * When that die leaves the collection the reference dangles. Execution already
 * copes — `useMultiplayerDiceBackend.addDie` substitutes a basic die and
 * `savedRollExecution` says so — but a dangling id is still wrong on disk: the
 * builder would keep showing a die the player does not have, and every future
 * roll would re-report the same substitution.
 *
 * So the id is rewritten to an anonymous source of the same quantity (one die),
 * which is exactly what a basic die is. Nothing else about the entry changes:
 * counts, bonuses, keep/drop, exploding and reroll all survive, and entries with
 * no dangling reference are returned untouched (same object identity), so a
 * repair pass over a healthy roll is a no-op.
 *
 * The one caller today is the inventory store's v4 → v5 migration, which drops
 * the retired 23-row local starter inventory and hands the exact ids it removed
 * to {@link pruneSavedRollsForRemovedDice}. Keyed on those ids specifically — a
 * blanket "is this die in the inventory right now?" sweep would wrongly wipe
 * references to authenticated server copies, which are never persisted and are
 * absent until sign-in completes.
 */

import type { RollSource, SavedRoll } from '../types/savedRolls'
import { createAnonymousRollSource, normalizeRollSources } from './rollSources'
import { useSavedRollsStore } from '../store/useSavedRollsStore'

function replaceRemovedSources(
  sources: RollSource[],
  removedDieIds: ReadonlySet<string>,
): RollSource[] | null {
  if (!sources.some(source => source.kind === 'specific' && removedDieIds.has(source.dieId))) {
    return null
  }
  return sources.map(source => (
    source.kind === 'specific' && removedDieIds.has(source.dieId)
      // A specific source is always exactly one die, so quantity is preserved
      // and the entry's totals cannot shift.
      ? createAnonymousRollSource(1, source.skinId)
      : source
  ))
}

/**
 * Rewrite every `specific` source naming a removed die into an anonymous one.
 * Returns the same array instance when nothing referenced a removed die.
 */
export function pruneRemovedDiceFromSavedRoll(
  roll: SavedRoll,
  removedDieIds: ReadonlySet<string>,
): SavedRoll {
  if (!Array.isArray(roll.dice) || roll.dice.length === 0) return roll

  let changed = false
  const dice = roll.dice.map(entry => {
    const replacement = replaceRemovedSources(normalizeRollSources(entry), removedDieIds)
    if (!replacement) return entry
    changed = true
    return { ...entry, sources: replacement }
  })

  return changed ? { ...roll, dice } : roll
}

/** Apply {@link pruneRemovedDiceFromSavedRoll} across a list of rolls. */
export function pruneRemovedDiceFromSavedRolls(
  rolls: readonly SavedRoll[],
  removedDieIds: ReadonlySet<string>,
): { rolls: SavedRoll[]; changedCount: number } {
  let changedCount = 0
  const next = rolls.map(roll => {
    const pruned = pruneRemovedDiceFromSavedRoll(roll, removedDieIds)
    if (pruned !== roll) changedCount += 1
    return pruned
  })
  return { rolls: next, changedCount }
}

/**
 * Repair the live saved-rolls store in place, persisting the result.
 *
 * Called from the inventory store's persist migration. The import of
 * `useSavedRollsStore` at the top of this module is deliberate: it forces the
 * saved-rolls store to evaluate (and therefore hydrate from localStorage) before
 * the inventory store's own `create()` runs, so this always operates on the
 * rehydrated rolls rather than the empty initial state.
 */
export function pruneSavedRollsForRemovedDice(removedDieIds: readonly string[]): void {
  if (removedDieIds.length === 0) return
  const removed = new Set(removedDieIds)

  const { savedRolls, currentlyEditing } = useSavedRollsStore.getState()
  const pruned = pruneRemovedDiceFromSavedRolls(savedRolls, removed)
  const prunedEditing = currentlyEditing
    ? pruneRemovedDiceFromSavedRoll(currentlyEditing, removed)
    : currentlyEditing

  if (pruned.changedCount === 0 && prunedEditing === currentlyEditing) return

  console.log(
    `[SavedRolls] Rewrote ${pruned.changedCount} saved roll(s) that named removed dice as basic dice`,
  )
  useSavedRollsStore.setState({
    savedRolls: pruned.rolls,
    currentlyEditing: prunedEditing,
  })
}
