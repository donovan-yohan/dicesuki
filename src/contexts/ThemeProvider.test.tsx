import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('applies each selected theme immediately', () => {
    render(
      <ThemeProvider>
        <ThemeControls />
      </ThemeProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dungeon' }))

    expect(screen.getByTestId('active-theme')).toHaveTextContent('dungeon-castle')
    expect(document.documentElement.style.getPropertyValue('--color-background')).not.toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Cyberpunk' }))

    expect(screen.getByTestId('active-theme')).toHaveTextContent('neon-cyber-city')
  })
})
