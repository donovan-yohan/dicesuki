import { describe, it, expect } from 'vitest'
import {
  combinePercentile,
  derivePercentilePairs,
  formatDiceShapeLabel,
  formatDieFaceLabel,
  groupPercentileResults,
  isPercentileEntry,
  percentileOnesPresentation,
  percentileSumCorrection,
  percentileTensPresentation,
  PERCENTILE_MAX,
  PERCENTILE_MIN,
  PERCENTILE_ONES_SHAPE,
  PERCENTILE_TENS_SHAPE,
} from './percentileRolls'
import {
  calculateDiceEntryRange,
  formatDiceEntry,
  formatSavedRoll,
  getDieMax,
  getEntryMax,
  getEntryMin,
} from './diceHelpers'
import { getDiceFaceValues } from '../types/diceShape'
import { expandDiceEntrySpawns, getRollDiceCount } from './rollSources'
import { ROOM_DICE_CAPACITY } from '../config/roomCapacity'
import { getFaceRendererForShape } from './faceRenderers'
import { createFaceMaterialsArray, validateFaceNormalRules } from './faceMaterialMapping'
import { INVENTORY_DICE_SHAPES, isInventoryDiceShape } from '../types/diceShape'
import type { DiceEntry, SavedRoll } from '../types/savedRolls'
import * as THREE from 'three'

/**
 * Pairing lives on the DICE (their presentation blocks), never in roll state —
 * that is what makes it survive table edits, remote views and refreshes.
 */
function tensDie(diceId: string, pairId: string) {
  return { diceId, presentation: percentileTensPresentation(pairId) }
}

function onesDie(diceId: string, pairId: string) {
  return { diceId, presentation: percentileOnesPresentation(pairId) }
}

function plainDie(diceId: string) {
  return { diceId, presentation: undefined }
}

function percentileEntry(overrides: Partial<DiceEntry> = {}): DiceEntry {
  return {
    id: 'entry-1',
    type: PERCENTILE_ONES_SHAPE,
    quantity: 1,
    perDieBonus: 0,
    percentile: true,
    ...overrides,
  }
}

describe('combinePercentile', () => {
  it('sums the tens and ones faces', () => {
    expect(combinePercentile(0, 7)).toBe(7)
    expect(combinePercentile(30, 4)).toBe(34)
    expect(combinePercentile(90, 9)).toBe(99)
  })

  it('reads 00 + 0 as 100 (the top of the 1-100 range)', () => {
    expect(combinePercentile(0, 0)).toBe(PERCENTILE_MAX)
  })

  it('covers exactly 1-100 across every face combination', () => {
    const results = new Set<number>()
    for (const tens of getDiceFaceValues(PERCENTILE_TENS_SHAPE)) {
      for (const ones of getDiceFaceValues(PERCENTILE_ONES_SHAPE)) {
        results.add(combinePercentile(tens, ones))
      }
    }
    expect(results.size).toBe(100)
    expect(Math.min(...results)).toBe(PERCENTILE_MIN)
    expect(Math.max(...results)).toBe(PERCENTILE_MAX)
  })
})

describe('derivePercentilePairs', () => {
  it('pairs the two halves that share a percentilePairId', () => {
    expect(derivePercentilePairs([tensDie('t', 'p1'), onesDie('o', 'p1')]))
      .toEqual([{ tensDieId: 't', onesDieId: 'o' }])
  })

  it('ignores dice with no percentile presentation', () => {
    expect(derivePercentilePairs([plainDie('a'), plainDie('b')])).toEqual([])
  })

  it('refuses to pair halves from different rolls', () => {
    expect(derivePercentilePairs([tensDie('t', 'p1'), onesDie('o', 'p2')])).toEqual([])
  })

  it('refuses a half-visible pair (per-player filtering, removed partner)', () => {
    expect(derivePercentilePairs([tensDie('t', 'p1')])).toEqual([])
    expect(derivePercentilePairs([onesDie('o', 'p1')])).toEqual([])
  })

  it('refuses to pair two dice claiming the same role', () => {
    expect(derivePercentilePairs([tensDie('t1', 'p1'), tensDie('t2', 'p1')])).toEqual([])
  })

  it('keeps pairs in first-half order and survives interleaving', () => {
    expect(derivePercentilePairs([
      tensDie('t1', 'p1'),
      tensDie('t2', 'p2'),
      onesDie('o2', 'p2'),
      onesDie('o1', 'p1'),
    ])).toEqual([
      { tensDieId: 't1', onesDieId: 'o1' },
      { tensDieId: 't2', onesDieId: 'o2' },
    ])
  })
})

