import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDiceManagerStore } from '../store/useDiceManagerStore'
import { useTheme } from './ThemeContext'
import { ThemeProvider } from './ThemeProvider'

function ThemeControls() {
  const { currentTheme, setTheme } = useTheme()

  return (
    <>
      <output data-testid="active-theme">{currentTheme.id}</output>
      <button onClick={() => setTheme('dungeon-castle')}>Dungeon</button>
      <button onClick={() => setTheme('neon-cyber-city')}>Cyberpunk</button>
    </>
  )
}

describe('ThemeProvider', () => {
  let updateDiceColors: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    localStorage.clear()
    useDiceManagerStore.getState().removeAllDice()
    updateDiceColors = vi
      .spyOn(useDiceManagerStore.getState(), 'updateDiceColors')
      .mockImplementation(() => undefined)
  })

  afterEach(() => {
    updateDiceColors.mockRestore()
    localStorage.clear()
    useDiceManagerStore.getState().removeAllDice()
  })

  it('synchronizes dice colors immediately for each selected theme', () => {
    render(
      <ThemeProvider>
        <ThemeControls />
      </ThemeProvider>
    )

    updateDiceColors.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Dungeon' }))

    expect(screen.getByTestId('active-theme')).toHaveTextContent('dungeon-castle')
    expect(updateDiceColors).toHaveBeenCalledExactlyOnceWith('dungeon-castle')

    fireEvent.click(screen.getByRole('button', { name: 'Cyberpunk' }))

    expect(screen.getByTestId('active-theme')).toHaveTextContent('neon-cyber-city')
    expect(updateDiceColors).toHaveBeenLastCalledWith('neon-cyber-city')
  })
})
