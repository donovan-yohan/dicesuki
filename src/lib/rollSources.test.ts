import { describe, expect, it } from 'vitest'
import { formatSavedRoll } from './diceHelpers'
import { rollDiceEntry } from './rollEngine'
import {
  collapseRollSources,
  createAnonymousRollSource,
  createSpecificDieRollSource,
  expandDiceEntrySources,
  getDiceEntrySourceQuantity,
  getEntrySlotSummary,
  getSpecificDieIds,
  getRollDiceCount,
  normalizeSavedRollSources,
  pinDieToEntry,
  resizeRollSources,
  unpinDieFromEntry,
  withNormalizedRollSources,
  withRollSources,
} from './rollSources'
import type { DiceEntry, SavedRoll } from '../types/savedRolls'

describe('rollSources', () => {
  it('drops malformed persisted sources instead of throwing during normalization', () => {
    const corruptEntry = {
      id: 'corrupt-entry',
      type: 'd6',
      quantity: Number.NaN,
      perDieBonus: 0,
      sources: [
        { kind: 'specific' },
        { kind: 'anonymous', quantity: Number.POSITIVE_INFINITY },
      ],
    } as unknown as DiceEntry

    expect(expandDiceEntrySources(corruptEntry)).toEqual([
      { kind: 'anonymous', quantity: 1 },
    ])
  })

  it('falls back when persisted sources or dice are not arrays', () => {
    const corruptEntry = {
      id: 'corrupt-entry',
      type: 'd6',
      quantity: 2,
      perDieBonus: 0,
      sources: { kind: 'anonymous', quantity: 99 },
    } as unknown as DiceEntry

    expect(expandDiceEntrySources(corruptEntry)).toEqual([
      { kind: 'anonymous', quantity: 1 },
      { kind: 'anonymous', quantity: 1 },
    ])
    expect(normalizeSavedRollSources({
      id: 'corrupt-roll',
      name: 'Corrupt roll',
      dice: 'not-an-array',
      flatBonus: 0,
      createdAt: 1,
    } as unknown as SavedRoll).dice).toEqual([])
  })

  it('reconciles stale sources when an existing entry quantity changes', () => {
    const entry: DiceEntry = {
      id: 'anon-d6',
      type: 'd6',
      quantity: 1,
      perDieBonus: 0,
      sources: [createAnonymousRollSource(1)],
    }

    const resized = withNormalizedRollSources({ ...entry, quantity: 3 })

    expect(resized.sources).toEqual([createAnonymousRollSource(3)])
    expect(getDiceEntrySourceQuantity(resized)).toBe(3)
  })

  it('preserves multiple anonymous skin groups when shrinking quantity', () => {
    const entry: DiceEntry = {
      id: 'multi-skin-d6',
      type: 'd6',
      quantity: 3,
      perDieBonus: 0,
      sources: [
        createAnonymousRollSource(2, 'red'),
        createAnonymousRollSource(2, 'blue'),
      ],
    }

    const resized = withNormalizedRollSources(entry)

    expect(resized.sources).toEqual([
      createAnonymousRollSource(2, 'red'),
      createAnonymousRollSource(1, 'blue'),
    ])
    expect(getDiceEntrySourceQuantity(resized)).toBe(3)
  })

  it('represents anonymous quantities and specific owned dice in one saved roll', () => {
    const roll: SavedRoll = normalizeSavedRollSources({
      id: 'mixed-roll',
      name: 'Fireball plus lucky attack',
      dice: [
        {
          id: 'anon-d6',
          type: 'd6',
          quantity: 8,
          perDieBonus: 0,
          sources: [createAnonymousRollSource(8)],
        },
        {
          id: 'lucky-d20',
          type: 'd20',
          quantity: 1,
          perDieBonus: 0,
          sources: [createSpecificDieRollSource('die_lucky_d20', 'skin_gold')],
        },
      ],
      flatBonus: 0,
      createdAt: 1,
    })

    expect(getDiceEntrySourceQuantity(roll.dice[0])).toBe(8)
    expect(getDiceEntrySourceQuantity(roll.dice[1])).toBe(1)
    expect(getSpecificDieIds(roll.dice[1])).toEqual(['die_lucky_d20'])
    expect(formatSavedRoll(roll)).toBe('8d6 + 1d20 [1 specific]')
  })

  it('migrates legacy quantity and skinId into anonymous roll sources', () => {
    const legacyEntry: DiceEntry = {
      id: 'legacy',
      type: 'd6',
      quantity: 3,
      perDieBonus: 0,
      skinId: 'classic-red',
    }

    const sources = expandDiceEntrySources(legacyEntry)

    expect(sources).toHaveLength(3)
    expect(sources).toEqual([
      { kind: 'anonymous', quantity: 1, skinId: 'classic-red' },
      { kind: 'anonymous', quantity: 1, skinId: 'classic-red' },
      { kind: 'anonymous', quantity: 1, skinId: 'classic-red' },
    ])
  })

  it('keeps roll-source metadata on rolled dice', () => {
    const entry: DiceEntry = withRollSources(
      {
        id: 'owned-entry',
        type: 'd20',
        quantity: 1,
        perDieBonus: 0,
      },
      [createSpecificDieRollSource('die_lucky_d20')]
    )

    const result = rollDiceEntry(entry)

    expect(result.rolls).toHaveLength(1)
    expect(result.rolls[0].source).toMatchObject({
      kind: 'specific',
      dieId: 'die_lucky_d20',
      slotIndex: 0,
    })
  })
})


