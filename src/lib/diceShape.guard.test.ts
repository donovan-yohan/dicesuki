import { describe, it, expect } from 'vitest'
// Vite `?raw` hands us the exact Rust source text so the guard inspects what
// actually ships (matches the physicsConfig / spawnSchema drift-guard convention).
import rustSrc from '../../server/core/src/messages.rs?raw'
import { DICE_SHAPES, INVENTORY_DICE_SHAPES } from '../types/diceShape'
import { D10TENS_FACE_NORMALS, D10_FACE_NORMALS } from './geometries'

/**
 * Drift guards for the dice-shape vocabulary (Shared-ADR-002 manual TS↔Rust sync,
 * Shared-ADR-007 one-engine).
 *
 * 1. The client `DiceShape` union and the Rust `DiceType` enum are the SAME set of
 *    wire names. A shape added on one side only produces dice the other side
 *    cannot spawn, render or settle — a silent failure at runtime, so it fails
 *    loudly here instead.
 * 2. `D10TENS_FACE_NORMALS` matches an INDEPENDENTLY WRITTEN expected table.
 */

/** Extract the body of a `pub enum <name> { … }` block from Rust source. */
function enumBody(source: string, name: string): string {
  const start = source.indexOf(`pub enum ${name} {`)
  if (start === -1) return ''
  const open = source.indexOf('{', start)
  const close = source.indexOf('\n}', open)
  return source.slice(open + 1, close)
}

/**
 * The serde wire names of a Rust enum's variants, in declaration order.
 * Honours an explicit `#[serde(rename = "…")]`; otherwise applies the
 * container's `rename_all = "lowercase"`.
 */
function serdeVariantNames(body: string): string[] {
  const names: string[] = []
  let pendingRename: string | null = null

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('///') || line.startsWith('//')) continue

    const rename = line.match(/^#\[serde\(rename\s*=\s*"([^"]+)"\)\]$/)
    if (rename) {
      pendingRename = rename[1]
      continue
    }
    if (line.startsWith('#[')) continue

    const variant = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*,$/)
    if (variant) {
      names.push(pendingRename ?? variant[1].toLowerCase())
      pendingRename = null
    }
  }

  return names
}

describe('DiceShape vocabulary (TS <-> Rust)', () => {
  const body = enumBody(rustSrc, 'DiceType')

  it('locates the Rust DiceType enum', () => {
    expect(body).not.toBe('')
  })

  it('declares lowercase as the default serde renaming, so the parse is valid', () => {
    // If this container attribute ever changes, the fallback below is wrong and
    // the comparison would silently start passing for the wrong reason.
    expect(rustSrc).toMatch(/#\[serde\(rename_all = "lowercase"\)\]\s*pub enum DiceType \{/)
  })

  it('has the same shape set on both sides of the protocol', () => {
    const rustNames = serdeVariantNames(body)
    expect(rustNames.length).toBeGreaterThan(0)
    expect([...rustNames].sort()).toEqual([...DICE_SHAPES].sort())
  })

  it('carries the percentile tens die on both sides', () => {
    expect(serdeVariantNames(body)).toContain('d10tens')
    expect(DICE_SHAPES).toContain('d10tens')
  })

  it('exposes exactly the ownable shapes as INVENTORY_DICE_SHAPES', () => {
    // The engine-only tens die is the one shape a player can never own.
    expect(INVENTORY_DICE_SHAPES).toEqual(DICE_SHAPES.filter((shape) => shape !== 'd10tens'))
    expect(INVENTORY_DICE_SHAPES).not.toContain('d10tens')
  })
})

describe('d10tens face table (independent expectation)', () => {
  /**
   * INDEPENDENTLY WRITTEN expectation — deliberately NOT `D10_FACE_NORMALS`
   * mapped ×10, which is how the implementation builds the table. A derived
   * expectation would be tautological: a wrong kite→value assignment in the
   * shared source table would satisfy it. These literals are the
   * `createD10Geometry` kite normals in geometry order with the percentile labels
   * written out by hand. The Rust side keeps a matching hand-written table in
   * `server/core/src/dice.rs`.
   */
  const EXPECTED: Array<{ value: number; normal: [number, number, number] }> = [
    { value: 0, normal: [-0.741629, 0.670810, 0.0] },
    { value: 20, normal: [-0.229176, 0.670810, -0.705331] },
    { value: 40, normal: [0.599991, 0.670810, -0.435919] },
    { value: 60, normal: [0.599991, 0.670810, 0.435919] },
    { value: 80, normal: [-0.229176, 0.670810, 0.705331] },
    { value: 30, normal: [-0.599991, -0.670810, -0.435919] },
    { value: 10, normal: [0.229176, -0.670810, -0.705331] },
    { value: 90, normal: [0.741629, -0.670810, 0.0] },
    { value: 70, normal: [0.229176, -0.670810, 0.705331] },
    { value: 50, normal: [-0.599991, -0.670810, 0.435919] },
  ]

  it('labels each kite exactly as expected', () => {
    expect(D10TENS_FACE_NORMALS.map((face) => face.value))
      .toEqual(EXPECTED.map((face) => face.value))
  })

  it('points each kite exactly where expected', () => {
    expect(D10TENS_FACE_NORMALS).toHaveLength(EXPECTED.length)
    EXPECTED.forEach((expected, index) => {
      const actual = D10TENS_FACE_NORMALS[index].normal
      const [x, y, z] = expected.normal
      const length = Math.hypot(x, y, z)
      expect(actual.x).toBeCloseTo(x / length, 5)
      expect(actual.y).toBeCloseTo(y / length, 5)
      expect(actual.z).toBeCloseTo(z / length, 5)
    })
  })

  it('keeps the ones d10 on its own independently expected labels', () => {
    // Guards the d10 regression: both tables must not drift together.
    expect(D10_FACE_NORMALS.map((face) => face.value))
      .toEqual([0, 2, 4, 6, 8, 3, 1, 9, 7, 5])
  })
})
