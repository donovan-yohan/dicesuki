import { describe, expect, it } from 'vitest'
import {
  MAX_EXPLOSION_WAVES,
  addGroup,
  aggregateSavedRollPlan,
  attachGroupMember,
  cloneSavedRollPlan,
  createSavedRollPlan,
  getExplodeFace,
  addPercentileGroup,
  getPlanDiceIds,
  getPlanPerDieBonuses,
  markGroupRerolled,
  replaceGroupMembers,
  selectExplosionTargets,
  selectRerollTargets,
} from './savedRollPlan'
import type { SavedRollPlan } from './savedRollPlan'
import type { DiceEntry, SavedRoll } from '../types/savedRolls'

function makeEntry(overrides: Partial<DiceEntry> = {}): DiceEntry {
  return {
    id: 'entry-1',
    type: 'd6',
    quantity: 1,
    perDieBonus: 0,
    ...overrides,
  }
}

function makeRoll(dice: DiceEntry[], flatBonus = 0): SavedRoll {
  return {
    id: 'roll-1',
    name: 'Test roll',
    dice,
    flatBonus,
    createdAt: 0,
  }
}

/** Build a plan whose single entry has one group per supplied die id. */
function planWithGroups(entry: DiceEntry, diceIds: string[], flatBonus = 0): SavedRollPlan {
  const plan = createSavedRollPlan(makeRoll([entry], flatBonus))
  for (const diceId of diceIds) addGroup(plan, entry.id, diceId)
  return plan
}

function faces(settled: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(settled))
}

describe('createSavedRollPlan', () => {
  it('copies the name, flat bonus, and every per-entry mechanic', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd8',
      quantity: 2,
      perDieBonus: 1,
      minimum: 2,
      maximum: 7,
      reroll: { condition: 'lessOrEqual', value: 2 },
      exploding: { on: 'max', limit: 2 },
      countSuccesses: { targetNumber: 5, criticalOn: 8, botchOn: 1 },
    })

    // Act
    const plan = createSavedRollPlan(makeRoll([entry], 3))

    // Assert
    expect(plan.name).toBe('Test roll')
    expect(plan.flatBonus).toBe(3)
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]).toEqual({
      entryId: 'e1',
      type: 'd8',
      perDieBonus: 1,
      keep: undefined,
      keepMode: undefined,
      minimum: 2,
      maximum: 7,
      reroll: { condition: 'lessOrEqual', value: 2 },
      exploding: { on: 'max', limit: 2 },
      countSuccesses: { targetNumber: 5, criticalOn: 8, botchOn: 1 },
      groups: [],
    })
  })

  it('projects every entry of a multi-entry roll, in order, with empty groups', () => {
    // Arrange
    const roll = makeRoll([
      makeEntry({ id: 'a', type: 'd6', quantity: 2 }),
      makeEntry({ id: 'b', type: 'd20', quantity: 1 }),
    ])

    // Act
    const plan = createSavedRollPlan(roll)

    // Assert
    expect(plan.entries.map((entry) => entry.entryId)).toEqual(['a', 'b'])
    expect(plan.entries.every((entry) => entry.groups.length === 0)).toBe(true)
  })

  it('sets keep only when more dice are rolled than kept', () => {
    // Arrange / Act
    const noRollCount = createSavedRollPlan(makeRoll([makeEntry({ quantity: 2 })]))
    const equalRollCount = createSavedRollPlan(
      makeRoll([makeEntry({ quantity: 2, rollCount: 2 })]),
    )
    const keepDrop = createSavedRollPlan(
      makeRoll([makeEntry({ quantity: 1, rollCount: 3, keepMode: 'highest' })]),
    )

    // Assert — `keep` mirrors `quantity`, the keep count, only when it bites
    expect(noRollCount.entries[0].keep).toBeUndefined()
    expect(equalRollCount.entries[0].keep).toBeUndefined()
    expect(keepDrop.entries[0].keep).toBe(1)
    expect(keepDrop.entries[0].keepMode).toBe('highest')
  })
})

