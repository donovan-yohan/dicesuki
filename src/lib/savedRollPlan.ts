/**
 * Saved Roll Plan
 *
 * The bridge between a saved roll's advanced mechanics and the *physical* dice
 * the room actually spawns.
 *
 * `rollEngine.ts` rolls a saved roll virtually with `Math.random()`. Nothing in
 * production uses it: real rolls are server-authoritative, so every mechanic has
 * to be expressed as "which physical dice do we spawn" plus "how do we read the
 * faces the room reports back". This module owns both halves:
 *
 * - a **plan** records which room dice belong to which entry, grouped into
 *   chains whose faces sum into one logical die result;
 * - **aggregation** turns the plan plus the settled faces into the displayed
 *   total, marking dropped dice so the HUD can dim them.
 *
 * The plan is client-side only. The room has no concept of a saved roll, and
 * `roll_complete.total` is a plain face sum (`server/core/src/room.rs`), so a
 * remote viewer cannot reproduce these totals — see `docs/guides/saved-rolls.md`.
 */

import type { DiceShape } from './geometries'
import { KEEP_MODE_DEFAULT, getDieMax, hasKeepDrop } from './diceHelpers'
import { combinePercentile, isPercentileEntry } from './percentileRolls'
import type {
  CompareMode,
  ExplodingConfig,
  KeepMode,
  RerollConfig,
  SavedRoll,
  SuccessCountingConfig,
} from '../types/savedRolls'

/**
 * Hard ceiling on how many times an exploding entry may chain.
 *
 * An exploding die is open-ended by definition, but every explosion costs a
 * physical room slot, and a runaway chain would both exhaust
 * `ROOM_DICE_CAPACITY` and keep the table busy for a long time. Three waves is
 * generous for real play (a d6 chaining three times is a 1-in-216 event) and
 * bounds the worst case at 4x the entry's dice.
 *
 * Recommended range: 1-5. Surfaced to players in the builder's Advanced
 * Options panel so the cap is never a silent surprise.
 */
export const MAX_EXPLOSION_WAVES = 3

/**
 * One logical die result, backed by one or more physical room dice.
 *
 * A plain die is a single member. An exploding die appends each explosion to
 * the same group so their faces sum, exactly like `4d6!` scoring a 6 then a 3
 * as a single 9. A rerolled die *replaces* its member: the original is removed
 * from the table, so only the replacement's face counts.
 */
export interface PlannedDieGroup {
  /** Room dice ids whose settled faces sum into this group's value. */
  memberIds: string[]
  /**
   * A percentile (d100) pair: `memberIds` is `[tensDieId, onesDieId]` and the
   * two faces COMBINE (`00 + 0` = 100) rather than summing. Scoring a pair as
   * a sum would read `00 + 0` as 0 and cap the die at 99.
   */
  percentile?: boolean
  /** Reroll is once-only; set as soon as this group has been replaced. */
  rerolled?: boolean
  /** Explosion waves this group has already produced. */
  explosionDepth?: number
}

/** A saved-roll entry projected onto the physical dice that represent it. */
export interface PlannedEntry {
  entryId: string
  type: DiceShape
  perDieBonus: number
  /** How many groups to keep; `undefined` keeps them all. */
  keep?: number
  keepMode?: KeepMode
  minimum?: number
  maximum?: number
  reroll?: RerollConfig
  exploding?: ExplodingConfig
  countSuccesses?: SuccessCountingConfig
  groups: PlannedDieGroup[]
}

/** Everything the HUD needs to score a saved roll from settled faces alone. */
export interface SavedRollPlan {
  name: string
  flatBonus: number
  entries: PlannedEntry[]
}

/** Per-die view of the aggregate, keyed by room die id. */
export interface AggregatedDie {
  entryId: string
  /** False for a die dropped by keep/drop — the HUD dims these. */
  kept: boolean
  /**
   * True for the one member of its group that carries the per-die bonus chip.
   * An explosion member is part of the same logical die and must not show (or
   * add) the bonus a second time; for a percentile pair this is the ones die.
   */
  isGroupRoot: boolean
  /** Per-die bonus attributable to this die (0 unless it is a group root). */
  bonus: number
}

export interface SavedRollAggregate {
  /** Displayed total: kept sum + per-die bonuses + flat bonus, or successes. */
  total: number
  isSuccessCounting: boolean
  dice: Map<string, AggregatedDie>
  /** Groups excluded by keep/drop. Drives the "N dropped" HUD hint. */
  droppedCount: number
}