describe('percentileSumCorrection', () => {
  it('is zero when no dice are paired', () => {
    expect(percentileSumCorrection([{ ...plainDie('a'), value: 5 }])).toBe(0)
    expect(percentileSumCorrection([])).toBe(0)
  })

  it('is zero for any pair that already sums correctly', () => {
    expect(percentileSumCorrection([
      { ...tensDie('t', 'p1'), value: 30 },
      { ...onesDie('o', 'p1'), value: 4 },
    ])).toBe(0)
  })

  it('adds 100 for a 00 + 0 pair', () => {
    expect(percentileSumCorrection([
      { ...tensDie('t', 'p1'), value: 0 },
      { ...onesDie('o', 'p1'), value: 0 },
    ])).toBe(100)
  })

  it('corrects each double-zero pair independently', () => {
    expect(percentileSumCorrection([
      { ...tensDie('ta', 'a'), value: 0 }, { ...onesDie('oa', 'a'), value: 0 },
      { ...tensDie('tb', 'b'), value: 0 }, { ...onesDie('ob', 'b'), value: 3 },
      { ...tensDie('tc', 'c'), value: 0 }, { ...onesDie('oc', 'c'), value: 0 },
    ])).toBe(200)
  })

  it('skips a pair whose other half is not in view (per-player filtering)', () => {
    expect(percentileSumCorrection([{ ...tensDie('t', 'p1'), value: 0 }])).toBe(0)
    expect(percentileSumCorrection([{ ...onesDie('o', 'p1'), value: 0 }])).toBe(0)
  })

  it('is unaffected by unrelated dice joining the table (table-edit safety)', () => {
    const pair = [
      { ...tensDie('t', 'p1'), value: 0 },
      { ...onesDie('o', 'p1'), value: 0 },
    ]
    expect(percentileSumCorrection([...pair, { ...plainDie('d6'), value: 4 }])).toBe(100)
  })
})

describe('groupPercentileResults', () => {
  const tens = { ...tensDie('t', 'p1'), value: 0 }
  const ones = { ...onesDie('o', 'p1'), value: 0 }
  const loose = { ...plainDie('loose'), value: 6 }

  it('leaves unpaired dice alone', () => {
    expect(groupPercentileResults([loose])).toEqual([{ kind: 'die', die: loose }])
  })

  it('collapses a pair into one combined result at the first half position', () => {
    expect(groupPercentileResults([tens, ones, loose])).toEqual([
      { kind: 'percentile', tens, ones, value: 100 },
      { kind: 'die', die: loose },
    ])
  })

  it('still groups after an unrelated die is added to the table', () => {
    expect(groupPercentileResults([tens, ones, loose, { ...plainDie('extra'), value: 2 }]))
      .toEqual([
        { kind: 'percentile', tens, ones, value: 100 },
        { kind: 'die', die: loose },
        { kind: 'die', die: { ...plainDie('extra'), value: 2 } },
      ])
  })

  it('leaves a stray half as a plain die', () => {
    expect(groupPercentileResults([tens])).toEqual([{ kind: 'die', die: tens }])
  })
})

describe('formatDiceShapeLabel', () => {
  it('never surfaces the raw engine shape for a stray tens die', () => {
    expect(formatDiceShapeLabel('d10tens')).toBe('D100 (tens)')
    expect(formatDiceShapeLabel('d10tens')).not.toContain('d10tens')
  })

  it('uppercases every other shape', () => {
    expect(formatDiceShapeLabel('d10')).toBe('D10')
    expect(formatDiceShapeLabel('d20')).toBe('D20')
  })
})

