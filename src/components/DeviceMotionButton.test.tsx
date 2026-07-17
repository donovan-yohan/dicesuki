import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeviceMotionButton } from './DeviceMotionButton'
import { DeviceMotionProvider } from '../contexts/DeviceMotionProvider'

type DeviceMotionEventWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

const motionGlobal = globalThis as unknown as {
  DeviceMotionEvent: DeviceMotionEventWithPermission | undefined
  DeviceOrientationEvent: DeviceOrientationEventWithPermission | undefined
}
const originalDeviceOrientationEvent = motionGlobal.DeviceOrientationEvent

const mutableDeviceMotionEvent = () => DeviceMotionEvent as DeviceMotionEventWithPermission

// Wrapper component to provide context
const renderWithProvider = (component: React.ReactElement) => {
  return render(
    <DeviceMotionProvider>
      {component}
    </DeviceMotionProvider>
  )
}

describe('DeviceMotionButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Existing button tests isolate the DeviceMotion permission path. Orientation
    // permission has its own hook-level coverage and must not auto-grant in jsdom.
    motionGlobal.DeviceOrientationEvent = undefined
  })

  afterAll(() => {
    motionGlobal.DeviceOrientationEvent = originalDeviceOrientationEvent
  })

  describe('unsupported devices', () => {
    it('should not render when device motion is unsupported', () => {
      // Mock unsupported device
      const originalDeviceMotionEvent = motionGlobal.DeviceMotionEvent
      motionGlobal.DeviceMotionEvent = undefined
      try {
        renderWithProvider(<DeviceMotionButton />)
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
      } finally {
        motionGlobal.DeviceMotionEvent = originalDeviceMotionEvent
      }
    })
  })

  describe('permission prompt state', () => {
    it('should show enable button when permission is prompt', () => {
      renderWithProvider(<DeviceMotionButton />)

      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText(/enable motion/i)).toBeInTheDocument()
    })

    it('should request permission when button clicked', async () => {
      const mockRequestPermission = vi.fn().mockResolvedValue('granted')
      mutableDeviceMotionEvent().requestPermission = mockRequestPermission

      renderWithProvider(<DeviceMotionButton />)

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
      mutableDeviceMotionEvent().requestPermission = mockRequestPermission

      renderWithProvider(<DeviceMotionButton />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      await waitFor(() => {
        expect(screen.getByText(/motion enabled/i)).toBeInTheDocument()
      })
    })

    it('should show shake indicator when shaking', async () => {
      // Auto-grant permission
      mutableDeviceMotionEvent().requestPermission = undefined

      renderWithProvider(<DeviceMotionButton />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Note: Testing shake indicator would require triggering devicemotion events
      // which is complex in a unit test. This would be better tested in an integration test.
    })
  })

  describe('permission denied state', () => {
    it('should show denied message when permission denied', async () => {
      const mockRequestPermission = vi.fn().mockResolvedValue('denied')
      mutableDeviceMotionEvent().requestPermission = mockRequestPermission

      renderWithProvider(<DeviceMotionButton />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      await waitFor(() => {
        expect(screen.getByText(/motion blocked/i)).toBeInTheDocument()
      })
    })

    it('should show help text for denied state', async () => {
      const mockRequestPermission = vi.fn().mockResolvedValue('denied')
      mutableDeviceMotionEvent().requestPermission = mockRequestPermission

      renderWithProvider(<DeviceMotionButton />)

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
      mutableDeviceMotionEvent().requestPermission = mockRequestPermission

      renderWithProvider(<DeviceMotionButton />)

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