/**
 * Project a settled-dice record onto the `id -> face` map aggregation wants.
 * Accepts anything with a `value`, so both `useDiceStore.settledDice` and a
 * `roll_complete` result list can be scored without copying their shapes here.
 */
export function facesFromSettled(
  settled: Iterable<[string, { value: number }]>,
): Map<string, number> {
  const faces = new Map<string, number>()
  for (const [id, die] of settled) faces.set(id, die.value)
  return faces
}

/** A group selected for a follow-up wave. */
export interface WaveTarget {
  entryId: string
  groupIndex: number
  type: DiceShape
  /** Members to physically remove (reroll only; empty for explosions). */
  memberIds: string[]
}

function compare(value: number, condition: CompareMode, target: number): boolean {
  switch (condition) {
    case 'equals':
      return value === target
    case 'lessThan':
      return value < target
    case 'lessOrEqual':
      return value <= target
    case 'greaterThan':
      return value > target
    case 'greaterOrEqual':
      return value >= target
    default:
      return false
  }
}

/** Resolve `exploding.on` to a concrete face for this die type. */
export function getExplodeFace(type: DiceShape, exploding: ExplodingConfig): number {
  return exploding.on === 'max' ? getDieMax(type) : exploding.on
}

/**
 * Start a plan for a saved roll. Groups are empty until the executor spawns
 * dice and calls {@link addGroup}.
 */
export function createSavedRollPlan(roll: SavedRoll): SavedRollPlan {
  return {
    name: roll.name,
    flatBonus: roll.flatBonus,
    entries: roll.dice.map((entry) => {
      // Reroll and exploding replace or add PHYSICAL dice, which a percentile
      // pair cannot express — you cannot reroll or explode half a d100. The
      // builder hides both, but a legacy or hand-edited `saved_rolls` row can
      // still carry them, so they are dropped here rather than left to be
      // half-honoured downstream. Keep/drop is fine: it keeps whole pairs.
      const supportsPhysicalWaves = !isPercentileEntry(entry)

      return {
        entryId: entry.id,
        type: entry.type,
        perDieBonus: entry.perDieBonus,
        keep: hasKeepDrop(entry) ? entry.quantity : undefined,
        // Resolved once, here, so nothing downstream has to guess.
        keepMode: hasKeepDrop(entry) ? entry.keepMode ?? KEEP_MODE_DEFAULT : entry.keepMode,
        minimum: entry.minimum,
        maximum: entry.maximum,
        reroll: supportsPhysicalWaves ? entry.reroll : undefined,
        exploding: supportsPhysicalWaves ? entry.exploding : undefined,
        countSuccesses: entry.countSuccesses,
        groups: [],
      }
    }),
  }
}

/** Deep-enough copy so a published plan cannot be mutated by a later wave. */
export function cloneSavedRollPlan(plan: SavedRollPlan): SavedRollPlan {
  return {
    ...plan,
    entries: plan.entries.map((entry) => ({
      ...entry,
      groups: entry.groups.map((group) => ({ ...group, memberIds: [...group.memberIds] })),
    })),
  }
}

/** Every room die id the plan currently references, in spawn order. */
export function getPlanDiceIds(plan: SavedRollPlan): string[] {
  return plan.entries.flatMap((entry) => entry.groups.flatMap((group) => group.memberIds))
}

/**
 * The one member of a group that carries the per-die bonus.
 *
 * A bonus applies once per LOGICAL die, so an explosion member never repeats
 * its root's bonus. For a percentile pair it is the ONES die: the tens half is
 * anonymous engine scaffolding that can never be an owned die, and the rest of
 * the app already treats the ones die as the pair's real die.
 */
function bonusMemberId(group: PlannedDieGroup): string | undefined {
  return group.percentile ? group.memberIds[1] : group.memberIds[0]
}

/**
 * Per-die bonus map for `ActiveSavedRoll`, keyed by room die id.
 * Only one member per group appears — see {@link bonusMemberId}.
 */
export function getPlanPerDieBonuses(plan: SavedRollPlan): Map<string, number> {
  const bonuses = new Map<string, number>()
  for (const entry of plan.entries) {
    if (entry.perDieBonus === 0) continue
    for (const group of entry.groups) {
      const id = bonusMemberId(group)
      if (id !== undefined) bonuses.set(id, entry.perDieBonus)
    }
  }
  return bonuses
}