describe('percentile dice entries', () => {
  it('flags only entries carrying the additive percentile marker', () => {
    expect(isPercentileEntry(percentileEntry())).toBe(true)
    expect(isPercentileEntry({ id: 'x', type: 'd10', quantity: 1, perDieBonus: 0 })).toBe(false)
  })

  it('renders as 1d100, not 1d10', () => {
    expect(formatDiceEntry(percentileEntry())).toBe('1d100')
    expect(formatDiceEntry(percentileEntry({ quantity: 3 }))).toBe('3d100')
    expect(formatDiceEntry({ id: 'x', type: 'd10', quantity: 1, perDieBonus: 0 })).toBe('1d10')
  })

  it('keeps the per-die bonus notation on the combined d100 value', () => {
    // S1's count-outside style (#212): the count sits outside the parens and the
    // die inside — and the die a percentile entry shows is the combined d100.
    expect(formatDiceEntry(percentileEntry({ perDieBonus: 2 }))).toBe('1(d100+2)')
    expect(formatDiceEntry(percentileEntry({ quantity: 4, perDieBonus: -1 }))).toBe('4(d100-1)')
  })

  it('ranges 1-100 per die, plus bonuses', () => {
    expect(getEntryMin(percentileEntry())).toBe(1)
    expect(getEntryMax(percentileEntry())).toBe(100)
    expect(calculateDiceEntryRange(percentileEntry())).toEqual({ min: 1, max: 100 })
    expect(calculateDiceEntryRange(percentileEntry({ quantity: 2 }))).toEqual({ min: 2, max: 200 })
    expect(calculateDiceEntryRange(percentileEntry({ perDieBonus: 5 }))).toEqual({ min: 6, max: 105 })
  })

  it('does not disturb an ordinary d10 entry', () => {
    const plain: DiceEntry = { id: 'x', type: 'd10', quantity: 1, perDieBonus: 0 }
    expect(getEntryMin(plain)).toBe(1)
    expect(getEntryMax(plain)).toBe(10)
    expect(calculateDiceEntryRange(plain)).toEqual({ min: 1, max: 10 })
  })

  it('formats inside a full saved roll', () => {
    const roll: SavedRoll = {
      id: 'roll',
      name: 'Percentile check',
      dice: [percentileEntry()],
      flatBonus: 4,
      createdAt: 0,
    }
    expect(formatSavedRoll(roll)).toBe('1d100 + 4')
  })
})

describe('d10tens engine shape', () => {
  it('reads 00-90', () => {
    expect(getDiceFaceValues(PERCENTILE_TENS_SHAPE)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90])
    expect(getDieMax(PERCENTILE_TENS_SHAPE)).toBe(90)
  })

  it('leaves the ones d10 reading 0-9 (no regression)', () => {
    expect(getDiceFaceValues('d10')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(getDieMax('d10')).toBe(10)
  })

  // A test asserting `D10TENS_FACE_NORMALS[i].value === D10_FACE_NORMALS[i].value * 10`
  // used to sit here. It could not fail: `geometries.ts` *builds* the table with
  // `D10_FACE_NORMALS.map(f => ({ value: f.value * 10, normal: f.normal }))`, so
  // `.map` guarantees the length, the value is the product by construction, and
  // `normal` is the same object reference. `diceShape.guard.test.ts` carries the
  // independently-written 00-90 expectation that actually pins this table.

  it('keeps opposite faces summing to 90', () => {
    expect(validateFaceNormalRules(PERCENTILE_TENS_SHAPE)).toEqual({ valid: true, errors: [] })
  })

  it('builds one material per kite, keyed by the tens face value', () => {
    const seen: number[] = []
    const materials = createFaceMaterialsArray(PERCENTILE_TENS_SHAPE, (faceValue) => {
      seen.push(faceValue)
      return new THREE.MeshBasicMaterial()
    })
    expect(materials).toHaveLength(10)
    expect(materials.every((material) => material !== undefined)).toBe(true)
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90])
  })

  it('labels faces zero-padded so 0 reads as 00', () => {
    expect(formatDieFaceLabel(PERCENTILE_TENS_SHAPE, 0)).toBe('00')
    expect(formatDieFaceLabel(PERCENTILE_TENS_SHAPE, 90)).toBe('90')
    expect(formatDieFaceLabel('d10', 0)).toBe('0')
    expect(formatDieFaceLabel('d20', 20)).toBe('20')
  })

  it('has its own face renderer, distinct from the plain d10', () => {
    expect(getFaceRendererForShape(PERCENTILE_TENS_SHAPE))
      .not.toBe(getFaceRendererForShape('d10'))
  })

  /*
   * These two used to go through `lib/inventoryDrag`, the inventory→builder drag
   * payload parser. The dice picker replaced dragging and that module is gone,
   * so they now assert the SAME claim against the ownership boundary the parser
   * was only ever a consumer of: `INVENTORY_DICE_SHAPES`. Everything that must
   * be player-ownable — the picker's candidate list, the toolbar, minting —
   * keys off it, so this is the check that actually keeps a tens die out.
   */
  it('is not an ownable inventory shape', () => {
    expect(isInventoryDiceShape(PERCENTILE_TENS_SHAPE)).toBe(false)
    expect(INVENTORY_DICE_SHAPES).not.toContain(PERCENTILE_TENS_SHAPE)
  })

  it('leaves the ones half ownable, so a d100 can still be pinned', () => {
    expect(isInventoryDiceShape(PERCENTILE_ONES_SHAPE)).toBe(true)
    expect(INVENTORY_DICE_SHAPES).toContain(PERCENTILE_ONES_SHAPE)
  })
})

