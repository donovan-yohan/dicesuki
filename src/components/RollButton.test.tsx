import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RollButton } from './RollButton'

describe('RollButton', () => {
  describe('rendering', () => {
    it('should render a button', () => {
      render(<RollButton onClick={() => {}} disabled={false} />)
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('should display "Roll Dice" text when enabled', () => {
      render(<RollButton onClick={() => {}} disabled={false} />)
      expect(screen.getByText('Roll Dice')).toBeInTheDocument()
    })

    it('should display "Rolling..." text when disabled', () => {
      render(<RollButton onClick={() => {}} disabled={true} />)
      expect(screen.getByText('Rolling...')).toBeInTheDocument()
    })
  })

  describe('interaction', () => {
    it('should call onClick when clicked', () => {
      const handleClick = vi.fn()
      render(<RollButton onClick={handleClick} disabled={false} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('should not call onClick when disabled', () => {
      const handleClick = vi.fn()
      render(<RollButton onClick={handleClick} disabled={true} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      expect(handleClick).not.toHaveBeenCalled()
    })

    it('should be disabled when disabled prop is true', () => {
      render(<RollButton onClick={() => {}} disabled={true} />)
      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
    })

    it('should be enabled when disabled prop is false', () => {
      render(<RollButton onClick={() => {}} disabled={false} />)
      const button = screen.getByRole('button')
      expect(button).not.toBeDisabled()
    })
  })

  describe('styling', () => {
    it('should have primary button styling when enabled', () => {
      render(<RollButton onClick={() => {}} disabled={false} />)
      const button = screen.getByRole('button')

      // Check for Tailwind classes that indicate primary button styling
      expect(button.className).toContain('bg-orange-500')
    })

    it('should have disabled styling when disabled', () => {
      render(<RollButton onClick={() => {}} disabled={true} />)
      const button = screen.getByRole('button')

      // Check for disabled styling classes
      expect(button.className).toContain('opacity-50')
      expect(button.className).toContain('cursor-not-allowed')
    })

    it('should have hover effect classes when enabled', () => {
      render(<RollButton onClick={() => {}} disabled={false} />)
      const button = screen.getByRole('button')

      expect(button.className).toContain('hover:bg-orange-600')
    })

    it('should be positioned at the bottom center', () => {
      const { container } = render(<RollButton onClick={() => {}} disabled={false} />)
      const wrapper = container.firstChild

      // Check positioning classes
      expect(wrapper).toHaveClass('fixed')
      expect(wrapper).toHaveClass('bottom-8')
      expect(wrapper).toHaveClass('left-1/2')
    })
  })

  describe('accessibility', () => {
    it('should have appropriate aria-label', () => {
      render(<RollButton onClick={() => {}} disabled={false} />)
      const button = screen.getByRole('button')

      expect(button).toHaveAttribute('aria-label', 'Roll dice')
    })

    it('should be keyboard accessible', () => {
      const handleClick = vi.fn()
      render(<RollButton onClick={handleClick} disabled={false} />)

      const button = screen.getByRole('button')
      button.focus()

      expect(document.activeElement).toBe(button)
    })
  })
})