function getTotalQuantity(sources: ReturnType<typeof createAnonymousRollSource>[]) {
  return sources.reduce((total, source) => total + (source.kind === 'anonymous' ? source.quantity : 1), 0)
}

describe('resizeRollSources', () => {
  const a = createSpecificDieRollSource('die-a')
  const b = createSpecificDieRollSource('die-b')
  const c = createSpecificDieRollSource('die-c')

  it('appends generic dice when growing past owned dice', () => {
    // Arrange / Act
    const result = resizeRollSources([a, b], 5)

    // Assert
    expect(result.sources).toEqual([a, b, createAnonymousRollSource(3)])
    expect(result.droppedDieIds).toEqual([])
  })

  it('grows a trailing generic group in place instead of appending a new one', () => {
    // Arrange / Act
    const result = resizeRollSources([a, createAnonymousRollSource(2)], 6)

    // Assert — one merged group, not [.., anon(2), anon(3)]
    expect(result.sources).toEqual([a, createAnonymousRollSource(5)])
  })

  it('keeps repeated single increments collapsed into one generic group', () => {
    // Arrange
    let sources = [createAnonymousRollSource(1)]

    // Act — five presses of "+"
    for (let i = 0; i < 5; i++) {
      sources = resizeRollSources(sources, getTotalQuantity(sources) + 1).sources
    }

    // Assert — one source of 6, not six sources of 1
    expect(sources).toEqual([createAnonymousRollSource(6)])
  })

  it('does not merge plain growth into a skinned generic group', () => {
    // Arrange — merging would silently relabel the new dice with that skin
    const skinned = createAnonymousRollSource(2, 'neon')

    // Act
    const result = resizeRollSources([skinned], 4)

    // Assert
    expect(result.sources).toEqual([skinned, createAnonymousRollSource(2)])
  })

  it('returns a copy when the target already matches, never the input array', () => {
    // Arrange
    const sources = [a, createAnonymousRollSource(2)]

    // Act
    const result = resizeRollSources(sources, 3)

    // Assert
    expect(result.sources).not.toBe(sources)
    expect(result.sources).toEqual(sources)
  })

  it('gives up generic dice before touching owned dice when shrinking', () => {
    // Arrange — 3 owned + 5 generic = 8 dice
    const sources = [a, b, c, createAnonymousRollSource(5)]

    // Act — down to 4
    const result = resizeRollSources(sources, 4)

    // Assert — every owned die survives, generics absorb the whole cut
    expect(result.sources).toEqual([a, b, c, createAnonymousRollSource(1)])
    expect(result.droppedDieIds).toEqual([])
  })

  it('removes a generic source entirely when it is fully consumed', () => {
    // Arrange
    const sources = [a, createAnonymousRollSource(2)]

    // Act
    const result = resizeRollSources(sources, 1)

    // Assert
    expect(result.sources).toEqual([a])
    expect(result.droppedDieIds).toEqual([])
  })

  it('drops owned dice from the end only once generics are exhausted', () => {
    // Arrange — 3 owned + 1 generic = 4 dice
    const sources = [a, b, c, createAnonymousRollSource(1)]

    // Act — down to 2
    const result = resizeRollSources(sources, 2)

    // Assert — generic goes first, then the last owned die
    expect(result.sources).toEqual([a, b])
    expect(result.droppedDieIds).toEqual(['die-c'])
  })

  it('reports every dropped owned die in original order', () => {
    // Arrange
    const sources = [a, b, c]

    // Act
    const result = resizeRollSources(sources, 1)

    // Assert
    expect(result.sources).toEqual([a])
    expect(result.droppedDieIds).toEqual(['die-b', 'die-c'])
  })

  it('never shrinks below a single die', () => {
    // Arrange / Act
    const result = resizeRollSources([a, b], 0)

    // Assert
    expect(result.sources).toEqual([a])
    expect(result.droppedDieIds).toEqual(['die-b'])
  })
})

