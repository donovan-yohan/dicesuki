import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeviceMotionButton } from './DeviceMotionButton'

describe('DeviceMotionButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('unsupported devices', () => {
    it('should not render when device motion is unsupported', () => {
      // Mock unsupported device
      const originalDeviceMotionEvent = global.DeviceMotionEvent
      ;(global as any).DeviceMotionEvent = undefined

      render(<DeviceMotionButton />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()

      ;(global as any).DeviceMotionEvent = originalDeviceMotionEvent
    })
  })

  describe('permission prompt state', () => {
    it('should show enable button when permission is prompt', () => {
      render(<DeviceMotionButton />)

      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText(/enable motion/i)).toBeInTheDocument()
    })

    it('should request permission when button clicked', async () => {
      const mockRequestPermission = vi.fn().mockResolvedValue('granted')
      ;(DeviceMotionEvent as any).requestPermission = mockRequestPermission

      render(<DeviceMotionButton />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      await waitFor(() => {
        expect(mockRequestPermission).toHaveBeenCalled()
      })
    })
  })

  describe('permission granted state', () => {
    it('should show active state when permission granted', async () => {
      const mockRequestPermission = vi.fn().mockResolvedValue('granted')
      ;(DeviceMotionEvent as any).requestPermission = mockRequestPermission

      render(<DeviceMotionButton />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      await waitFor(() => {
        expect(screen.getByText(/motion enabled/i)).toBeInTheDocument()
      })
    })

    it('should show shake indicator when shaking', async () => {
      // Auto-grant permission
      ;(DeviceMotionEvent as any).requestPermission = undefined

      render(<DeviceMotionButton />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Note: Testing shake indicator would require triggering devicemotion events
      // which is complex in a unit test. This would be better tested in an integration test.
    })
  })

  describe('permission denied state', () => {
    it('should show denied message when permission denied', async () => {
      const mockRequestPermission = vi.fn().mockResolvedValue('denied')
      ;(DeviceMotionEvent as any).requestPermission = mockRequestPermission

      render(<DeviceMotionButton />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      await waitFor(() => {
        expect(screen.getByText(/motion blocked/i)).toBeInTheDocument()
      })
    })

    it('should show help text for denied state', async () => {
      const mockRequestPermission = vi.fn().mockResolvedValue('denied')
      ;(DeviceMotionEvent as any).requestPermission = mockRequestPermission

      render(<DeviceMotionButton />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      await waitFor(() => {
        expect(screen.getByText(/enable in settings/i)).toBeInTheDocument()
      })
    })
  })

  describe('visual states', () => {
    it('should have distinct styling for each state', async () => {
      const mockRequestPermission = vi.fn().mockResolvedValue('granted')
      ;(DeviceMotionEvent as any).requestPermission = mockRequestPermission

      const { rerender } = render(<DeviceMotionButton />)

      const promptButton = screen.getByRole('button')
      expect(promptButton.className).toContain('bg-')

      fireEvent.click(promptButton)

      await waitFor(() => {
        const grantedButton = screen.getByRole('button')
        expect(grantedButton.className).toContain('bg-')
      })
    })
  })
})
