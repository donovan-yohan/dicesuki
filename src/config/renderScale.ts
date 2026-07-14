/**
 * renderScale — the single source for the fixed on-screen dice scale (ADR-008
 * amendment).
 *
 * The solo/table view holds a die at a constant CSS-pixel size so it reads as a
 * real 16 mm die on a phone; a larger canvas reveals a bigger arena instead of
 * magnifying the dice. TWO things must agree on that scale, and both read it from
 * here so they can never drift:
 *   1. the camera (`MultiplayerCamera` in `Scene.tsx`) — sets a fixed zoom, and
 *   2. the arena footprint the solo room is asked to build (`useMultiplayerStore`
 *      → worker → wasm `ArenaBounds::from_half_extents`).
 *
 * Because the arena world size is derived from the same (viewport px ÷ scale) the
 * camera uses, the walls exactly frame the visible viewport.
 */

/**
 * CSS pixels covered by one world unit (a die edge) at the floor plane.
 * `65` (current): dialed in on-device to read as a real 16 mm die on a phone.
 * Recommended ~40–80 CSS px/unit. Override live with `?ppu=NN` for tuning.
 */
export const DICE_PIXELS_PER_UNIT = 65

/**
 * Fraction of the viewport the arena fills (each dimension). Below 1 so the walls
 * sit inside the frustum with a visible border instead of clipping at the screen
 * edge. `0.9` (current): a ~5%-per-side margin that frames the tray. Override live
 * with `?fill=NN` (percent, e.g. `?fill=85`). Recommended ~0.82–0.96.
 */
export const ARENA_VIEWPORT_FILL = 0.9

/**
 * Resolve the active scale: the `?ppu=NN` query override when present and valid,
 * otherwise {@link DICE_PIXELS_PER_UNIT}. Guarded for non-DOM/test contexts.
 */
export function resolvePixelsPerUnit(): number {
  return readNumberParam('ppu', DICE_PIXELS_PER_UNIT, (v) => v > 0)
}

/**
 * Resolve the active arena fill fraction: `?fill=NN` (a percent, 1–100) when
 * present and valid, otherwise {@link ARENA_VIEWPORT_FILL}. Clamped to (0, 1].
 */
export function resolveArenaFill(): number {
  const pct = readNumberParam('fill', ARENA_VIEWPORT_FILL * 100, (v) => v > 0 && v <= 100)
  return pct / 100
}

/**
 * Camera height (world units) for the top-down perspective camera of vertical
 * field-of-view `fovDeg` to frame an arena of half-extents `arenaHalfX`×`arenaHalfZ`
 * inside a `viewportW`×`viewportH` px window, inset by `fill` (Shared-ADR-009).
 *
 * Both axes must fit, so the tighter constraint wins and the slack axis is
 * letterboxed — a host-chosen shared arena shape then fits any viewport. When the
 * arena aspect equals the viewport aspect (solo fit-to-window, or 9:16 on a 9:16
 * screen) the two constraints coincide and this equals the fixed-scale framing —
 * the 9:16 fixed point is preserved.
 */
export function arenaFitCameraHeight(
  arenaHalfX: number,
  arenaHalfZ: number,
  viewportW: number,
  viewportH: number,
  fovDeg: number,
  fill: number = resolveArenaFill(),
): number {
  const halfFovV = ((fovDeg * Math.PI) / 180) / 2
  const viewportAspect = viewportW / viewportH
  const needForDepth = (2 * arenaHalfZ) / fill
  const needForWidth = (2 * arenaHalfX) / fill / viewportAspect
  const worldHeightVisible = Math.max(needForDepth, needForWidth)
  return worldHeightVisible / (2 * Math.tan(halfFovV))
}

/** Read a positive numeric query param, validated, else `fallback`. DOM-guarded. */
function readNumberParam(
  key: string,
  fallback: number,
  valid: (v: number) => boolean,
): number {
  try {
    if (typeof window !== 'undefined') {
      const raw = new URLSearchParams(window.location.search).get(key)
      if (raw) {
        const parsed = Number(raw)
        if (Number.isFinite(parsed) && valid(parsed)) return parsed
      }
    }
  } catch {
    // ignore — fall through to the default
  }
  return fallback
}

/**
 * The full arena world dimensions (width across the screen, depth down it) a
 * viewport of `widthPx` × `heightPx` CSS pixels maps to at the active scale — so
 * the arena literally equals the viewport and its walls frame exactly what the
 * fixed-zoom camera shows. Core halves + clamps (`ArenaBounds::from_dimensions`);
 * this returns `undefined` in non-DOM/degenerate cases so the room falls back to
 * the fixed 9:16 arena.
 */
export function arenaDimensionsForViewport(
  widthPx: number,
  heightPx: number,
  pixelsPerUnit: number = resolvePixelsPerUnit(),
): { width: number; depth: number } | undefined {
  if (
    !Number.isFinite(widthPx) ||
    !Number.isFinite(heightPx) ||
    widthPx <= 0 ||
    heightPx <= 0 ||
    !(pixelsPerUnit > 0)
  ) {
    return undefined
  }
  // Fill < 1 insets the arena so the walls sit inside the frustum (visible border)
  // rather than clipping at the screen edge.
  const fill = resolveArenaFill()
  return {
    width: (widthPx / pixelsPerUnit) * fill,
    depth: (heightPx / pixelsPerUnit) * fill,
  }
}
