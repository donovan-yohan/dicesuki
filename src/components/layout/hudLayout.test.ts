import { describe, expect, it } from 'vitest'
import {
  DICE_TOOLBAR_MIN_HEIGHT,
  DICE_TOOLBAR_NATURAL_HEIGHT,
  getDiceToolbarLane,
  getHudPortraitIntervals,
  HUD_LAYOUT,
  HUD_TOP_CLEARANCE,
  intervalsOverlap,
} from './hudLayout'

/**
 * The smallest supported portrait devices plus the two reference phones. The
 * rail must fit on every one of them — modelling the toolbar lane as
 * "everything above `toolbar.bottom`" used to make this assertion vacuous.
 */
const PORTRAIT_VIEWPORTS = [
  { label: '360x640', width: 360, height: 640 },
  { label: '375x667', width: 375, height: 667 },
  { label: '360x780', width: 360, height: 780 },
  { label: '390x844', width: 390, height: 844 },
] as const

describe('HUD Layout A portrait lanes', () => {
  it.each(PORTRAIT_VIEWPORTS)('keeps fixed HUD lanes separate at $label', ({ height }) => {
    const lanes = getHudPortraitIntervals(height)
    const orderedLanes = [lanes.nav, lanes.eye, lanes.motion, lanes.rotate, lanes.toolbar]

    for (let index = 0; index < orderedLanes.length - 1; index += 1) {
      expect(intervalsOverlap(orderedLanes[index], orderedLanes[index + 1])).toBe(false)
      expect(orderedLanes[index].top).toBeLessThanOrEqual(orderedLanes[index + 1].bottom)
    }
  })

  it.each(PORTRAIT_VIEWPORTS)(
    'fits the whole dice toolbar rail on-screen under the corner icons at $label',
    ({ height }) => {
      const lane = getDiceToolbarLane(height)

      // The rail box must be fully inside the viewport, not merely anchored in it.
      expect(lane.top).toBeLessThanOrEqual(height - HUD_TOP_CLEARANCE)
      expect(height - lane.bottom).toBeGreaterThanOrEqual(lane.height)
      expect(lane.height).toBeGreaterThan(0)

      // …and still clear of the permanent bottom-left control cluster.
      expect(lane.bottom).toBeGreaterThanOrEqual(
        HUD_LAYOUT.rotate.bottom + HUD_LAYOUT.rotate.size,
      )

      // …and large enough to stay usable once clamped.
      expect(lane.height).toBeGreaterThanOrEqual(DICE_TOOLBAR_MIN_HEIGHT)
    },
  )

  it.each(PORTRAIT_VIEWPORTS)(
    'scrolls the rail internally exactly when the natural rail cannot fit at $label',
    ({ height }) => {
      const lane = getDiceToolbarLane(height)

      expect(lane.scrollable).toBe(DICE_TOOLBAR_NATURAL_HEIGHT > lane.maxHeight)
      expect(lane.height).toBe(Math.min(DICE_TOOLBAR_NATURAL_HEIGHT, lane.maxHeight))
    },
  )

  it('never reports a lane taller than the space between the cluster and the corner icons', () => {
    for (let height = 480; height <= 1400; height += 1) {
      const lane = getDiceToolbarLane(height)
      expect(lane.top).toBeLessThanOrEqual(Math.max(lane.bottom, height - HUD_TOP_CLEARANCE))
    }
  })
})