describe('aggregateSavedRollPlan — plain sums', () => {
  it('sums settled faces and adds the flat bonus, keeping every die', () => {
    // Arrange
    const entry = makeEntry({ id: 'e1', type: 'd6', quantity: 2, perDieBonus: 0 })
    const plan = planWithGroups(entry, ['die-a', 'die-b'], 3)

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ 'die-a': 4, 'die-b': 5 }))

    // Assert
    expect(aggregate.total).toBe(12)
    expect(aggregate.isSuccessCounting).toBe(false)
    expect(aggregate.droppedCount).toBe(0)
    expect(aggregate.dice.get('die-a')).toEqual({
      entryId: 'e1',
      kept: true,
      isGroupRoot: true,
      bonus: 0,
    })
    expect(aggregate.dice.get('die-b')!.kept).toBe(true)
  })

  it('sums across entries and applies each entry own per-die bonus', () => {
    // Arrange
    const plan = createSavedRollPlan(
      makeRoll(
        [
          makeEntry({ id: 'a', type: 'd6', quantity: 2, perDieBonus: 1 }),
          makeEntry({ id: 'b', type: 'd20', quantity: 1, perDieBonus: 0 }),
        ],
        2,
      ),
    )
    addGroup(plan, 'a', 'a1')
    addGroup(plan, 'a', 'a2')
    addGroup(plan, 'b', 'b1')

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ a1: 3, a2: 5, b1: 11 }))

    // Assert — (3+1) + (5+1) + 11 + flat 2
    expect(aggregate.total).toBe(23)
    expect(aggregate.dice.get('a1')!.bonus).toBe(1)
    expect(aggregate.dice.get('b1')!.bonus).toBe(0)
  })

  it('applies the per-die bonus once per group, on the root only', () => {
    // Arrange — one logical die backed by a root plus one explosion chip
    const entry = makeEntry({ id: 'e1', type: 'd6', quantity: 1, perDieBonus: 2 })
    const plan = planWithGroups(entry, ['root'])
    attachGroupMember(plan, 'e1', 0, 'boom')

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ root: 6, boom: 3 }))

    // Assert — 6 + 3 = 9, bonus added exactly once
    expect(aggregate.total).toBe(11)
    expect(aggregate.dice.get('root')).toEqual({
      entryId: 'e1',
      kept: true,
      isGroupRoot: true,
      bonus: 2,
    })
    expect(aggregate.dice.get('boom')).toEqual({
      entryId: 'e1',
      kept: true,
      isGroupRoot: false,
      bonus: 0,
    })
  })
})

describe('aggregateSavedRollPlan — keep/drop', () => {
  it('keeps the highest group and drops the rest', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd20',
      quantity: 1,
      rollCount: 3,
      keepMode: 'highest',
    })
    const plan = planWithGroups(entry, ['low', 'high', 'mid'])

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ low: 5, high: 18, mid: 11 }))

    // Assert
    expect(aggregate.total).toBe(18)
    expect(aggregate.droppedCount).toBe(2)
    expect(aggregate.dice.get('high')!.kept).toBe(true)
    expect(aggregate.dice.get('low')!.kept).toBe(false)
    expect(aggregate.dice.get('mid')!.kept).toBe(false)
    expect([...aggregate.dice.values()].filter((die) => !die.kept)).toHaveLength(2)
  })

  it('keeps the lowest group when keepMode is lowest', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd20',
      quantity: 1,
      rollCount: 3,
      keepMode: 'lowest',
    })
    const plan = planWithGroups(entry, ['low', 'high', 'mid'])

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ low: 5, high: 18, mid: 11 }))

    // Assert
    expect(aggregate.total).toBe(5)
    expect(aggregate.droppedCount).toBe(2)
    expect(aggregate.dice.get('low')!.kept).toBe(true)
  })

  it('keeps more than one group when quantity allows', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd20',
      quantity: 2,
      rollCount: 4,
      keepMode: 'highest',
    })
    const plan = planWithGroups(entry, ['a', 'b', 'c', 'd'])

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ a: 2, b: 20, c: 7, d: 13 }))

    // Assert — 20 + 13
    expect(aggregate.total).toBe(33)
    expect(aggregate.droppedCount).toBe(2)
    expect(aggregate.dice.get('b')!.kept).toBe(true)
    expect(aggregate.dice.get('d')!.kept).toBe(true)
  })

  it('compares AFTER a minimum clamp, so a clamped low die can win keep-lowest', () => {
    // Arrange — raw faces 1/2/20; a minimum of 5 levels the two low dice
    const entry = makeEntry({
      id: 'e1',
      type: 'd20',
      quantity: 1,
      rollCount: 3,
      keepMode: 'lowest',
      minimum: 5,
    })
    const plan = planWithGroups(entry, ['one', 'two', 'twenty'])
    const settled = faces({ one: 1, two: 2, twenty: 20 })

    // Act
    const clamped = aggregateSavedRollPlan(plan, settled)
    const unclamped = aggregateSavedRollPlan(
      planWithGroups(makeEntry({ ...entry, minimum: undefined }), ['one', 'two', 'twenty']),
      settled,
    )

    // Assert — the clamp moved the TOTAL, so it ran before keep/drop
    expect(clamped.total).toBe(5)
    expect(unclamped.total).toBe(1)
  })

  it('compares AFTER a maximum clamp, so keep-highest scores the clamped value', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd20',
      quantity: 1,
      rollCount: 2,
      keepMode: 'highest',
      maximum: 6,
    })
    const plan = planWithGroups(entry, ['six', 'twenty'])

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ six: 6, twenty: 20 }))

    // Assert — never the raw 20
    expect(aggregate.total).toBe(6)
  })

  it('scores the kept group at its adjusted value, per-die bonus included', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd20',
      quantity: 1,
      rollCount: 2,
      keepMode: 'highest',
      perDieBonus: 3,
    })
    const plan = planWithGroups(entry, ['low', 'high'])

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ low: 4, high: 9 }))

    // Assert — 9 + 3, not 9 and not 4 + 3
    expect(aggregate.total).toBe(12)
    expect(aggregate.dice.get('high')!.kept).toBe(true)
  })
})

