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

  it('renders only current world cards alongside Classic and the per-player option', () => {
    render(<RoomThemePicker value={null} onChange={vi.fn()} />)

    expect(screen.getAllByRole('radio').map(card => card.getAttribute('data-testid'))).toEqual([
      'room-theme-card-none',
      'room-theme-card-default',
      'room-theme-card-sunlit-glade-cel',
      'room-theme-card-cyberpunk-cutline',
      'room-theme-card-monster-dungeon',
    ])
  })

  it.each([
    ['fantasy-earth', 'sunlit-glade-cel'],
    ['critter-forest', 'sunlit-glade-cel'],
    ['sunlit-glade', 'sunlit-glade-cel'],
    ['dungeon-castle', 'monster-dungeon'],
    ['neon-cyber-city', 'cyberpunk-cutline'],
  ])('shows legacy %s as selected %s but emits only after an explicit click', (legacyId, canonicalId) => {
    const onChange = vi.fn()
    render(<RoomThemePicker value={legacyId} onChange={onChange} />)

    const card = screen.getByTestId(`room-theme-card-${canonicalId}`)
    expect(card).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByRole('radio').filter(radio => radio.getAttribute('aria-checked') === 'true')).toEqual([card])
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(card)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(canonicalId)
  })

  it('shows a legacy selection read-only for non-hosts without emitting a migration', () => {
    const onChange = vi.fn()
    render(<RoomThemePicker value="dungeon-castle" onChange={onChange} disabled />)

    const card = screen.getByTestId('room-theme-card-monster-dungeon')
    expect(card).toHaveAttribute('aria-checked', 'true')
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled()
      fireEvent.click(radio)
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not select a canonical card for an unknown controlled value', () => {
    const onChange = vi.fn()
    render(<RoomThemePicker value="unknown-room-theme" onChange={onChange} />)
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false')
    }
    expect(onChange).not.toHaveBeenCalled()
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

  it('skins only picker paint and keeps the selected room scope separate', () => {
    const onChange = vi.fn()
    render(<RoomThemePicker value={null} onChange={onChange} />)
    const none = screen.getByTestId('room-theme-card-none')
    expect(none.style.backgroundColor).toBe('var(--ui-picker-surface)')
    expect(none).toHaveAttribute('aria-checked', 'true')
    expect(onChange).not.toHaveBeenCalled()
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