describe('getRollDiceCount', () => {
  it('sums the physical dice across every entry', () => {
    // Arrange
    const dice: DiceEntry[] = [
      withRollSources({ id: '1', type: 'd6', quantity: 8, perDieBonus: 0 }, [createAnonymousRollSource(8)]),
      withRollSources({ id: '2', type: 'd20', quantity: 1, perDieBonus: 0 }, [createSpecificDieRollSource('die-a')]),
    ]

    // Act / Assert
    expect(getRollDiceCount(dice)).toBe(9)
  })

  it('counts what execution actually spawns for every entry', () => {
    // Arrange
    const dice: DiceEntry[] = [
      withRollSources({ id: '1', type: 'd6', quantity: 3, perDieBonus: 0 }, [
        createSpecificDieRollSource('die-a'),
        createAnonymousRollSource(2),
      ]),
    ]

    // Act / Assert — the guard must agree with expandDiceEntrySources
    expect(getRollDiceCount(dice)).toBe(expandDiceEntrySources(dice[0]).length)
  })

  it('treats a missing dice array as empty', () => {
    // Arrange / Act / Assert
    expect(getRollDiceCount(undefined)).toBe(0)
  })

  /**
   * Keep/drop entries roll more dice than they score. The room cap bounds what
   * is physically spawned, so the budget has to follow `rollCount`, not
   * `quantity` — a 2d20-keep-1 entry occupies two slots, not one.
   */
  it('counts the rolled dice of a keep/drop entry, not the kept ones', () => {
    // Arrange — advantage: roll 2, keep 1
    const entry: DiceEntry = {
      id: 'advantage',
      type: 'd20',
      quantity: 1,
      rollCount: 2,
      keepMode: 'highest',
      perDieBonus: 0,
      sources: [createAnonymousRollSource(2)],
    }

    // Act / Assert
    expect(getRollDiceCount([entry])).toBe(2)
    expect(getDiceEntrySourceQuantity(entry)).toBe(2)
  })

  it('stays equal to what expandDiceEntrySources actually spawns', () => {
    // Arrange — a keep/drop entry mixing an owned die with generic ones
    const dice: DiceEntry[] = [
      {
        id: 'elven-accuracy',
        type: 'd20',
        quantity: 1,
        rollCount: 3,
        keepMode: 'highest',
        perDieBonus: 0,
        sources: [createSpecificDieRollSource('my-lucky-d20'), createAnonymousRollSource(2)],
      },
      {
        id: 'damage',
        type: 'd6',
        quantity: 4,
        perDieBonus: 0,
        sources: [createAnonymousRollSource(4)],
      },
    ]

    // Act
    const spawned = dice.flatMap((entry) => expandDiceEntrySources(entry))

    // Assert — the guard and the executor agree on the physical dice count
    expect(getRollDiceCount(dice)).toBe(spawned.length)
    expect(spawned).toHaveLength(7)
  })

  it('reconciles a keep/drop entry whose persisted sources drifted', () => {
    // Arrange — rollCount says 3 but only one source survived
    const entry = {
      id: 'drifted',
      type: 'd20',
      quantity: 1,
      rollCount: 3,
      keepMode: 'highest',
      perDieBonus: 0,
      sources: [createSpecificDieRollSource('my-lucky-d20')],
    } as DiceEntry

    // Act / Assert — padded back up to the rolled count
    expect(getRollDiceCount([entry])).toBe(3)
    expect(expandDiceEntrySources(entry)).toHaveLength(3)
  })
})

/**
 * Pinning is the picker's whole vocabulary (`RollDicePicker.tsx`). Its
 * load-bearing invariant is that it moves dice between "pinned" and "auto"
 * WITHOUT changing how many dice the entry rolls — the builder's room-capacity
 * validation and the executor's spawn loop both key off that count.
 */
