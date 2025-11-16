import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiceIconWithNumber } from './DiceIconWithNumber'

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

    it('should render number for all dice types', () => {
      const types: Array<'d4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20'> = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

      types.forEach(type => {
        const { unmount } = render(<DiceIconWithNumber type={type} number={3} />)
        expect(screen.getByText('3')).toBeInTheDocument()
        unmount()
      })
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
      expect(numberSpan).toHaveClass('text-white')
      expect(numberSpan).toHaveStyle({ textShadow: '0 1px 2px rgba(0,0,0,0.3)' })
    })
  })
})
