import { describe, expect, it } from 'vitest'
import {
  DICE_TOOLBAR_MIN_HEIGHT,
  DICE_TOOLBAR_NATURAL_HEIGHT,
  getDiceToolbarLane,
  getHudClusterControlBottom,
  getHudClusterControls,
  getHudPortraitIntervals,
  getHudToolbarBottom,
  HUD_CLUSTER,
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

describe('HUD Layout A control cluster slots', () => {
  it('renders the motion toggle only on mobile', () => {
    expect(getHudClusterControls(true)).toEqual(['eye', 'motion', 'rotate'])
    expect(getHudClusterControls(false)).toEqual(['eye', 'rotate'])
    expect(getHudClusterControlBottom('motion', false)).toBeNull()
  })

  it('keeps the mobile cluster exactly where it has always been', () => {
    expect(getHudClusterControlBottom('eye', true)).toBe(80)
    expect(getHudClusterControlBottom('motion', true)).toBe(136)
    expect(getHudClusterControlBottom('rotate', true)).toBe(192)
    expect(getHudToolbarBottom()).toBe(80)
  })

  it('collapses the stack over the absent motion slot on desktop', () => {
    // The dead slot the motion toggle used to leave behind (136) is taken by
    // rotate, and everything above it moves down by exactly one pitch.
    expect(getHudClusterControlBottom('eye', false)).toBe(80)
    expect(getHudClusterControlBottom('rotate', false)).toBe(136)
    expect(getHudToolbarBottom()).toBe(80)
  })

  it('anchors the eye at the lowest slot on every form factor', () => {
    // `UIToggleMini` reads `HUD_LAYOUT.eye` directly and never collapses.
    expect(HUD_LAYOUT.eye.bottom).toBe(HUD_CLUSTER.bottom)
    expect(getHudClusterControlBottom('eye', true)).toBe(HUD_LAYOUT.eye.bottom)
    expect(getHudClusterControlBottom('eye', false)).toBe(HUD_LAYOUT.eye.bottom)
  })

  it.each([{ label: 'mobile', isMobile: true }, { label: 'desktop', isMobile: false }])(
    'spaces every adjacent $label control by one uniform pitch',
    ({ isMobile }) => {
      const { cluster, toolbar } = getHudPortraitIntervals(844, isMobile)
      expect(toolbar).toBeNull()
      const bottoms = cluster.map(lane => lane.bottom)

      for (let index = 0; index < bottoms.length - 1; index += 1) {
        expect(bottoms[index + 1] - bottoms[index]).toBe(HUD_CLUSTER.pitch)
      }
    },
  )
})

describe('HUD Layout A portrait lanes', () => {
  it.each(PORTRAIT_VIEWPORTS)('keeps fixed HUD lanes separate at $label', ({ height }) => {
    const lanes = getHudPortraitIntervals(height, true)
    const orderedLanes = [lanes.nav, ...lanes.cluster]

    expect(lanes.cluster.map(lane => lane.control)).toEqual(['eye', 'motion', 'rotate'])

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

      // The menu replaces the cluster, not an additional lane above it.
      const open = getHudPortraitIntervals(height, true, true)
      expect(open.cluster).toEqual([])
      expect(open.toolbar).toEqual({ bottom: 80, top: lane.top })
      expect(intervalsOverlap(open.nav, open.toolbar!)).toBe(false)

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

  it('never reports a lane taller than the space between navigation and corner icons', () => {
    for (let height = 480; height <= 1400; height += 1) {
      const lane = getDiceToolbarLane(height)
      expect(lane.top).toBeLessThanOrEqual(Math.max(lane.bottom, height - HUD_TOP_CLEARANCE))
    }
  })
})