describe('pinning owned dice into an entry', () => {
  const entryOf = (sources: Parameters<typeof withRollSources>[1]): DiceEntry =>
    withRollSources({ id: 'e1', type: 'd20', quantity: 1, perDieBonus: 0 }, sources)

  it('replaces the first auto slot and keeps the dice count', () => {
    const entry = entryOf([createAnonymousRollSource(4)])

    const pinned = pinDieToEntry(entry, 'die-a')

    expect(getSpecificDieIds(pinned)).toEqual(['die-a'])
    expect(getRollDiceCount([pinned])).toBe(4)
    expect(pinned.sources).toEqual([
      createSpecificDieRollSource('die-a'),
      createAnonymousRollSource(3),
    ])
  })

  it('keeps pins in the order they were made', () => {
    const entry = entryOf([createAnonymousRollSource(4)])

    const pinned = pinDieToEntry(pinDieToEntry(entry, 'die-a'), 'die-b')

    expect(getSpecificDieIds(pinned)).toEqual(['die-a', 'die-b'])
    expect(pinned.sources).toEqual([
      createSpecificDieRollSource('die-a'),
      createSpecificDieRollSource('die-b'),
      createAnonymousRollSource(2),
    ])
  })

  it('refuses to pin the same die twice', () => {
    const entry = pinDieToEntry(entryOf([createAnonymousRollSource(4)]), 'die-a')

    expect(pinDieToEntry(entry, 'die-a')).toBe(entry)
  })

  it('refuses to pin when every slot is already pinned, rather than growing', () => {
    const entry = entryOf([createSpecificDieRollSource('die-a')])

    const unchanged = pinDieToEntry(entry, 'die-b')

    expect(unchanged).toBe(entry)
    expect(getRollDiceCount([entry])).toBe(1)
  })

  it('returns a released slot to plain auto fill, merged with its neighbours', () => {
    const entry = pinDieToEntry(entryOf([createAnonymousRollSource(4)]), 'die-a')

    const released = unpinDieFromEntry(entry, 'die-a')

    expect(getSpecificDieIds(released)).toEqual([])
    expect(getRollDiceCount([released])).toBe(4)
    // Merged back to ONE group, not "1 generic" + "3 generic".
    expect(released.sources).toEqual([createAnonymousRollSource(4)])
  })

  it('ignores an unpin for a die the entry never pinned', () => {
    const entry = entryOf([createAnonymousRollSource(2)])

    expect(unpinDieFromEntry(entry, 'die-z')).toBe(entry)
  })

  it('preserves a keep/drop policy across a pin', () => {
    const entry = withRollSources(
      { id: 'e1', type: 'd20', quantity: 1, perDieBonus: 0, rollCount: 2, keepMode: 'highest' },
      [createAnonymousRollSource(2)],
    )

    const pinned = pinDieToEntry(entry, 'die-a')

    expect(pinned.rollCount).toBe(2)
    expect(pinned.quantity).toBe(1)
    expect(pinned.keepMode).toBe('highest')
    expect(getRollDiceCount([pinned])).toBe(2)
  })

  it('pins the ONES half of a percentile entry without touching the pair count', () => {
    const entry = withRollSources(
      { id: 'e1', type: 'd10', quantity: 2, perDieBonus: 0, percentile: true },
      [createAnonymousRollSource(2)],
    )

    const pinned = pinDieToEntry(entry, 'die-a')

    expect(getSpecificDieIds(pinned)).toEqual(['die-a'])
    // Two d100s are FOUR physical dice — a tens die plus a ones die each.
    expect(getRollDiceCount([pinned])).toBe(4)
    const tensSpawns = expandDiceEntrySources(pinned)
    expect(tensSpawns).toHaveLength(2)
  })

  it('summarises an entry as pinned plus auto', () => {
    const entry = pinDieToEntry(entryOf([createAnonymousRollSource(3)]), 'die-a')

    expect(getEntrySlotSummary(entry)).toEqual({ total: 3, pinned: 1, auto: 2 })
  })
})

describe('collapseRollSources', () => {
  it('merges adjacent plain groups but not ones split by a pin', () => {
    expect(collapseRollSources([
      createAnonymousRollSource(1),
      createAnonymousRollSource(1),
      createSpecificDieRollSource('die-a'),
      createAnonymousRollSource(1),
    ])).toEqual([
      createAnonymousRollSource(2),
      createSpecificDieRollSource('die-a'),
      createAnonymousRollSource(1),
    ])
  })

  it('keeps differently skinned groups apart', () => {
    expect(collapseRollSources([
      createAnonymousRollSource(1, 'skin-a'),
      createAnonymousRollSource(1, 'skin-b'),
    ])).toEqual([
      createAnonymousRollSource(1, 'skin-a'),
      createAnonymousRollSource(1, 'skin-b'),
    ])
  })

  it('is a no-op on an empty list', () => {
    expect(collapseRollSources([])).toEqual([])
  })
})
