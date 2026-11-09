/**
 * Layout A HUD geometry.
 *
 * Every fixed table-HUD element is placed from the bottom edge (or, for the
 * corner icons, the top edge) so the lanes can be reasoned about — and
 * asserted — as non-overlapping intervals at any viewport height.
 */

/**
 * Slot geometry of the permanent bottom-left control cluster.
 *
 * The cluster is one bottom-anchored stack of evenly pitched slots. Slots are
 * handed out by *rendered order*, never by control identity, so a control that
 * does not exist on this form factor (the motion toggle is mobile-only) leaves
 * no dead slot behind — everything above it collapses down by one pitch.
 */
export const HUD_CLUSTER = {
  /** Lowest slot, clearing the bottom nav lane. */
  bottom: 80,
  /** Slot pitch: a 48px control plus an 8px gap to the next one. */
  pitch: 56,
  /** Every cluster control is the same square. */
  size: 48,
} as const

/** Cluster controls in stack order, bottom-up. `motion` is mobile-only. */
export const HUD_CLUSTER_ORDER = ['eye', 'motion', 'rotate'] as const

export type HudClusterControl = (typeof HUD_CLUSTER_ORDER)[number]

/** The controls that actually render on this form factor, bottom-up. */
export function getHudClusterControls(isMobile: boolean): readonly HudClusterControl[] {
  return HUD_CLUSTER_ORDER.filter(control => control !== 'motion' || isMobile)
}

/** `bottom` (px) of the nth slot, counting up from the bottom of the stack. */
export function getHudClusterSlotBottom(index: number): number {
  return HUD_CLUSTER.bottom + index * HUD_CLUSTER.pitch
}

/**
 * `bottom` (px) of a cluster control, or `null` when this form factor does not
 * render it. Callers render a control exactly when it has a slot, which keeps
 * "which controls exist" defined here rather than in the JSX.
 */
export function getHudClusterControlBottom(
  control: HudClusterControl,
  isMobile: boolean,
): number | null {
  const index = getHudClusterControls(isMobile).indexOf(control)
  return index === -1 ? null : getHudClusterSlotBottom(index)
}

/** The open menu replaces the cluster, clearing only bottom navigation. */
export function getHudToolbarBottom(): number {
  return HUD_CLUSTER.bottom
}

export const HUD_LAYOUT = {
  nav: { bottom: 16, height: 56 },
  /** The eye owns the lowest slot on every form factor (80px, always). */
  eye: { bottom: getHudClusterSlotBottom(0), size: HUD_CLUSTER.size },
  /** Top-anchored Settings / Shop corner icons (`clamp(48px, 10vw, 56px)`). */
  corner: { top: 16, size: 56 },
} as const

/**
 * Slot metrics of the `DiceToolbar` rail. Mirrors its Tailwind classes:
 * `h-12` slots in a `gap-3` scroll column and a pinned trash footer.
 */
export const DICE_TOOLBAR_RAIL = {
  slotSize: 48,
  gap: 12,
  /** Six dice quick slots + inventory scroll independently of trash. */
  scrollSlots: 7,
  /** `mt-4` separates the pinned trash footer from the scroll box. */
  footerGap: 16,
  /** `py-2` on the scroll box, which keeps slot badges from being clipped. */
  verticalPadding: 8,
} as const

/**
 * Natural height of the seven scrolling slots, including badge clearance.
 * The pinned trash footer is added separately to resolve the full rail box.
 */
export const DICE_TOOLBAR_SCROLL_HEIGHT =
  DICE_TOOLBAR_RAIL.scrollSlots * DICE_TOOLBAR_RAIL.slotSize +
  (DICE_TOOLBAR_RAIL.scrollSlots - 1) * DICE_TOOLBAR_RAIL.gap +
  2 * DICE_TOOLBAR_RAIL.verticalPadding

export const DICE_TOOLBAR_NATURAL_HEIGHT =
  DICE_TOOLBAR_SCROLL_HEIGHT + DICE_TOOLBAR_RAIL.footerGap + DICE_TOOLBAR_RAIL.slotSize

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
  DICE_TOOLBAR_RAIL.gap +
  DICE_TOOLBAR_RAIL.footerGap +
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
 * Resolve the open menu's box above bottom navigation on every form factor.
 * The cluster is absent while the menu owns this lane. Only shapes and
 * inventory scroll when the rail reaches the corner-icon clearance.
 */
export function getDiceToolbarLane(viewportHeight: number): DiceToolbarLane {
  const bottom = getHudToolbarBottom()
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

export interface HudClusterInterval extends VerticalInterval {
  control: HudClusterControl
}

export interface HudPortraitIntervals {
  nav: VerticalInterval
  /** Only the controls this form factor renders, ordered bottom-up. */
  cluster: HudClusterInterval[]
  toolbar: VerticalInterval | null
}

/**
 * Bottom-origin portrait lanes. The menu and cluster are mutually exclusive.
 */
export function getHudPortraitIntervals(
  viewportHeight: number,
  isMobile: boolean,
  isDiceMenuOpen = false,
): HudPortraitIntervals {
  const toolbar = getDiceToolbarLane(viewportHeight)

  return {
    nav: interval(HUD_LAYOUT.nav.bottom, HUD_LAYOUT.nav.height),
    cluster: (isDiceMenuOpen ? [] : getHudClusterControls(isMobile)).map((control, index) => ({
      control,
      ...interval(getHudClusterSlotBottom(index), HUD_CLUSTER.size),
    })),
    toolbar: isDiceMenuOpen ? { bottom: toolbar.bottom, top: toolbar.top } : null,
  }
}

export function intervalsOverlap(a: VerticalInterval, b: VerticalInterval): boolean {
  return a.bottom < b.top && b.bottom < a.top
}

function interval(bottom: number, height: number): VerticalInterval {
  return { bottom, top: bottom + height }
}
