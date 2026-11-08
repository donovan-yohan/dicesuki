import { expect, it } from 'vitest'
import { Color } from 'three'
import { monsterDungeonTheme, cyberpunkCutlineTheme } from '../../themes/worlds'

it('supplies bounded warm-neutral room fill for dungeon markings outside torch pools', () => {
  const { ambient, directional } = monsterDungeonTheme.environment.lighting
  // Real incident light, not a managed-material minimum or exposure lift.
  // This recipe contract is not a pixel/OCR or every-pose readability claim.
  expect(ambient.intensity).toBeGreaterThanOrEqual(0.6)
  expect(ambient.intensity).toBeLessThanOrEqual(0.85)
  const fill = new Color(ambient.color)
  expect(fill.r).toBeGreaterThanOrEqual(fill.g)
  expect(fill.g).toBeGreaterThanOrEqual(fill.b)
  expect(fill.b / fill.r).toBeGreaterThan(0.7)
  const luminance = fill.r * 0.2126 + fill.g * 0.7152 + fill.b * 0.0722
  // Even a moderately occluded indirect receiver reaches the existing 0.12
  // incident-light band. No new floor is inserted into the protected shader.
  expect(luminance * ambient.intensity * 0.7 / Math.PI / 0.80714).toBeGreaterThan(0.12)
  expect(directional.intensity).toBeLessThanOrEqual(0.3)
  expect(cyberpunkCutlineTheme.environment.lighting.ambient.intensity).toBeLessThanOrEqual(0.15)
})
