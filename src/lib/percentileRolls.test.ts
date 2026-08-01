import { describe, it, expect } from 'vitest'
import {
  combinePercentile,
  formatDieFaceLabel,
  groupPercentileResults,
  isPercentileEntry,
  percentileSumCorrection,
  PERCENTILE_MAX,
  PERCENTILE_MIN,
  PERCENTILE_ONES_SHAPE,
  PERCENTILE_TENS_SHAPE,
  type PercentilePair,
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
import { D10_FACE_NORMALS, D10TENS_FACE_NORMALS } from './geometries'
import { getFaceRendererForShape } from './faceRenderers'
import { createFaceMaterialsArray, validateFaceNormalRules } from './faceMaterialMapping'
import { parseInventoryDieDragPayload, serializeInventoryDieDragPayload, INVENTORY_DIE_DRAG_TYPE } from './inventoryDrag'
import type { DiceEntry, SavedRoll } from '../types/savedRolls'
import * as THREE from 'three'

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

describe('percentileSumCorrection', () => {
  const pair: PercentilePair = { tensDieId: 'tens', onesDieId: 'ones' }

  it('is zero without percentile pairs', () => {
    expect(percentileSumCorrection(new Map([['a', 5]]), undefined)).toBe(0)
    expect(percentileSumCorrection(new Map([['a', 5]]), [])).toBe(0)
  })

  it('is zero for any pair that already sums correctly', () => {
    const faces = new Map([['tens', 30], ['ones', 4]])
    expect(percentileSumCorrection(faces, [pair])).toBe(0)
  })

  it('adds 100 for a 00 + 0 pair', () => {
    const faces = new Map([['tens', 0], ['ones', 0]])
    expect(percentileSumCorrection(faces, [pair])).toBe(100)
  })

  it('corrects each double-zero pair independently', () => {
    const faces = new Map([
      ['tens-a', 0], ['ones-a', 0],
      ['tens-b', 0], ['ones-b', 3],
      ['tens-c', 0], ['ones-c', 0],
    ])
    const pairs: PercentilePair[] = [
      { tensDieId: 'tens-a', onesDieId: 'ones-a' },
      { tensDieId: 'tens-b', onesDieId: 'ones-b' },
      { tensDieId: 'tens-c', onesDieId: 'ones-c' },
    ]
    expect(percentileSumCorrection(faces, pairs)).toBe(200)
  })

  it('skips pairs whose halves are not both present (per-player filtering)', () => {
    expect(percentileSumCorrection(new Map([['tens', 0]]), [pair])).toBe(0)
    expect(percentileSumCorrection(new Map([['ones', 0]]), [pair])).toBe(0)
  })
})

describe('groupPercentileResults', () => {
  const tens = { diceId: 'tens', value: 0 }
  const ones = { diceId: 'ones', value: 0 }
  const loose = { diceId: 'loose', value: 6 }

  it('leaves unpaired dice alone', () => {
    expect(groupPercentileResults([loose], undefined)).toEqual([{ kind: 'die', die: loose }])
  })

  it('collapses a pair into one combined result at the first half position', () => {
    const grouped = groupPercentileResults(
      [tens, ones, loose],
      [{ tensDieId: 'tens', onesDieId: 'ones' }],
    )
    expect(grouped).toEqual([
      { kind: 'percentile', tens, ones, value: 100 },
      { kind: 'die', die: loose },
    ])
  })

  it('ignores a pairing whose other half is missing', () => {
    const grouped = groupPercentileResults([tens], [{ tensDieId: 'tens', onesDieId: 'ones' }])
    expect(grouped).toEqual([{ kind: 'die', die: tens }])
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
    expect(formatDiceEntry(percentileEntry({ perDieBonus: 2 }))).toBe('1d(100+2)')
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

  it('uses the d10 face normals with values scaled x10', () => {
    expect(D10TENS_FACE_NORMALS).toHaveLength(D10_FACE_NORMALS.length)
    D10TENS_FACE_NORMALS.forEach((face, index) => {
      expect(face.value).toBe(D10_FACE_NORMALS[index].value * 10)
      expect(face.normal.equals(D10_FACE_NORMALS[index].normal)).toBe(true)
    })
  })

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

  it('is not draggable out of the inventory', () => {
    const payload = serializeInventoryDieDragPayload({
      inventoryDieId: 'die-1',
      // Forced: the engine-only shape must never survive the drag boundary.
      type: PERCENTILE_TENS_SHAPE,
      name: 'Tens',
    })
    const dataTransfer = {
      getData: (type: string) => (type === INVENTORY_DIE_DRAG_TYPE ? payload : ''),
    } as unknown as DataTransfer
    expect(parseInventoryDieDragPayload(dataTransfer)).toBeNull()
  })

  it('still accepts an ownable shape through the drag boundary', () => {
    const payload = serializeInventoryDieDragPayload({
      inventoryDieId: 'die-1',
      type: 'd10',
      name: 'Ones',
    })
    const dataTransfer = {
      getData: (type: string) => (type === INVENTORY_DIE_DRAG_TYPE ? payload : ''),
    } as unknown as DataTransfer
    expect(parseInventoryDieDragPayload(dataTransfer)).toEqual({
      inventoryDieId: 'die-1',
      type: 'd10',
      name: 'Ones',
    })
  })
})