describe('aggregateSavedRollPlan — exploding chains and clamps', () => {
  it('sums a whole explosion chain into one group value', () => {
    // Arrange — 6 -> 6 -> 2 on a d6, with a +1 per logical die
    const entry = makeEntry({
      id: 'e1',
      type: 'd6',
      quantity: 1,
      perDieBonus: 1,
      exploding: { on: 'max' },
    })
    const plan = planWithGroups(entry, ['a'])
    attachGroupMember(plan, 'e1', 0, 'b')
    attachGroupMember(plan, 'e1', 0, 'c')

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ a: 6, b: 6, c: 2 }))

    // Assert — 14 + one bonus
    expect(aggregate.total).toBe(15)
    expect(aggregate.dice.get('a')!.isGroupRoot).toBe(true)
    expect(aggregate.dice.get('b')!.isGroupRoot).toBe(false)
    expect(aggregate.dice.get('c')!.isGroupRoot).toBe(false)
    expect([...aggregate.dice.values()].filter((die) => die.isGroupRoot)).toHaveLength(1)
  })

  it('raises a low face to the minimum', () => {
    // Arrange
    const entry = makeEntry({ id: 'e1', type: 'd6', quantity: 1, minimum: 4 })
    const plan = planWithGroups(entry, ['die'])

    // Act / Assert
    expect(aggregateSavedRollPlan(plan, faces({ die: 2 })).total).toBe(4)
    expect(aggregateSavedRollPlan(plan, faces({ die: 5 })).total).toBe(5)
  })

  it('lowers a high face to the maximum', () => {
    // Arrange
    const entry = makeEntry({ id: 'e1', type: 'd20', quantity: 1, maximum: 10 })
    const plan = planWithGroups(entry, ['die'])

    // Act / Assert
    expect(aggregateSavedRollPlan(plan, faces({ die: 18 })).total).toBe(10)
    expect(aggregateSavedRollPlan(plan, faces({ die: 3 })).total).toBe(3)
  })

  it('clamps the group TOTAL, not each member, matching rollEngine', () => {
    // Arrange — an exploded chain summing to 12, capped at 10
    const entry = makeEntry({
      id: 'e1',
      type: 'd6',
      quantity: 1,
      maximum: 10,
      exploding: { on: 'max' },
    })
    const plan = planWithGroups(entry, ['a'])
    attachGroupMember(plan, 'e1', 0, 'b')

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ a: 6, b: 6 }))

    // Assert — per-member clamping would give 6 + 6 = 12
    expect(aggregate.total).toBe(10)
  })

  it('adds the per-die bonus AFTER the clamp', () => {
    // Arrange
    const entry = makeEntry({ id: 'e1', type: 'd6', quantity: 1, maximum: 4, perDieBonus: 2 })
    const plan = planWithGroups(entry, ['die'])

    // Act / Assert — clamp(6) = 4, then +2; clamping after the bonus would give 4
    expect(aggregateSavedRollPlan(plan, faces({ die: 6 })).total).toBe(6)
  })
})

describe('aggregateSavedRollPlan — unsettled dice', () => {
  it('ignores an unsettled group instead of scoring it as zero', () => {
    // Arrange
    const entry = makeEntry({ id: 'e1', type: 'd6', quantity: 2 })
    const plan = planWithGroups(entry, ['settled', 'in-flight'], 1)

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ settled: 4 }))

    // Assert — a running total, plus the flat bonus
    expect(aggregate.total).toBe(5)
    expect(aggregate.droppedCount).toBe(0)
    // ...but the in-flight die is still tracked so the HUD can render it
    expect(aggregate.dice.has('in-flight')).toBe(true)
    expect(aggregate.dice.get('in-flight')!.entryId).toBe('e1')
  })

  it('counts a partially settled explosion chain from its settled members only', () => {
    // Arrange
    const entry = makeEntry({ id: 'e1', type: 'd6', quantity: 1, exploding: { on: 'max' } })
    const plan = planWithGroups(entry, ['a'])
    attachGroupMember(plan, 'e1', 0, 'b')

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ a: 6 }))

    // Assert
    expect(aggregate.total).toBe(6)
    expect(aggregate.dice.has('b')).toBe(true)
  })

  it('does not let an unsettled group consume a keep slot', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd20',
      quantity: 1,
      rollCount: 2,
      keepMode: 'highest',
    })
    const plan = planWithGroups(entry, ['in-flight', 'settled'])

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ settled: 3 }))

    // Assert — the only resolved group is kept, nothing is reported dropped
    expect(aggregate.total).toBe(3)
    expect(aggregate.droppedCount).toBe(0)
    expect(aggregate.dice.get('settled')!.kept).toBe(true)
  })

  it('scores nothing but the flat bonus while the whole table is in flight', () => {
    // Arrange
    const entry = makeEntry({ id: 'e1', type: 'd6', quantity: 2 })
    const plan = planWithGroups(entry, ['a', 'b'], 4)

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({}))

    // Assert
    expect(aggregate.total).toBe(4)
    expect(aggregate.droppedCount).toBe(0)
    expect(aggregate.dice.size).toBe(2)
  })
})

