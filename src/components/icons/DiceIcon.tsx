import { memo } from 'react'

/**
 * `d10tens` is the percentile tens die — the d10 solid with its front face left
 * blank and marked `%`, so a d100 entry reads as "the percentile pair" rather
 * than a second plain d10.
 */
export type DiceType = 'd4' | 'd6' | 'd8' | 'd10' | 'd10tens' | 'd12' | 'd20'

interface DiceIconProps {
  type: DiceType
  className?: string
  size?: number
  /**
   * CSS colour the artwork inherits. The icon paints every facet with
   * `currentColor` at varying opacity, so this single value drives the whole
   * shape. Defaults to the theme's secondary text colour; pass e.g.
   * `'var(--color-accent)'` to tint a selected chip.
   *
   * Set explicitly (not left to inheritance) because the icon is rendered
   * inside containers that never set `color` — inheritance would land on the
   * browser default black.
   */
  tone?: string
}

/**
 * One visible face of the solid.
 *
 * `o` is the fill opacity that stands in for shading: the light model is a
 * downward key plus an upper-left fill, normalised per solid so the brightest
 * visible face lands on 0.95 and the darkest on 0.35. Monochrome facets read as
 * a polyhedron only if adjacent faces differ, so these values are the shape.
 */
interface Facet {
  readonly d: string
  readonly o: number
  /** The face the percentile mark sits on (d10 only). */
  readonly front?: boolean
}

interface Solid {
  /** Visible faces, darkest first so brighter faces win any antialiasing seam. */
  readonly facets: readonly Facet[]
  /** Every unique edge of the visible faces, as one multi-subpath stroke. */
  readonly edges: string
}

/**
 * Geometry for each die.
 *
 * Every path below is a projection of the real solid, not a freehand sketch:
 * canonical vertex set → convex-hull faces → rest on a face → orthographic
 * projection at the camera elevation noted per shape → back-face cull → fit to
 * the 100×100 viewBox centred on (50, 50). Vertices are therefore exactly
 * mirror-symmetric about x=50, and every shape stays inside 10..90 so the icons
 * optically align with one another.
 *
 * To change a shape, re-derive it — nudging a coordinate breaks the symmetry
 * and the facet tiling.
 */
const D4: Solid = {
  // Tetrahedron resting on a face, camera 80° above horizontal. The apex
  // projects inside the base triangle, so the three visible side faces meet at
  // an interior vertex instead of reading as a flat triangle.
  facets: [
    { d: 'M50 50.03 L92 85.82 L50 14.18Z', o: 0.35 },
    { d: 'M8 85.82 L92 85.82 L50 50.03Z', o: 0.87 },
    { d: 'M50 14.18 L8 85.82 L50 50.03Z', o: 0.95 },
  ],
  edges:
    'M8 85.82L92 85.82M92 85.82L50 50.03M50 50.03L8 85.82M92 85.82L50 14.18M50 14.18L50 50.03M50 14.18L8 85.82',
}

const D6: Solid = {
  // Cube yawed 45° and viewed from 35.264° (true isometric): hexagonal
  // silhouette, three faces meeting at the centre vertex.
  facets: [
    { d: 'M50 90 L84.64 70 L84.64 30 L50 50Z', o: 0.35 },
    { d: 'M15.36 30 L15.36 70 L50 90 L50 50Z', o: 0.67 },
    { d: 'M84.64 30 L50 10 L15.36 30 L50 50Z', o: 0.95 },
  ],
  edges:
    'M15.36 30L15.36 70M15.36 70L50 90M50 90L50 50M50 50L15.36 30M84.64 30L50 10M50 10L15.36 30M50 50L84.64 30M50 90L84.64 70M84.64 70L84.64 30',
}