/** Append a physical die to an entry as a new logical die result. */
export function addGroup(plan: SavedRollPlan, entryId: string, diceId: string): void {
  const entry = plan.entries.find((candidate) => candidate.entryId === entryId)
  if (!entry) return
  entry.groups.push({ memberIds: [diceId] })
}

/**
 * Record a d100 as ONE logical die backed by its two physical halves.
 * Order matters: the tens die is the group root and carries the per-die bonus.
 */
export function addPercentileGroup(
  plan: SavedRollPlan,
  entryId: string,
  tensDiceId: string,
  onesDiceId: string,
): void {
  const entry = plan.entries.find((candidate) => candidate.entryId === entryId)
  if (!entry) return
  entry.groups.push({ memberIds: [tensDiceId, onesDiceId], percentile: true })
}

/** Append an explosion result to an existing group and bank the wave. */
export function attachGroupMember(
  plan: SavedRollPlan,
  entryId: string,
  groupIndex: number,
  diceId: string,
): void {
  const group = plan.entries.find((entry) => entry.entryId === entryId)?.groups[groupIndex]
  if (!group) return
  group.memberIds.push(diceId)
  group.explosionDepth = (group.explosionDepth ?? 0) + 1
}

/** Swap a group's dice for its reroll replacement. The original is gone. */
export function replaceGroupMembers(
  plan: SavedRollPlan,
  entryId: string,
  groupIndex: number,
  diceId: string,
): void {
  const group = plan.entries.find((entry) => entry.entryId === entryId)?.groups[groupIndex]
  if (!group) return
  group.memberIds = [diceId]
  group.rerolled = true
}

/**
 * Retire a group whose reroll replacement could not be spawned.
 *
 * The original die was already removed from the table, so the group has no
 * dice left and never will: it is emptied as well as marked spent, otherwise
 * it would keep pointing at a die that can never settle and the HUD and the
 * history row would disagree about which dice the roll owns.
 */
export function markGroupRerolled(plan: SavedRollPlan, entryId: string, groupIndex: number): void {
  const group = plan.entries.find((entry) => entry.entryId === entryId)?.groups[groupIndex]
  if (!group) return
  group.rerolled = true
  group.memberIds = []
}

function clampFace(value: number, entry: PlannedEntry): number {
  let clamped = value
  if (entry.minimum !== undefined) clamped = Math.max(clamped, entry.minimum)
  if (entry.maximum !== undefined) clamped = Math.min(clamped, entry.maximum)
  return clamped
}

interface ResolvedGroup {
  index: number
  memberIds: string[]
  /** Sum of settled member faces, clamped, plus the per-die bonus. */
  value: number
}

/**
 * Groups with at least one settled member, scored.
 *
 * A group whose dice have not settled yet (or were removed mid-wave) is left
 * out entirely rather than counted as zero, so a partially settled table shows
 * a running total instead of a wrong one.
 */
function resolveGroups(entry: PlannedEntry, faces: Map<string, number>): ResolvedGroup[] {
  const resolved: ResolvedGroup[] = []

  entry.groups.forEach((group, index) => {
    if (group.percentile) {
      // Both halves or nothing: a d100 showing only its tens die is not a
      // partial result, it is no result at all.
      const [tensId, onesId] = group.memberIds
      const tens = faces.get(tensId)
      const ones = faces.get(onesId)
      if (tens === undefined || ones === undefined) return

      resolved.push({
        index,
        memberIds: group.memberIds,
        value: clampFace(combinePercentile(tens, ones), entry) + entry.perDieBonus,
      })
      return
    }

    let sum = 0
    let settledMembers = 0
    for (const memberId of group.memberIds) {
      const face = faces.get(memberId)
      if (face === undefined) continue
      sum += face
      settledMembers += 1
    }
    if (settledMembers === 0) return

    resolved.push({
      index,
      memberIds: group.memberIds,
      value: clampFace(sum, entry) + entry.perDieBonus,
    })
  })

  return resolved
}

function selectKept(entry: PlannedEntry, resolved: ResolvedGroup[]): ResolvedGroup[] {
  if (entry.keep === undefined || entry.keep >= resolved.length) return resolved

  const ordered = [...resolved].sort((a, b) => (
    entry.keepMode === 'lowest' ? a.value - b.value : b.value - a.value
  ))
  return ordered.slice(0, Math.max(0, entry.keep))
}

