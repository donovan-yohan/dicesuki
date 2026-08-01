import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DiceIcon, type DiceType } from './DiceIcon'

const ALL_TYPES: DiceType[] = ['d4', 'd6', 'd8', 'd10', 'd10tens', 'd12', 'd20']

/**
 * The slate ramp the hand-drawn icons used to hardcode. Any of these back in
 * the markup means an icon stopped reading the theme and will clash on every
 * palette that is not the original dark one.
 */
const BANNED_SLATE = /#(?:cbd5e0|94a3b8|64748b|475569|e2e8f0|f8fafc)/i

const markupFor = (type: DiceType, props: { tone?: string } = {}) => {
  const { container } = render(<DiceIcon type={type} {...props} />)
  return container.innerHTML
}

/** Every numeric coordinate across every path of a rendered icon. */
const coordinatesOf = (container: HTMLElement) =>
  [...container.querySelectorAll('path')]
    .flatMap((path) => path.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g) ?? [])
    .map(Number)

describe('DiceIcon', () => {
  describe('rendering', () => {
    it.each(ALL_TYPES)('should render %s as a scalable svg', (type) => {
      // Arrange / Act
      const { container } = render(<DiceIcon type={type} />)

      // Assert
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('width', '24')
      expect(svg).toHaveAttribute('height', '24')
      expect(svg).toHaveAttribute('viewBox', '0 0 100 100')
    })

    it.each(ALL_TYPES)('should draw %s from paths, not a single primitive', (type) => {
      // Arrange / Act
      const { container } = render(<DiceIcon type={type} />)

      // Assert — facets plus the edge overlay
      expect(container.querySelectorAll('path').length).toBeGreaterThan(1)
    })
  })

  describe('sizing', () => {
    // The default size of 24 is asserted for *every* type by the
    // 'should render %s as a scalable svg' case above, which renders with no
    // `size` prop.

    it('should accept custom size', () => {
      // Arrange / Act
      const { container } = render(<DiceIcon type="d6" size={48} />)

      // Assert
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('width', '48')
      expect(svg).toHaveAttribute('height', '48')
    })
  })

  describe('styling', () => {
    it('should accept custom className', () => {
      // Arrange / Act
      const { container } = render(<DiceIcon type="d6" className="custom-class" />)

      // Assert
      expect(container.querySelector('svg')).toHaveClass('custom-class')
    })

    it.each(ALL_TYPES)('should set an explicit theme colour on the %s root', (type) => {
      // Arrange / Act — consumers render the icon inside containers that never
      // set `color`, so inheritance would land on the browser default black.
      const { container } = render(<DiceIcon type={type} />)

      // Assert
      const svg = container.querySelector('svg')
      expect(svg?.getAttribute('style')).toContain('color: var(--color-text-secondary)')
    })

    it('should let a consumer override the tone', () => {
      // Arrange / Act
      const { container } = render(<DiceIcon type="d20" tone="var(--color-accent)" />)

      // Assert
      const svg = container.querySelector('svg')
      expect(svg?.getAttribute('style')).toContain('color: var(--color-accent)')
      expect(svg?.getAttribute('style')).not.toContain('--color-text-secondary')
    })

    it.each(ALL_TYPES)('should paint %s with currentColor', (type) => {
      // Arrange / Act
      const { container } = render(<DiceIcon type={type} />)

      // Assert — every drawn element takes its colour from the root `color`
      const drawn = [...container.querySelectorAll('path, text')]
      expect(drawn.length).toBeGreaterThan(0)
      for (const el of drawn) {
        const paints = [el.getAttribute('fill'), el.getAttribute('stroke')]
        expect(paints).toContain('currentColor')
      }
    })

    it.each(ALL_TYPES)('should not hardcode the legacy slate ramp in %s', (type) => {
      // Arrange / Act / Assert — drift guard: keeps the icons on theme tokens
      expect(markupFor(type)).not.toMatch(BANNED_SLATE)
    })
  })

  describe('determinism', () => {
    it.each(ALL_TYPES)('should render %s identically every time', (type) => {
      // Arrange / Act — the old implementation seeded gradient ids with
      // Math.random(), so no two renders ever matched.
      const first = markupFor(type)
      const second = markupFor(type)

      // Assert
      expect(second).toBe(first)
    })

    it.each(ALL_TYPES)('should reference no generated id from %s', (type) => {
      // Arrange / Act / Assert — no gradients, no clip paths, nothing to collide
      expect(markupFor(type)).not.toMatch(/url\(#/)
    })
  })

  describe('accessibility', () => {
    it.each(ALL_TYPES)('should mark %s decorative', (type) => {
      // Arrange / Act — labels come from sibling text / the wrapping control
      const { container } = render(<DiceIcon type={type} />)

      // Assert
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      expect(svg).toHaveAttribute('focusable', 'false')
    })
  })

  describe('polyhedron shapes', () => {
    it('should render every die as a distinct shape', () => {
      // Arrange / Act
      const shapes = ALL_TYPES.map((type) => markupFor(type))

      // Assert
      expect(new Set(shapes).size).toBe(ALL_TYPES.length)
    })

    it('should distinguish the percentile tens die from a plain d10', () => {
      // Arrange / Act
      const d10 = markupFor('d10')
      const d10tens = markupFor('d10tens')

      // Assert — same solid, but the tens die blanks its front face and marks it
      expect(d10tens).not.toBe(d10)
      expect(markupFor('d10tens')).toContain('%')
      expect(d10).not.toContain('%')
    })

    it('should render the percentile mark as svg text on the die body', () => {
      // Arrange / Act
      const { container } = render(<DiceIcon type="d10tens" />)

      // Assert
      const text = container.querySelector('text')
      expect(text).toBeInTheDocument()
      expect(text).toHaveTextContent('%')
      expect(text).toHaveAttribute('text-anchor', 'middle')
      expect(text).toHaveAttribute('x', '50')
      expect(text).toHaveAttribute('fill', 'currentColor')
    })

    it('should render d20 as an icosahedron, not a circle', () => {
      // Arrange / Act
      const { container } = render(<DiceIcon type="d20" />)

      // Assert
      expect(container.querySelector('circle')).toBeNull()
      // central triangle face plus the ring of triangular facets
      expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(10)
    })

    it('should render d6 as a faceted cube, not a rounded rect', () => {
      // Arrange / Act
      const { container } = render(<DiceIcon type="d6" />)

      // Assert
      expect(container.querySelector('rect')).toBeNull()
      // top, left and right faces plus the edge overlay
      expect(container.querySelectorAll('path').length).toBe(4)
    })

    it.each(ALL_TYPES)('should keep %s geometry inside the 8..92 outer safe area', (type) => {
      // Arrange
      const { container } = render(<DiceIcon type={type} />)

      // Act — every coordinate in every path
      const coords = coordinatesOf(container)

      // Assert — nothing may exceed the widest shape's box
      expect(coords.length).toBeGreaterThan(0)
      expect(Math.min(...coords)).toBeGreaterThanOrEqual(8)
      expect(Math.max(...coords)).toBeLessThanOrEqual(92)
    })

    it.each(ALL_TYPES.filter((type) => type !== 'd4'))(
      'should keep %s inside the tighter 10..90 alignment box',
      (type) => {
        // Arrange / Act — d4 is deliberately fitted 4 units wider (8..92): an
        // equilateral triangle reads optically smaller at the same box size.
        // Every other shape has no such excuse.
        const { container } = render(<DiceIcon type={type} />)
        const coords = coordinatesOf(container)

        // Assert
        expect(Math.min(...coords)).toBeGreaterThanOrEqual(10)
        expect(Math.max(...coords)).toBeLessThanOrEqual(90)
      },
    )

    it('should keep d4 within its documented 8..92 exception', () => {
      // Arrange / Act — pins the exception so it cannot quietly widen further
      const { container } = render(<DiceIcon type="d4" />)
      const coords = coordinatesOf(container)

      // Assert
      expect(Math.min(...coords)).toBe(8)
      expect(Math.max(...coords)).toBe(92)
    })

    it.each(ALL_TYPES)('should keep %s vertices symmetric about x=50', (type) => {
      // Arrange
      const { container } = render(<DiceIcon type={type} />)

      // Act — path data is "<cmd>x y" pairs, so even indices are x
      const points = [...container.querySelectorAll('path')].flatMap((path) => {
        const nums = (path.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
        return nums.reduce<Array<[number, number]>>((acc, n, i) => {
          if (i % 2 === 1) acc.push([nums[i - 1], n])
          return acc
        }, [])
      })

      // Assert — every vertex has a mirror partner
      expect(points.length).toBeGreaterThan(0)
      const unmatched = points.filter(
        ([x, y]) => !points.some(([x2, y2]) => Math.abs(x2 - (100 - x)) < 0.02 && Math.abs(y2 - y) < 0.02),
      )
      expect(unmatched).toEqual([])
    })
  })
})