describe('aggregateSavedRollPlan — success counting', () => {
  it('counts successes, doubles criticals, and subtracts botches', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd10',
      quantity: 5,
      countSuccesses: { targetNumber: 7, criticalOn: 10, botchOn: 1 },
    })
    const plan = planWithGroups(entry, ['crit', 'hit', 'edge', 'botch', 'miss'], 5)

    // Act
    const aggregate = aggregateSavedRollPlan(
      plan,
      faces({ crit: 10, hit: 8, edge: 7, botch: 1, miss: 3 }),
    )

    // Assert — 2 + 1 + 1 - 1 + 0, flat bonus ignored
    expect(aggregate.isSuccessCounting).toBe(true)
    expect(aggregate.total).toBe(3)
  })

  it('counts one success per hit when no critical is configured', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd10',
      quantity: 3,
      countSuccesses: { targetNumber: 8 },
    })
    const plan = planWithGroups(entry, ['a', 'b', 'c'])

    // Act / Assert — a max face is a plain success without `criticalOn`
    expect(aggregateSavedRollPlan(plan, faces({ a: 10, b: 8, c: 2 })).total).toBe(2)
  })

  it('counts successes on the adjusted value, so a per-die bonus can promote a die', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd10',
      quantity: 2,
      perDieBonus: 2,
      countSuccesses: { targetNumber: 7 },
    })
    const plan = planWithGroups(entry, ['a', 'b'])

    // Act / Assert — 5 + 2 clears 7; 3 + 2 does not
    expect(aggregateSavedRollPlan(plan, faces({ a: 5, b: 3 })).total).toBe(1)
  })

  it('only counts kept dice when keep/drop is also active', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd10',
      quantity: 1,
      rollCount: 3,
      keepMode: 'highest',
      countSuccesses: { targetNumber: 6 },
    })
    const plan = planWithGroups(entry, ['a', 'b', 'c'])

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ a: 9, b: 8, c: 7 }))

    // Assert — three hits, one kept
    expect(aggregate.total).toBe(1)
    expect(aggregate.droppedCount).toBe(2)
  })

  it('ignores the flat bonus for a mixed sum + success roll', () => {
    // Arrange
    const plan = createSavedRollPlan(
      makeRoll(
        [
          makeEntry({ id: 'sum', type: 'd6', quantity: 1 }),
          makeEntry({
            id: 'succ',
            type: 'd10',
            quantity: 2,
            countSuccesses: { targetNumber: 6 },
          }),
        ],
        7,
      ),
    )
    addGroup(plan, 'sum', 's1')
    addGroup(plan, 'succ', 'x')
    addGroup(plan, 'succ', 'y')

    // Act
    const aggregate = aggregateSavedRollPlan(plan, faces({ s1: 4, x: 8, y: 3 }))

    // Assert — 4 (sum) + 1 (success), flat bonus dropped
    expect(aggregate.isSuccessCounting).toBe(true)
    expect(aggregate.total).toBe(5)
  })

  it('adds the flat bonus when no entry counts successes', () => {
    // Arrange
    const plan = planWithGroups(makeEntry({ id: 'e1', type: 'd6', quantity: 1 }), ['a'], 7)

    // Act / Assert
    expect(aggregateSavedRollPlan(plan, faces({ a: 4 })).total).toBe(11)
  })
})