const D8: Solid = {
  // Octahedron, apex up, yawed 45° so an equatorial edge faces the camera
  // (elevation 30°): hexagonal silhouette, upper pyramid facets, a large front
  // face triangle and the lower pyramid facet.
  facets: [
    { d: 'M50 90 L82.66 66.33 L17.34 66.33Z', o: 0.35 },
    { d: 'M50 10 L82.66 66.33 L82.66 33.67Z', o: 0.77 },
    { d: 'M17.34 66.33 L82.66 66.33 L50 10Z', o: 0.9 },
    { d: 'M50 10 L17.34 33.67 L17.34 66.33Z', o: 0.95 },
  ],
  edges:
    'M17.34 66.33L82.66 66.33M82.66 66.33L50 10M50 10L17.34 66.33M82.66 66.33L82.66 33.67M82.66 33.67L50 10M50 90L82.66 66.33M17.34 66.33L50 90M50 10L17.34 33.67M17.34 33.67L17.34 66.33',
}

const D10: Solid = {
  // Pentagonal trapezohedron (the real d10), camera 24°. Two apexes plus two
  // staggered rings of five; kite planarity fixes the ring offset at
  // h·(1−cos36°)/(1+cos36°). Five kite faces are visible: one centred front,
  // two in the upper zig-zag band, two in the lower.
  facets: [
    { d: 'M70.59 57.3 L50 68.47 L50 90 L83.31 58.63Z', o: 0.35 },
    { d: 'M16.69 58.63 L50 90 L50 68.47 L29.41 57.3Z', o: 0.55 },
    { d: 'M83.31 41.37 L50 10 L70.59 57.3 L83.31 58.63Z', o: 0.8 },
    { d: 'M50 68.47 L70.59 57.3 L50 10 L29.41 57.3Z', o: 0.9, front: true },
    { d: 'M29.41 57.3 L50 10 L16.69 41.37 L16.69 58.63Z', o: 0.95 },
  ],
  edges:
    'M50 68.47L70.59 57.3M70.59 57.3L50 10M50 10L29.41 57.3M29.41 57.3L50 68.47M83.31 41.37L50 10M70.59 57.3L83.31 58.63M83.31 58.63L83.31 41.37M50 10L16.69 41.37M16.69 41.37L16.69 58.63M16.69 58.63L29.41 57.3M50 68.47L50 90M50 90L83.31 58.63M16.69 58.63L50 90',
}

/** Fill opacity of the blanked front face the `%` mark is printed on. */
const BLANK_FACE_OPACITY = 0.22

/**
 * Percentile die: the same solid, with its front kite dropped to a blank face
 * so the `%` reads as a numeral printed on the die rather than a glyph floating
 * over the silhouette.
 */
const D10_TENS: Solid = {
  ...D10,
  facets: D10.facets.map((facet) => (facet.front ? { ...facet, o: BLANK_FACE_OPACITY } : facet)),
}

const D12: Solid = {
  // Dodecahedron resting on a face, camera 78°: decagonal silhouette with the
  // central pentagon face and the five pentagon facets radiating from it.
  facets: [
    { d: 'M50 10 L50 19.63 L73.1 36.05 L87.37 36.56 L73.1 20.46Z', o: 0.35 },
    { d: 'M87.37 63.44 L87.37 36.56 L73.1 36.05 L64.28 62.61 L73.1 79.54Z', o: 0.38 },
    { d: 'M50 10 L26.9 20.46 L12.63 36.56 L26.9 36.05 L50 19.63Z', o: 0.68 },
    { d: 'M73.1 79.54 L64.28 62.61 L35.72 62.61 L26.9 79.54 L50 90Z', o: 0.69 },
    { d: 'M12.63 63.44 L26.9 79.54 L35.72 62.61 L26.9 36.05 L12.63 36.56Z', o: 0.82 },
    { d: 'M50 19.63 L26.9 36.05 L35.72 62.61 L64.28 62.61 L73.1 36.05Z', o: 0.95 },
  ],
  edges:
    'M50 19.63L26.9 36.05M26.9 36.05L35.72 62.61M35.72 62.61L64.28 62.61M64.28 62.61L73.1 36.05M73.1 36.05L50 19.63M12.63 63.44L26.9 79.54M26.9 79.54L35.72 62.61M26.9 36.05L12.63 36.56M12.63 36.56L12.63 63.44M73.1 79.54L64.28 62.61M26.9 79.54L50 90M50 90L73.1 79.54M50 10L50 19.63M73.1 36.05L87.37 36.56M87.37 36.56L73.1 20.46M73.1 20.46L50 10M87.37 63.44L87.37 36.56M73.1 79.54L87.37 63.44M50 10L26.9 20.46M26.9 20.46L12.63 36.56',
}