describe('roll-wide dice cap (S1 30-dice room capacity)', () => {
  function percentileSources(quantity: number): DiceEntry {
    return percentileEntry({ quantity, sources: [{ kind: 'anonymous', quantity }] })
  }

  it('counts each percentile source as the TWO physical dice it spawns', () => {
    expect(getRollDiceCount([percentileSources(1)])).toBe(2)
    expect(getRollDiceCount([percentileSources(7)])).toBe(14)
  })

  it('still counts an ordinary entry one-for-one', () => {
    const plain: DiceEntry = {
      id: 'plain',
      type: 'd6',
      quantity: 4,
      perDieBonus: 0,
      sources: [{ kind: 'anonymous', quantity: 4 }],
    }
    expect(getRollDiceCount([plain])).toBe(4)
    expect(getRollDiceCount([plain, percentileSources(2)])).toBe(8)
  })

  it('stays equal to what the executor actually spawns', () => {
    // Load-bearing equivalence: builder validation and the execution guard must
    // never disagree with the spawn loop, so both read the same expansion.
    for (const entry of [percentileSources(3), percentileSources(1)]) {
      expect(getRollDiceCount([entry])).toBe(expandDiceEntrySpawns(entry).length)
    }
  })

  it('spawns tens-then-ones per pair, with matching pair indices', () => {
    const spawns = expandDiceEntrySpawns(percentileSources(2))
    expect(spawns.map((spawn) => spawn.percentile?.role))
      .toEqual(['tens', 'ones', 'tens', 'ones'])
    expect(spawns.map((spawn) => spawn.percentile?.pairIndex)).toEqual([0, 0, 1, 1])
  })

  it('never binds a specific owned die to the tens half', () => {
    // The tens die is an engine-only shape; an owned d10 can only ever be the
    // ones half.
    const spawns = expandDiceEntrySpawns(percentileEntry({
      quantity: 1,
      sources: [{ kind: 'specific', dieId: 'my-lucky-d10' }],
    }))
    expect(spawns).toHaveLength(2)
    expect(spawns[0].percentile?.role).toBe('tens')
    expect(spawns[0].source).toEqual({ kind: 'anonymous', quantity: 1 })
    expect(spawns[1].source).toEqual({ kind: 'specific', dieId: 'my-lucky-d10' })
  })

  it('allows 15 percentile dice (exactly the 30-dice cap) and caps 16', () => {
    expect(getRollDiceCount([percentileSources(15)])).toBe(ROOM_DICE_CAPACITY)
    expect(getRollDiceCount([percentileSources(15)])).toBeLessThanOrEqual(ROOM_DICE_CAPACITY)

    expect(getRollDiceCount([percentileSources(16)])).toBe(32)
    expect(getRollDiceCount([percentileSources(16)])).toBeGreaterThan(ROOM_DICE_CAPACITY)
  })
})