describe('selectRerollTargets', () => {
  it('selects only the groups whose settled face meets a lessOrEqual condition', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd6',
      quantity: 3,
      reroll: { condition: 'lessOrEqual', value: 2 },
    })
    const plan = planWithGroups(entry, ['one', 'two', 'five'])

    // Act
    const targets = selectRerollTargets(plan, faces({ one: 1, two: 2, five: 5 }))

    // Assert
    expect(targets).toEqual([
      { entryId: 'e1', groupIndex: 0, type: 'd6', memberIds: ['one'] },
      { entryId: 'e1', groupIndex: 1, type: 'd6', memberIds: ['two'] },
    ])
  })

  it('selects only exact matches for an equals condition', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd20',
      quantity: 2,
      reroll: { condition: 'equals', value: 1 },
    })
    const plan = planWithGroups(entry, ['nat1', 'two'])

    // Act
    const targets = selectRerollTargets(plan, faces({ nat1: 1, two: 2 }))

    // Assert
    expect(targets).toHaveLength(1)
    expect(targets[0].memberIds).toEqual(['nat1'])
  })

  it('never revisits a group that has already been rerolled', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd6',
      quantity: 1,
      reroll: { condition: 'lessOrEqual', value: 2 },
    })
    const plan = planWithGroups(entry, ['first'])
    replaceGroupMembers(plan, 'e1', 0, 'second')

    // Act — the replacement is just as bad, but the reroll is spent
    const targets = selectRerollTargets(plan, faces({ second: 1 }))

    // Assert
    expect(targets).toEqual([])
  })

  it('never revisits a group marked rerolled without a replacement', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd6',
      quantity: 1,
      reroll: { condition: 'lessOrEqual', value: 2 },
    })
    const plan = planWithGroups(entry, ['first'])
    markGroupRerolled(plan, 'e1', 0)

    // Act / Assert
    expect(selectRerollTargets(plan, faces({ first: 1 }))).toEqual([])
  })

  it('skips a group whose die has not settled', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd6',
      quantity: 2,
      reroll: { condition: 'lessOrEqual', value: 2 },
    })
    const plan = planWithGroups(entry, ['in-flight', 'one'])

    // Act
    const targets = selectRerollTargets(plan, faces({ one: 1 }))

    // Assert
    expect(targets).toHaveLength(1)
    expect(targets[0].groupIndex).toBe(1)
  })

  it('returns every member of an exploded group so the whole chain is removed', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd6',
      quantity: 1,
      reroll: { condition: 'lessOrEqual', value: 2 },
      exploding: { on: 'max' },
    })
    const plan = planWithGroups(entry, ['root'])
    attachGroupMember(plan, 'e1', 0, 'boom')

    // Act — the condition reads the ROOT face, not the chain total
    const targets = selectRerollTargets(plan, faces({ root: 1, boom: 4 }))

    // Assert
    expect(targets).toHaveLength(1)
    expect(targets[0].memberIds).toEqual(['root', 'boom'])
  })

  it('returns nothing for an entry without a reroll config', () => {
    // Arrange
    const plan = planWithGroups(makeEntry({ id: 'e1', type: 'd6', quantity: 1 }), ['a'])

    // Act / Assert
    expect(selectRerollTargets(plan, faces({ a: 1 }))).toEqual([])
  })
})

describe('getExplodeFace', () => {
  it('resolves "max" per die type', () => {
    // Arrange / Act / Assert
    expect(getExplodeFace('d6', { on: 'max' })).toBe(6)
    expect(getExplodeFace('d10', { on: 'max' })).toBe(10)
    expect(getExplodeFace('d20', { on: 'max' })).toBe(20)
  })

  it('passes a numeric trigger through unchanged', () => {
    // Arrange / Act / Assert
    expect(getExplodeFace('d20', { on: 5 })).toBe(5)
  })
})