function countSuccesses(config: SuccessCountingConfig, values: number[]): number {
  let successes = 0
  for (const value of values) {
    if (compare(value, 'greaterOrEqual', config.targetNumber)) {
      successes += config.criticalOn !== undefined && value === config.criticalOn ? 2 : 1
    }
    if (config.botchOn !== undefined && value === config.botchOn) successes -= 1
  }
  return successes
}

/**
 * Score a plan against the faces the room reported.
 *
 * Mirrors `rollEngine.rollDiceEntry` so the virtual and physical engines agree:
 * clamp the die total, add the per-die bonus, keep/drop on the resulting
 * values, then either sum or count successes. As in `executeSavedRoll`, a roll
 * with any success-counting entry ignores the flat bonus (see
 * `SavedRoll.flatBonus`).
 */
export function aggregateSavedRollPlan(
  plan: SavedRollPlan,
  faces: Map<string, number>,
): SavedRollAggregate {
  const dice = new Map<string, AggregatedDie>()
  const isSuccessCounting = plan.entries.some((entry) => entry.countSuccesses !== undefined)
  let total = 0
  let droppedCount = 0

  for (const entry of plan.entries) {
    const resolved = resolveGroups(entry, faces)
    const kept = selectKept(entry, resolved)
    const keptIndices = new Set(kept.map((group) => group.index))

    entry.groups.forEach((group, index) => {
      const isKept = keptIndices.has(index)
      const bonusId = bonusMemberId(group)
      group.memberIds.forEach((memberId) => {
        dice.set(memberId, {
          entryId: entry.entryId,
          kept: isKept,
          isGroupRoot: memberId === bonusId,
          bonus: memberId === bonusId ? entry.perDieBonus : 0,
        })
      })
    })

    droppedCount += resolved.length - kept.length

    const values = kept.map((group) => group.value)
    total += entry.countSuccesses
      ? countSuccesses(entry.countSuccesses, values)
      : values.reduce((sum, value) => sum + value, 0)
  }

  if (!isSuccessCounting) total += plan.flatBonus

  return { total, isSuccessCounting, dice, droppedCount }
}

/**
 * Groups that must be physically rerolled.
 *
 * Reroll is once per group in this slice: `maxRerolls` and `recursive` are
 * honoured by the virtual engine but a physical reroll costs a spawn, so the
 * builder only offers "once" and this selector never revisits a spent group.
 */
export function selectRerollTargets(plan: SavedRollPlan, faces: Map<string, number>): WaveTarget[] {
  const targets: WaveTarget[] = []

  for (const entry of plan.entries) {
    if (!entry.reroll) continue

    entry.groups.forEach((group, groupIndex) => {
      // A d100 cannot be physically rerolled or exploded as a unit — the
      // builder hides both for percentile entries, and a legacy roll that
      // carries them is ignored rather than half-applied.
      if (group.percentile) return
      if (group.rerolled) return
      const face = faces.get(group.memberIds[0])
      if (face === undefined) return
      if (!compare(face, entry.reroll!.condition, entry.reroll!.value)) return

      targets.push({
        entryId: entry.entryId,
        groupIndex,
        type: entry.type,
        memberIds: [...group.memberIds],
      })
    })
  }

  return targets
}

/**
 * Groups whose newest die landed on the exploding face and may chain again.
 *
 * The check is against the raw face of the *last* member, not the group's
 * running total, so a chain continues only while it keeps hitting the trigger.
 */
export function selectExplosionTargets(
  plan: SavedRollPlan,
  faces: Map<string, number>,
): WaveTarget[] {
  const targets: WaveTarget[] = []

  for (const entry of plan.entries) {
    if (!entry.exploding) continue
    const explodeFace = getExplodeFace(entry.type, entry.exploding)
    const depthLimit = Math.min(entry.exploding.limit ?? MAX_EXPLOSION_WAVES, MAX_EXPLOSION_WAVES)

    entry.groups.forEach((group, groupIndex) => {
      if (group.percentile) return
      if ((group.explosionDepth ?? 0) >= depthLimit) return
      const newest = group.memberIds[group.memberIds.length - 1]
      if (faces.get(newest) !== explodeFace) return

      targets.push({ entryId: entry.entryId, groupIndex, type: entry.type, memberIds: [] })
    })
  }

  return targets
}
