import { describe, expect, it } from 'vitest'
import { getHudPortraitIntervals, intervalsOverlap } from './hudLayout'

describe('HUD Layout A portrait lanes', () => {
  it.each([844, 780])('keeps fixed HUD lanes separate at portrait height %ipx', (height) => {
    const lanes = getHudPortraitIntervals(height)
    const orderedLanes = [lanes.nav, lanes.eye, lanes.motion, lanes.rotate, lanes.toolbar]

    for (let index = 0; index < orderedLanes.length - 1; index += 1) {
      expect(intervalsOverlap(orderedLanes[index], orderedLanes[index + 1])).toBe(false)
      expect(orderedLanes[index].top).toBeLessThanOrEqual(orderedLanes[index + 1].bottom)
    }
  })
})