describe('selectExplosionTargets', () => {
  it('selects a group whose newest member landed on the max face', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd6',
      quantity: 2,
      exploding: { on: 'max' },
    })
    const plan = planWithGroups(entry, ['boom', 'dud'])

    // Act
    const targets = selectExplosionTargets(plan, faces({ boom: 6, dud: 3 }))

    // Assert — explosions add dice, they do not remove any
    expect(targets).toEqual([{ entryId: 'e1', groupIndex: 0, type: 'd6', memberIds: [] }])
  })

  it('resolves "max" per die type, so a d20 chains on 20 and not on 6', () => {
    // Arrange
    const entry = makeEntry({ id: 'e1', type: 'd20', quantity: 2, exploding: { on: 'max' } })
    const plan = planWithGroups(entry, ['twenty', 'six'])

    // Act
    const targets = selectExplosionTargets(plan, faces({ twenty: 20, six: 6 }))

    // Assert
    expect(targets).toHaveLength(1)
    expect(targets[0].groupIndex).toBe(0)
  })

  it('honours a numeric trigger face', () => {
    // Arrange
    const entry = makeEntry({ id: 'e1', type: 'd6', quantity: 2, exploding: { on: 5 } })
    const plan = planWithGroups(entry, ['five', 'six'])

    // Act
    const targets = selectExplosionTargets(plan, faces({ five: 5, six: 6 }))

    // Assert — 6 is the max face but not the configured trigger
    expect(targets).toHaveLength(1)
    expect(targets[0].groupIndex).toBe(0)
  })

  it('tests the NEWEST member, not the group total or the root', () => {
    // Arrange
    const entry = makeEntry({ id: 'e1', type: 'd6', quantity: 1, exploding: { on: 'max' } })
    const cooled = planWithGroups(entry, ['root'])
    attachGroupMember(cooled, 'e1', 0, 'tail')
    const hot = planWithGroups(entry, ['root'])
    attachGroupMember(hot, 'e1', 0, 'tail')

    // Act / Assert — the chain stops when the tail misses, continues when it hits
    expect(selectExplosionTargets(cooled, faces({ root: 6, tail: 2 }))).toEqual([])
    expect(selectExplosionTargets(hot, faces({ root: 6, tail: 6 }))).toHaveLength(1)
  })

  it('stops at MAX_EXPLOSION_WAVES even when the chain keeps hitting', () => {
    // Arrange — chain until the group sits at the cap
    const entry = makeEntry({ id: 'e1', type: 'd6', quantity: 1, exploding: { on: 'max' } })
    const plan = planWithGroups(entry, ['w0'])
    const settled = new Map<string, number>([['w0', 6]])
    for (let wave = 1; wave <= MAX_EXPLOSION_WAVES; wave++) {
      // Assert — still selectable one wave below the cap
      expect(selectExplosionTargets(plan, settled)).toHaveLength(1)
      attachGroupMember(plan, 'e1', 0, `w${wave}`)
      settled.set(`w${wave}`, 6)
    }

    // Act / Assert — at the cap the chain is refused despite a max face
    expect(plan.entries[0].groups[0].explosionDepth).toBe(MAX_EXPLOSION_WAVES)
    expect(selectExplosionTargets(plan, settled)).toEqual([])
  })

  it('honours a smaller per-entry explosion limit', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd6',
      quantity: 1,
      exploding: { on: 'max', limit: 1 },
    })
    const plan = planWithGroups(entry, ['a'])

    // Act / Assert — one wave allowed, then spent
    expect(selectExplosionTargets(plan, faces({ a: 6 }))).toHaveLength(1)
    attachGroupMember(plan, 'e1', 0, 'b')
    expect(selectExplosionTargets(plan, faces({ a: 6, b: 6 }))).toEqual([])
  })

  it('clamps a limit larger than MAX_EXPLOSION_WAVES down to the cap', () => {
    // Arrange
    const entry = makeEntry({
      id: 'e1',
      type: 'd6',
      quantity: 1,
      exploding: { on: 'max', limit: 99 },
    })
    const plan = planWithGroups(entry, ['w0'])
    const settled = new Map<string, number>([['w0', 6]])
    for (let wave = 1; wave <= MAX_EXPLOSION_WAVES; wave++) {
      attachGroupMember(plan, 'e1', 0, `w${wave}`)
      settled.set(`w${wave}`, 6)
    }

    // Act / Assert
    expect(selectExplosionTargets(plan, settled)).toEqual([])
  })

  it('skips a group whose newest member has not settled', () => {
    // Arrange
    const entry = makeEntry({ id: 'e1', type: 'd6', quantity: 1, exploding: { on: 'max' } })
    const plan = planWithGroups(entry, ['a'])

    // Act / Assert
    expect(selectExplosionTargets(plan, faces({}))).toEqual([])
  })

  it('returns nothing for an entry without an exploding config', () => {
    // Arrange
    const plan = planWithGroups(makeEntry({ id: 'e1', type: 'd6', quantity: 1 }), ['a'])

    // Act / Assert
    expect(selectExplosionTargets(plan, faces({ a: 6 }))).toEqual([])
  })
})