const D20: Solid = {
  // Icosahedron resting on a face, camera 78°: hexagonal silhouette with the
  // central triangle face and the ring of triangular facets around it.
  facets: [
    { d: 'M86.91 27.46 L72.81 55.71 L86.91 72.54Z', o: 0.35 },
    { d: 'M50 10 L50 17.06 L86.91 27.46Z', o: 0.45 },
    { d: 'M86.91 72.54 L72.81 55.71 L50 90Z', o: 0.54 },
    { d: 'M13.09 27.46 L50 17.06 L50 10Z', o: 0.62 },
    { d: 'M50 17.06 L72.81 55.71 L86.91 27.46Z', o: 0.72 },
    { d: 'M50 90 L27.19 55.71 L13.09 72.54Z', o: 0.77 },
    { d: 'M13.09 72.54 L27.19 55.71 L13.09 27.46Z', o: 0.79 },
    { d: 'M72.81 55.71 L27.19 55.71 L50 90Z', o: 0.87 },
    { d: 'M13.09 27.46 L27.19 55.71 L50 17.06Z', o: 0.9 },
    { d: 'M50 17.06 L27.19 55.71 L72.81 55.71Z', o: 0.95 },
  ],
  edges:
    'M50 17.06L27.19 55.71M27.19 55.71L72.81 55.71M72.81 55.71L50 17.06M27.19 55.71L50 90M50 90L72.81 55.71M13.09 27.46L27.19 55.71M50 17.06L13.09 27.46M13.09 72.54L27.19 55.71M13.09 27.46L13.09 72.54M13.09 72.54L50 90M72.81 55.71L86.91 27.46M86.91 27.46L50 17.06M72.81 55.71L86.91 72.54M86.91 72.54L86.91 27.46M50 90L86.91 72.54M50 10L50 17.06M86.91 27.46L50 10M50 10L13.09 27.46',
}

const SOLIDS: Record<DiceType, Solid> = {
  d4: D4,
  d6: D6,
  d8: D8,
  d10: D10,
  d10tens: D10_TENS,
  d12: D12,
  d20: D20,
}

/**
 * Edge stroke. Wide enough to cover the antialiasing seam between adjacent
 * facets at 24px, thin enough not to swallow the small facets at 48px+.
 */
const EDGE_WIDTH = 2.5
const EDGE_OPACITY = 0.9

/** Centre of the d10's front kite, and a size that clears its sloping edges. */
const PERCENT_MARK = { x: 50, y: 52, fontSize: 28 }

const DiceIconImpl = ({
  type,
  className = '',
  size = 24,
  tone = 'var(--color-text-secondary)',
}: DiceIconProps) => {
  const solid = SOLIDS[type]

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={{ color: tone }}
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      {solid.facets.map((facet) => (
        <path key={facet.d} d={facet.d} fill="currentColor" fillOpacity={facet.o} />
      ))}
      <path
        d={solid.edges}
        fill="none"
        stroke="currentColor"
        strokeOpacity={EDGE_OPACITY}
        strokeWidth={EDGE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {type === 'd10tens' && (
        <text
          x={PERCENT_MARK.x}
          y={PERCENT_MARK.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={PERCENT_MARK.fontSize}
          fontWeight="600"
          fill="currentColor"
          fillOpacity={0.95}
        >
          %
        </text>
      )}
    </svg>
  )
}

export const DiceIcon = memo(DiceIconImpl)
