import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QrCode } from './QrCode'

describe('QrCode', () => {
  it('renders an accessible SVG with an encoded path', () => {
    render(<QrCode value="https://dice.app/room/ABC123" />)

    const svg = screen.getByTestId('room-qr')
    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg).toHaveAttribute('aria-label', 'QR code for https://dice.app/room/ABC123')

    // The dark modules are drawn as a single <path>; it must be non-empty.
    const path = svg.querySelector('path')
    expect(path).not.toBeNull()
    expect((path?.getAttribute('d') ?? '').length).toBeGreaterThan(0)
  })

  it('honors the requested pixel size', () => {
    render(<QrCode value="x" size={160} data-testid="sized-qr" />)
    const svg = screen.getByTestId('sized-qr')
    expect(svg).toHaveAttribute('width', '160')
    expect(svg).toHaveAttribute('height', '160')
  })
})
