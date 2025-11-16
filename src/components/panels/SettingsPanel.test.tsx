/**
 * Tests for SettingsPanel component
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SettingsPanel } from './SettingsPanel'

// Mock version utility
vi.mock('../../lib/version', () => ({
  getFormattedVersion: () => 'v0.1.0'
}))

// Mock haptic feedback hook
vi.mock('../../hooks/useHapticFeedback', () => ({
  useHapticFeedback: () => ({
    isEnabled: true,
    isSupported: true,
    setEnabled: vi.fn()
  })
}))

// Mock ThemeSelector to avoid ThemeProvider dependency
vi.mock('../ThemeSelector', () => ({
  ThemeSelector: () => null
}))

describe('SettingsPanel', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn()
  }

  describe('version display', () => {
    it('should display app version', () => {
      render(<SettingsPanel {...defaultProps} />)

      // Check for version text
      expect(screen.getByText('v0.1.0')).toBeInTheDocument()
    })

    it('should display version in muted style', () => {
      render(<SettingsPanel {...defaultProps} />)

      const versionElement = screen.getByText('v0.1.0')

      // Check text size class
      expect(versionElement).toHaveClass('text-xs')

      // Check inline styles
      expect(versionElement).toHaveStyle({
        opacity: '0.6'
      })
    })

    it('should display version at the bottom of panel', () => {
      render(<SettingsPanel {...defaultProps} />)

      const versionElement = screen.getByText('v0.1.0')
      const parentDiv = versionElement.closest('.pt-8')

      // Check that version is in a container with top padding
      expect(parentDiv).toBeInTheDocument()
      expect(parentDiv).toHaveClass('mt-auto')
    })
  })
})