describe('plan selectors', () => {
  it('lists every referenced die id across entries and chains', () => {
    // Arrange
    const plan = createSavedRollPlan(
      makeRoll([
        makeEntry({ id: 'a', type: 'd6', quantity: 2 }),
        makeEntry({ id: 'b', type: 'd20', quantity: 1 }),
      ]),
    )
    addGroup(plan, 'a', 'a1')
    addGroup(plan, 'a', 'a2')
    attachGroupMember(plan, 'a', 0, 'a1-boom')
    addGroup(plan, 'b', 'b1')

    // Act / Assert
    expect(getPlanDiceIds(plan)).toEqual(['a1', 'a1-boom', 'a2', 'b1'])
  })

  it('returns an empty id list before any dice are planned', () => {
    // Arrange
    const plan = createSavedRollPlan(makeRoll([makeEntry({ id: 'a' })]))

    // Act / Assert
    expect(getPlanDiceIds(plan)).toEqual([])
    expect(getPlanPerDieBonuses(plan).size).toBe(0)
  })

  it('maps per-die bonuses onto group roots only, omitting zero bonuses', () => {
    // Arrange
    const plan = createSavedRollPlan(
      makeRoll([
        makeEntry({ id: 'a', type: 'd6', quantity: 2, perDieBonus: 2 }),
        makeEntry({ id: 'b', type: 'd20', quantity: 1, perDieBonus: 0 }),
      ]),
    )
    addGroup(plan, 'a', 'a1')
    addGroup(plan, 'a', 'a2')
    attachGroupMember(plan, 'a', 0, 'a1-boom')
    addGroup(plan, 'b', 'b1')

    // Act
    const bonuses = getPlanPerDieBonuses(plan)

    // Assert
    expect(Object.fromEntries(bonuses)).toEqual({ a1: 2, a2: 2 })
    expect(bonuses.has('a1-boom')).toBe(false)
    expect(bonuses.has('b1')).toBe(false)
  })

  it('ignores unknown entry ids instead of throwing', () => {
    // Arrange
    const plan = createSavedRollPlan(makeRoll([makeEntry({ id: 'a' })]))

    // Act
    addGroup(plan, 'nope', 'x')
    attachGroupMember(plan, 'nope', 0, 'y')
    replaceGroupMembers(plan, 'a', 4, 'z')
    markGroupRerolled(plan, 'a', 9)

    // Assert
    expect(getPlanDiceIds(plan)).toEqual([])
  })
})

describe('cloneSavedRollPlan', () => {
  it('detaches the clone so later waves cannot mutate the published plan', () => {
    // Arrange
    const plan = createSavedRollPlan(makeRoll([makeEntry({ id: 'e1', perDieBonus: 1 })], 2))
    addGroup(plan, 'e1', 'die-a')

    // Act
    const clone = cloneSavedRollPlan(plan)
    addGroup(clone, 'e1', 'die-b')
    attachGroupMember(clone, 'e1', 0, 'die-boom')
    markGroupRerolled(clone, 'e1', 0)

    // Assert
    expect(getPlanDiceIds(plan)).toEqual(['die-a'])
    expect(plan.entries[0].groups).toEqual([{ memberIds: ['die-a'] }])
    expect(plan.entries[0].groups[0].rerolled).toBeUndefined()
    // The clone took every mutation; `markGroupRerolled` retires group 0 by
    // emptying it, because its dice are already off the table.
    expect(clone.entries[0].groups[0]).toEqual({
      memberIds: [],
      rerolled: true,
      explosionDepth: 1,
    })
    expect(getPlanDiceIds(clone)).toEqual(['die-b'])
  })

  it('empties a retired group so it cannot reference removed dice', () => {
    // Arrange — a group whose reroll replacement never spawned
    const plan = createSavedRollPlan(makeRoll([makeEntry({ id: 'e1' })], 0))
    addGroup(plan, 'e1', 'die-gone')
    addGroup(plan, 'e1', 'die-kept')

    // Act
    markGroupRerolled(plan, 'e1', 0)

    // Assert — retired, and contributing nothing to the score
    expect(plan.entries[0].groups[0]).toEqual({ memberIds: [], rerolled: true })
    const aggregate = aggregateSavedRollPlan(plan, new Map([['die-kept', 4]]))
    expect(aggregate.total).toBe(4)
    expect(aggregate.dice.has('die-gone')).toBe(false)
  })

  it('copies the scalar plan fields verbatim', () => {
    // Arrange
    const plan = createSavedRollPlan(
      makeRoll([makeEntry({ id: 'e1', quantity: 1, rollCount: 2, keepMode: 'lowest' })], -3),
    )

    // Act
    const clone = cloneSavedRollPlan(plan)

    // Assert
    expect(clone).toEqual(plan)
    expect(clone).not.toBe(plan)
    expect(clone.entries[0]).not.toBe(plan.entries[0])
  })
})

