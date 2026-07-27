import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '../../contexts/ThemeContext'
import { defaultTheme } from '../../themes/tokens'
import { HUD_LAYOUT } from './hudLayout'
import { UIToggleMini } from './UIToggleMini'

function renderToggle(isVisible: boolean, onClick = vi.fn()) {
  const view = render(
    <ThemeContext.Provider
      value={{
        currentTheme: defaultTheme,
        setTheme: vi.fn(),
        availableThemes: [defaultTheme],
        ownedThemes: [defaultTheme.id],
        purchaseTheme: vi.fn(async () => true),
      }}
    >
      <UIToggleMini isVisible={isVisible} onClick={onClick} />
    </ThemeContext.Provider>,
  )
  return { ...view, onClick }
}

describe('UIToggleMini', () => {
  it('keeps the eye above the nav while UI is visible and changes its action label', () => {
    const { rerender, onClick } = renderToggle(true)

    const hideUi = screen.getByRole('button', { name: 'Hide UI' })
    // z-40 keeps the eye under the z-50 full-screen overlay layer.
    expect(hideUi).toHaveClass('left-4', 'z-40')
    expect(hideUi).toHaveStyle({
      bottom: `${HUD_LAYOUT.eye.bottom}px`,
      width: `${HUD_LAYOUT.eye.size}px`,
      height: `${HUD_LAYOUT.eye.size}px`,
    })
    fireEvent.click(hideUi)
    expect(onClick).toHaveBeenCalledOnce()

    rerender(
      <ThemeContext.Provider
        value={{
          currentTheme: defaultTheme,
          setTheme: vi.fn(),
          availableThemes: [defaultTheme],
          ownedThemes: [defaultTheme.id],
          purchaseTheme: vi.fn(async () => true),
        }}
      >
        <UIToggleMini isVisible={false} onClick={onClick} />
      </ThemeContext.Provider>,
    )

    expect(screen.getByRole('button', { name: 'Show UI' })).toBeInTheDocument()
  })
})
