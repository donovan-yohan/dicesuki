export const HUD_LAYOUT = {
  nav: { bottom: 16, height: 56 },
  eye: { bottom: 80, size: 48 },
  motion: { bottom: 136, size: 48 },
  rotate: { bottom: 192, size: 48 },
  toolbar: { bottom: 248 },
} as const

export interface VerticalInterval {
  bottom: number
  top: number
}

/**
 * Bottom-origin portrait lanes for the table HUD. The toolbar occupies the
 * remaining lane above the fixed controls, so it cannot cover them.
 */
export function getHudPortraitIntervals(viewportHeight: number): Record<
  'nav' | 'eye' | 'motion' | 'rotate' | 'toolbar',
  VerticalInterval
> {
  return {
    nav: interval(HUD_LAYOUT.nav.bottom, HUD_LAYOUT.nav.height),
    eye: interval(HUD_LAYOUT.eye.bottom, HUD_LAYOUT.eye.size),
    motion: interval(HUD_LAYOUT.motion.bottom, HUD_LAYOUT.motion.size),
    rotate: interval(HUD_LAYOUT.rotate.bottom, HUD_LAYOUT.rotate.size),
    toolbar: { bottom: HUD_LAYOUT.toolbar.bottom, top: viewportHeight },
  }
}

export function intervalsOverlap(a: VerticalInterval, b: VerticalInterval): boolean {
  return a.bottom < b.top && b.bottom < a.top
}

function interval(bottom: number, height: number): VerticalInterval {
  return { bottom, top: bottom + height }
}
