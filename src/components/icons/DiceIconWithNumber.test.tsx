import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiceIconWithNumber } from './DiceIconWithNumber'
import type { DiceType } from './DiceIcon'

const ALL_TYPES: DiceType[] = ['d4', 'd6', 'd8', 'd10', 'd10tens', 'd12', 'd20']

describe('DiceIconWithNumber', () => {
  describe('rendering', () => {
    it('should render dice icon without number', () => {
      const { container } = render(<DiceIconWithNumber type="d6" />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render dice icon with number', () => {
      render(<DiceIconWithNumber type="d6" number={5} />)
      expect(screen.getByText('5')).toBeInTheDocument()
    })

    it.each(ALL_TYPES)('should render number for %s', (type) => {
      // Arrange / Act
      const { unmount } = render(<DiceIconWithNumber type={type} number={3} />)

      // Assert
      expect(screen.getByText('3')).toBeInTheDocument()
      unmount()
    })
  })

  describe('percentile die count placement', () => {
    it('should not stack the count on top of the d10tens % mark', () => {
      // Arrange — DiceEntryCard renders exactly this pair for 1d100
      const { container } = render(<DiceIconWithNumber type="d10tens" number={1} />)

      // Act
      const mark = container.querySelector('text')
      const count = container.querySelector('span')

      // Assert — the % owns the centre of the face...
      expect(mark).toHaveTextContent('%')
      expect(mark).toHaveAttribute('x', '50')
      expect(mark).toHaveAttribute('text-anchor', 'middle')
      // ...so the count must be anchored somewhere else
      expect(count).not.toHaveClass('items-center')
      expect(count).not.toHaveClass('justify-center')
      expect(count).toHaveClass('items-end')
      expect(count).toHaveClass('justify-end')
    })

    it.each(ALL_TYPES.filter((type) => type !== 'd10tens'))(
      'should keep the %s count centred',
      (type) => {
        // Arrange / Act — only the percentile die prints a mark on its face,
        // so only the percentile die gives up the centre
        const { container } = render(<DiceIconWithNumber type={type} number={3} />)

        // Assert
        const count = container.querySelector('span')
        expect(count).toHaveClass('items-center')
        expect(count).toHaveClass('justify-center')
        expect(container.querySelector('text')).toBeNull()
      },
    )
  })

  describe('icon tone', () => {
    it('should drive the icon colour through the tone prop, not a class', () => {
      // Arrange / Act — DiceIcon sets `color` inline, so a colour utility in
      // className would be overridden and silently do nothing
      const { container } = render(<DiceIconWithNumber type="d6" number={3} />)

      // Assert
      const svg = container.querySelector('svg')
      expect(svg?.getAttribute('style')).toContain('color: var(--color-text-secondary)')
      expect(svg?.className.baseVal ?? '').not.toContain('text-theme')
    })

    it('should forward a custom tone to the icon', () => {
      // Arrange / Act
      const { container } = render(
        <DiceIconWithNumber type="d20" number={3} tone="var(--color-accent)" />,
      )

      // Assert
      const svg = container.querySelector('svg')
      expect(svg?.getAttribute('style')).toContain('color: var(--color-accent)')
    })
  })

  describe('number display', () => {
    it('should display single digit numbers', () => {
      render(<DiceIconWithNumber type="d6" number={4} />)
      expect(screen.getByText('4')).toBeInTheDocument()
    })

    it('should display double digit numbers', () => {
      render(<DiceIconWithNumber type="d20" number={20} />)
      expect(screen.getByText('20')).toBeInTheDocument()
    })

    it('should not render number when undefined', () => {
      const { container } = render(<DiceIconWithNumber type="d6" />)
      const numberSpan = container.querySelector('span')
      expect(numberSpan).not.toBeInTheDocument()
    })
  })

  describe('sizing', () => {
    it('should use default size of 24', () => {
      const { container } = render(<DiceIconWithNumber type="d6" number={3} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.style.width).toBe('24px')
      expect(wrapper.style.height).toBe('24px')
    })

    it('should accept custom size', () => {
      const { container } = render(<DiceIconWithNumber type="d6" number={3} size={48} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.style.width).toBe('48px')
      expect(wrapper.style.height).toBe('48px')
    })

    it('should scale font size with icon size', () => {
      const { container } = render(<DiceIconWithNumber type="d6" number={3} size={100} />)
      const numberSpan = container.querySelector('span')
      expect(numberSpan).toHaveStyle({ fontSize: '40px' })
    })
  })

  describe('styling', () => {
    it('should accept custom className', () => {
      const { container } = render(<DiceIconWithNumber type="d6" className="custom-class" />)
      const wrapper = container.firstChild
      expect(wrapper).toHaveClass('custom-class')
    })

    it('should position number absolutely over icon', () => {
      const { container } = render(<DiceIconWithNumber type="d6" number={5} />)
      const wrapper = container.firstChild
      expect(wrapper).toHaveClass('relative')

      const numberSpan = container.querySelector('span')
      expect(numberSpan).toHaveClass('absolute')
    })

    it('should center number within icon', () => {
      const { container } = render(<DiceIconWithNumber type="d6" number={5} />)
      const numberSpan = container.querySelector('span')
      expect(numberSpan).toHaveClass('flex')
      expect(numberSpan).toHaveClass('items-center')
      expect(numberSpan).toHaveClass('justify-center')
    })
  })

  describe('accessibility', () => {
    it('should make number non-interactive', () => {
      const { container } = render(<DiceIconWithNumber type="d6" number={5} />)
      const numberSpan = container.querySelector('span')
      expect(numberSpan).toHaveClass('pointer-events-none')
    })

    it('should render number with high contrast', () => {
      const { container } = render(<DiceIconWithNumber type="d6" number={5} />)
      const numberSpan = container.querySelector('span')
      // Brand cream token (var(--color-text-primary)) reads on the lavender die icon.
      expect(numberSpan).toHaveClass('text-theme-text')
      expect(numberSpan).toHaveStyle({ textShadow: '0 1px 2px rgba(0,0,0,0.3)' })
    })
  })
})
