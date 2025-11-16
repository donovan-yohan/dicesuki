import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DiceIcon } from './DiceIcon'

describe('DiceIcon', () => {
  describe('rendering', () => {
    it('should render d4 icon', () => {
      const { container } = render(<DiceIcon type="d4" />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('width', '24')
      expect(svg).toHaveAttribute('height', '24')
    })

    it('should render d6 icon', () => {
      const { container } = render(<DiceIcon type="d6" />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render d8 icon', () => {
      const { container } = render(<DiceIcon type="d8" />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render d10 icon', () => {
      const { container } = render(<DiceIcon type="d10" />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render d12 icon', () => {
      const { container } = render(<DiceIcon type="d12" />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render d20 icon', () => {
      const { container } = render(<DiceIcon type="d20" />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('sizing', () => {
    it('should use default size of 24', () => {
      const { container } = render(<DiceIcon type="d6" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('width', '24')
      expect(svg).toHaveAttribute('height', '24')
    })

    it('should accept custom size', () => {
      const { container } = render(<DiceIcon type="d6" size={48} />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('width', '48')
      expect(svg).toHaveAttribute('height', '48')
    })
  })

  describe('styling', () => {
    it('should accept custom className', () => {
      const { container } = render(<DiceIcon type="d6" className="custom-class" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('custom-class')
    })

    it('should have viewBox attribute for scalability', () => {
      const { container } = render(<DiceIcon type="d6" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('viewBox', '0 0 100 100')
    })
  })

  describe('unique shapes', () => {
    it('should render d4 as triangle', () => {
      const { container } = render(<DiceIcon type="d4" />)
      const paths = container.querySelectorAll('path')
      expect(paths.length).toBeGreaterThan(0)
    })

    it('should render d6 as rounded square', () => {
      const { container } = render(<DiceIcon type="d6" />)
      const rect = container.querySelector('rect')
      expect(rect).toBeInTheDocument()
      expect(rect).toHaveAttribute('rx', '8')
      expect(rect).toHaveAttribute('ry', '8')
    })

    it('should render different shapes for each dice type', () => {
      const types: Array<'d4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20'> = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']
      const shapes = types.map(type => {
        const { container } = render(<DiceIcon type={type} />)
        return container.innerHTML
      })

      // Verify all shapes are different
      const uniqueShapes = new Set(shapes)
      expect(uniqueShapes.size).toBe(6)
    })
  })
})
