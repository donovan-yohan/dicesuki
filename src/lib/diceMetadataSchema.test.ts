import { describe, expect, it } from 'vitest'
import { validateMetadata } from './diceMetadataSchema'

const validMetadata = {
  version: '1.0',
  diceType: 'd6',
  name: 'Density Die',
  artist: 'Dicesuki',
  created: '2026-07-17',
  scale: 1,
  faceNormals: [
    { value: 1, normal: [1, 0, 0] },
    { value: 2, normal: [-1, 0, 0] },
    { value: 3, normal: [0, 1, 0] },
    { value: 4, normal: [0, -1, 0] },
    { value: 5, normal: [0, 0, 1] },
    { value: 6, normal: [0, 0, -1] },
  ],
  physics: { density: 0.38, restitution: 0.3, friction: 0.6 },
  colliderType: 'hull',
  colliderArgs: {},
}

describe('dice metadata physics schema', () => {
  it('accepts density, which is the authored Rapier mass input', () => {
    expect(validateMetadata(validMetadata)).toEqual({ isValid: true, errors: [], warnings: [] })
  })

  it('rejects the obsolete mass field when density is absent', () => {
    const result = validateMetadata({
      ...validMetadata,
      physics: { mass: 1, restitution: 0.3, friction: 0.6 },
    })
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('physics.density: must be a number')
  })
})
