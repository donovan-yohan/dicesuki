import { describe, it, expect } from 'vitest'
import { generateQrMatrix } from './qrCode'

describe('generateQrMatrix', () => {
  it('produces a square matrix whose row/col counts match the reported size', () => {
    const { size, modules } = generateQrMatrix('https://dice.app/room/ABC123')

    expect(size).toBeGreaterThan(0)
    expect(modules).toHaveLength(size)
    for (const row of modules) {
      expect(row).toHaveLength(size)
    }
  })

  it('contains a mix of dark and light modules (i.e. actually encoded data)', () => {
    const { modules } = generateQrMatrix('https://dice.app/room/ABC123')
    const flat = modules.flat()
    expect(flat.some((m) => m === true)).toBe(true)
    expect(flat.some((m) => m === false)).toBe(true)
  })

  it('is deterministic for the same input', () => {
    const a = generateQrMatrix('same-value')
    const b = generateQrMatrix('same-value')
    expect(a.size).toBe(b.size)
    expect(a.modules).toEqual(b.modules)
  })

  it('scales up the version (size) for longer data', () => {
    const small = generateQrMatrix('hi')
    const large = generateQrMatrix('x'.repeat(400))
    expect(large.size).toBeGreaterThan(small.size)
  })

  it('renders a finder pattern: top-left 7x7 corner is a dark ring', () => {
    const { modules } = generateQrMatrix('https://dice.app/room/ABC123')
    // The finder pattern's outer border row is all dark for its first 7 modules.
    expect(modules[0].slice(0, 7).every((m) => m === true)).toBe(true)
  })

  it('throws on empty data', () => {
    expect(() => generateQrMatrix('')).toThrow()
  })
})
