/**
 * Layout A HUD geometry.
 *
 * Every fixed table-HUD element is placed from the bottom edge (or, for the
 * corner icons, the top edge) so the lanes can be reasoned about — and
 * asserted — as non-overlapping intervals at any viewport height.
 */
export const HUD_LAYOUT = {
  nav: { bottom: 16, height: 56 },
  eye: { bottom: 80, size: 48 },
  motion: { bottom: 136, size: 48 },
  rotate: { bottom: 192, size: 48 },
  toolbar: { bottom: 248 },
  /** Top-anchored Settings / Shop corner icons (`clamp(48px, 10vw, 56px)`). */
  corner: { top: 16, size: 56 },
} as const

/**
 * Slot metrics of the `DiceToolbar` rail. Mirrors its Tailwind classes:
 * `h-12` slots in a `gap-3` column, with the trash button carrying `mt-1`.
 */
export const DICE_TOOLBAR_RAIL = {
  slotSize: 48,
  gap: 12,
  /** Six dice quick slots + the inventory button + the trash button. */
  maxSlots: 8,
  /** Extra `mt-1` margin above the trash button. */
  trashOffset: 4,
  /** `py-2` on the scroll box, which keeps slot badges from being clipped. */
  verticalPadding: 8,
} as const

/**
 * Scroll height of a fully populated rail (488px). The rail only fits
 * unclamped on tall viewports, so this is never used as a fixed height —
 * `e2e/hud-layout.spec.ts` asserts the rendered `scrollHeight` never exceeds it.
 */
export const DICE_TOOLBAR_NATURAL_HEIGHT =
  DICE_TOOLBAR_RAIL.maxSlots * DICE_TOOLBAR_RAIL.slotSize +
  (DICE_TOOLBAR_RAIL.maxSlots - 1) * DICE_TOOLBAR_RAIL.gap +
  DICE_TOOLBAR_RAIL.trashOffset +
  2 * DICE_TOOLBAR_RAIL.verticalPadding

/**
 * Lane below the top corner icons that the rail must never enter, so the rail
 * can never reach (or pass under) the Settings gear.
 */
export const HUD_TOP_CLEARANCE = HUD_LAYOUT.corner.top + HUD_LAYOUT.corner.size + 8

/**
 * Smallest rail worth showing: one dice slot plus the inventory and trash
 * buttons. Below this the rail is unusable and the layout is wrong.
 */
export const DICE_TOOLBAR_MIN_HEIGHT =
  3 * DICE_TOOLBAR_RAIL.slotSize +
  2 * DICE_TOOLBAR_RAIL.gap +
  DICE_TOOLBAR_RAIL.trashOffset +
  2 * DICE_TOOLBAR_RAIL.verticalPadding

export interface VerticalInterval {
  bottom: number
  top: number
}

export interface DiceToolbarLane extends VerticalInterval {
  /** Rendered rail height once clamped to the available lane. */
  height: number
  /** CSS `max-height` for the rail; overflow scrolls inside the rail. */
  maxHeight: number
  /** True when the natural rail is taller than the lane and must scroll. */
  scrollable: boolean
}

/**
 * Resolve the rail's on-screen box. The rail is bottom-anchored above the
 * permanent control cluster and clamped so its top can never pass the corner
 * icon clearance — overflowing slots scroll inside the rail instead of being
 * pushed off-screen.
 */
export function getDiceToolbarLane(viewportHeight: number): DiceToolbarLane {
  const bottom = HUD_LAYOUT.toolbar.bottom
  const maxHeight = Math.max(0, viewportHeight - bottom - HUD_TOP_CLEARANCE)
  const height = Math.min(DICE_TOOLBAR_NATURAL_HEIGHT, maxHeight)

  return {
    bottom,
    top: bottom + height,
    height,
    maxHeight,
    scrollable: DICE_TOOLBAR_NATURAL_HEIGHT > maxHeight,
  }
}

/**
 * Bottom-origin portrait lanes for the table HUD. The toolbar occupies the
 * remaining lane above the fixed controls, so it cannot cover them.
 */
export function getHudPortraitIntervals(viewportHeight: number): Record<
  'nav' | 'eye' | 'motion' | 'rotate' | 'toolbar',
  VerticalInterval
> {
  const toolbar = getDiceToolbarLane(viewportHeight)

  return {
    nav: interval(HUD_LAYOUT.nav.bottom, HUD_LAYOUT.nav.height),
    eye: interval(HUD_LAYOUT.eye.bottom, HUD_LAYOUT.eye.size),
    motion: interval(HUD_LAYOUT.motion.bottom, HUD_LAYOUT.motion.size),
    rotate: interval(HUD_LAYOUT.rotate.bottom, HUD_LAYOUT.rotate.size),
    toolbar: { bottom: toolbar.bottom, top: toolbar.top },
  }
}

export function intervalsOverlap(a: VerticalInterval, b: VerticalInterval): boolean {
  return a.bottom < b.top && b.bottom < a.top
}

function interval(bottom: number, height: number): VerticalInterval {
  return { bottom, top: bottom + height }
}
