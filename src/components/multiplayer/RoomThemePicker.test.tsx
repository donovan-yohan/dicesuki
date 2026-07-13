import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RoomThemePicker } from './RoomThemePicker'
import { THEME_REGISTRY } from '../../themes/registry'

describe('RoomThemePicker', () => {
  it('renders a preview card for every registry theme plus the "none" option', () => {
    render(<RoomThemePicker value={null} onChange={vi.fn()} />)

    // "Each player's own" card.
    expect(screen.getByTestId('room-theme-card-none')).toBeInTheDocument()

    // One card per registry theme, labelled by the theme name.
    for (const theme of THEME_REGISTRY) {
      const card = screen.getByTestId(`room-theme-card-${theme.id}`)
      expect(card).toBeInTheDocument()
      expect(card).toHaveTextContent(theme.name)
    }
  })

  it('marks the selected theme with aria-checked and none otherwise', () => {
    const selected = THEME_REGISTRY[1]
    render(<RoomThemePicker value={selected.id} onChange={vi.fn()} />)

    expect(screen.getByTestId(`room-theme-card-${selected.id}`)).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByTestId('room-theme-card-none')).toHaveAttribute('aria-checked', 'false')
  })

  it('emits the theme id on select and null for "each player\'s own"', () => {
    const onChange = vi.fn()
    const theme = THEME_REGISTRY[2]
    const { rerender } = render(<RoomThemePicker value={null} onChange={onChange} />)

    fireEvent.click(screen.getByTestId(`room-theme-card-${theme.id}`))
    expect(onChange).toHaveBeenCalledWith(theme.id)

    rerender(<RoomThemePicker value={theme.id} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('room-theme-card-none'))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('does not emit changes when disabled', () => {
    const onChange = vi.fn()
    render(<RoomThemePicker value={null} onChange={onChange} disabled />)

    const card = screen.getByTestId(`room-theme-card-${THEME_REGISTRY[0].id}`) as HTMLButtonElement
    expect(card.disabled).toBe(true)
    fireEvent.click(card)
    expect(onChange).not.toHaveBeenCalled()
  })
})