describe('percentile pairs', () => {
  /** A d100 entry: `type` stays 'd10' (the ones half); the flag discriminates. */
  function percentileEntry(overrides: Partial<DiceEntry> = {}): DiceEntry {
    return makeEntry({ id: 'pct', type: 'd10', percentile: true, ...overrides })
  }

  function pairPlan(entry: DiceEntry = percentileEntry(), flatBonus = 0) {
    const plan = createSavedRollPlan(makeRoll([entry], flatBonus))
    addPercentileGroup(plan, entry.id, 'tens-1', 'ones-1')
    return plan
  }

  it('combines the pair rather than summing it', () => {
    // Arrange — 70 + 3
    const plan = pairPlan()

    // Act
    const aggregate = aggregateSavedRollPlan(plan, new Map([['tens-1', 70], ['ones-1', 3]]))

    // Assert
    expect(aggregate.total).toBe(73)
  })

  it('reads 00 + 0 as 100, not 0', () => {
    // Arrange / Act
    const aggregate = aggregateSavedRollPlan(
      pairPlan(),
      new Map([['tens-1', 0], ['ones-1', 0]]),
    )

    // Assert — the whole reason a pair cannot be scored as a plain sum
    expect(aggregate.total).toBe(100)
  })

  it('ignores a half-settled pair instead of scoring the tens die alone', () => {
    // Arrange — the ones die has not landed
    const plan = pairPlan(percentileEntry(), 5)

    // Act
    const aggregate = aggregateSavedRollPlan(plan, new Map([['tens-1', 90]]))

    // Assert — only the flat bonus; 90 is not a percentile result
    expect(aggregate.total).toBe(5)
  })

  it('applies clamps and the per-die bonus to the COMBINED value', () => {
    // Arrange — a 100 clamped to 50, then +2
    const plan = pairPlan(percentileEntry({ maximum: 50, perDieBonus: 2 }))

    // Act
    const aggregate = aggregateSavedRollPlan(plan, new Map([['tens-1', 0], ['ones-1', 0]]))

    // Assert
    expect(aggregate.total).toBe(52)
  })

  it('puts the pair bonus on the ones die, never the tens scaffolding', () => {
    // Arrange
    const plan = pairPlan(percentileEntry({ perDieBonus: 3 }))

    // Act
    const aggregate = aggregateSavedRollPlan(plan, new Map([['tens-1', 20], ['ones-1', 4]]))

    // Assert
    expect(getPlanPerDieBonuses(plan)).toEqual(new Map([['ones-1', 3]]))
    expect(aggregate.dice.get('ones-1')).toMatchObject({ bonus: 3, isGroupRoot: true })
    expect(aggregate.dice.get('tens-1')).toMatchObject({ bonus: 0, isGroupRoot: false })
  })

  it('keeps and drops whole pairs', () => {
    // Arrange — roll two d100s, keep the highest
    const entry = percentileEntry({ quantity: 1, rollCount: 2, keepMode: 'highest' })
    const plan = createSavedRollPlan(makeRoll([entry], 0))
    addPercentileGroup(plan, entry.id, 'tens-a', 'ones-a')
    addPercentileGroup(plan, entry.id, 'tens-b', 'ones-b')

    // Act — 12 versus 100
    const aggregate = aggregateSavedRollPlan(plan, new Map([
      ['tens-a', 10], ['ones-a', 2],
      ['tens-b', 0], ['ones-b', 0],
    ]))

    // Assert — both halves of the losing pair are dropped together
    expect(aggregate.total).toBe(100)
    expect(aggregate.droppedCount).toBe(1)
    expect(aggregate.dice.get('tens-a')?.kept).toBe(false)
    expect(aggregate.dice.get('ones-a')?.kept).toBe(false)
    expect(aggregate.dice.get('tens-b')?.kept).toBe(true)
    expect(aggregate.dice.get('ones-b')?.kept).toBe(true)
  })

  it('strips reroll and exploding from a legacy percentile entry', () => {
    // Arrange — a hand-edited saved_rolls row carrying both
    const entry = percentileEntry({
      reroll: { condition: 'lessOrEqual', value: 5, maxRerolls: 1 },
      exploding: { on: 'max' },
    })

    // Act
    const plan = createSavedRollPlan(makeRoll([entry], 0))

    // Assert — dropped at the choke point, not left to be half-honoured
    expect(plan.entries[0].reroll).toBeUndefined()
    expect(plan.entries[0].exploding).toBeUndefined()
  })

  it('never selects a pair for a reroll or explosion wave', () => {
    // Arrange — a legacy roll carrying mechanics the builder now hides
    const entry = percentileEntry({
      reroll: { condition: 'lessOrEqual', value: 5, maxRerolls: 1 },
      exploding: { on: 'max' },
    })
    const plan = pairPlan(entry)
    const faces = new Map([['tens-1', 0], ['ones-1', 0]])

    // Act / Assert — half a pair cannot be rerolled or exploded
    expect(selectRerollTargets(plan, faces)).toEqual([])
    expect(selectExplosionTargets(plan, faces)).toEqual([])
  })

  it('counts a pair as one success against a 1-100 target', () => {
    // Arrange
    const plan = pairPlan(percentileEntry({ countSuccesses: { targetNumber: 80 } }))

    // Act — 90 + 5 = 95
    const aggregate = aggregateSavedRollPlan(plan, new Map([['tens-1', 90], ['ones-1', 5]]))

    // Assert
    expect(aggregate.isSuccessCounting).toBe(true)
    expect(aggregate.total).toBe(1)
  })
})
