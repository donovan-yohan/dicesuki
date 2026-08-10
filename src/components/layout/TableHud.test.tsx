import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '../../contexts/ThemeContext'
import { useInventoryStore } from '../../store/useInventoryStore'
import { defaultTheme } from '../../themes/tokens'
import { TableHud, type TableHudProps } from './TableHud'
import { getDiceToolbarLane } from './hudLayout'

function renderHud(overrides: Partial<TableHudProps> = {}) {
  const handlers = {
    onToggleUIVisibility: vi.fn(),
    onOpenDiceManager: vi.fn(),
    onOpenSavedRolls: vi.fn(),
    onOpenHistory: vi.fn(),
    onOpenPlayerPanel: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenShop: vi.fn(),
    onRotateView: vi.fn(),
    onToggleMotion: vi.fn(),
    onRoll: vi.fn(),
    onAddDice: vi.fn(),
    onClearAllDice: vi.fn(),
    onOpenInventory: vi.fn(),
  }

  const props: TableHudProps = {
    isUIVisible: true,
    isOverlayOpen: false,
    isMobile: true,
    motionMode: false,
    showShop: true,
    isDiceManagerOpen: false,
    canRoll: true,
    ...handlers,
    ...overrides,
  }

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
      <TableHud {...props} />
    </ThemeContext.Provider>,
  )

  return { ...view, handlers, props }
}

const CLUSTER_CONTROLS = ['Rotate view 90 degrees', 'Motion Mode', 'Hide UI'] as const

describe('TableHud (Layout A)', () => {
  beforeEach(() => {
    useInventoryStore.setState({ dice: [] })
  })

  it('renders the Layout A chrome: 5-slot nav, corner icons, and the control cluster', () => {
    renderHud()

    const nav = screen.getByRole('navigation')
    expect(Array.from(nav.querySelectorAll<HTMLElement>('[data-nav-item]')).map(item => item.dataset.navItem))
      .toEqual(['Dice Manager', 'Saved Rolls', 'ROLL', 'Roll History', 'Players/Room'])

    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shop' })).toBeInTheDocument()
    for (const control of CLUSTER_CONTROLS) {
      expect(screen.getByRole('button', { name: control })).toBeInTheDocument()
    }
  })

  it('gates the shop corner icon behind the payments/conversion flag', () => {
    renderHud({ showShop: false })

    expect(screen.queryByRole('button', { name: 'Shop' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  it('drops every control except the eye when the UI is hidden', () => {
    renderHud({ isUIVisible: false })

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Shop' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rotate view 90 degrees' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Motion Mode' })).not.toBeInTheDocument()

    // The eye is the only survivor, and it now offers to bring the UI back.
    expect(screen.getByRole('button', { name: 'Show UI' })).toBeInTheDocument()
  })

  it('suppresses the whole bottom-left cluster while an overlay owns the screen', () => {
    const { rerender, props } = renderHud({ isOverlayOpen: true })

    for (const control of CLUSTER_CONTROLS) {
      expect(screen.queryByRole('button', { name: control })).not.toBeInTheDocument()
    }
    // The nav and corner icons stay mounted — only the cluster is suppressed,
    // because only it sat above the overlay and stole its taps.
    expect(screen.getByRole('navigation')).toBeInTheDocument()

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
        <TableHud {...props} isOverlayOpen={false} />
      </ThemeContext.Provider>,
    )

    for (const control of CLUSTER_CONTROLS) {
      expect(screen.getByRole('button', { name: control })).toBeInTheDocument()
    }
  })

  // 'keeps the eye reachable whenever the UI is hidden' rendered the identical
  // props as 'drops every control except the eye…' above (`isOverlayOpen: false`
  // is already the default) and made the identical assertion.

  it('hides the motion toggle on desktop but keeps rotate and the eye', () => {
    renderHud({ isMobile: false })

    expect(screen.queryByRole('button', { name: 'Motion Mode' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rotate view 90 degrees' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide UI' })).toBeInTheDocument()
  })

  it('stacks the mobile cluster one control per slot', () => {
    renderHud({ isMobile: true, isDiceManagerOpen: true })

    expect(screen.getByRole('button', { name: 'Hide UI' })).toHaveStyle({ bottom: '80px' })
    expect(screen.getByRole('button', { name: 'Motion Mode' })).toHaveStyle({ bottom: '136px' })
    expect(screen.getByTestId('rotate-view-button')).toHaveStyle({ bottom: '192px' })
    expect(screen.getByTestId('dice-toolbar-rail')).toHaveStyle({ bottom: '248px' })
  })

  it('collapses the cluster over the absent motion slot on desktop', () => {
    // Desktop never renders the motion toggle, so leaving its slot empty showed
    // as a dead gap between the eye and rotate. Slots are assigned by rendered
    // order instead, which keeps one uniform gap on both form factors.
    renderHud({ isMobile: false, isDiceManagerOpen: true })

    expect(screen.getByRole('button', { name: 'Hide UI' })).toHaveStyle({ bottom: '80px' })
    expect(screen.getByTestId('rotate-view-button')).toHaveStyle({ bottom: '136px' })
    expect(screen.getByTestId('dice-toolbar-rail')).toHaveStyle({ bottom: '192px' })
  })

  it('routes each HUD control to its callback', () => {
    const { handlers } = renderHud()

    fireEvent.click(screen.getByRole('button', { name: 'Manage Dice' }))
    fireEvent.click(screen.getByRole('button', { name: 'My Dice Rolls' }))
    fireEvent.click(screen.getByRole('button', { name: 'Roll History' }))
    fireEvent.click(screen.getByRole('button', { name: 'Room Players' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Shop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rotate view 90 degrees' }))
    fireEvent.click(screen.getByRole('button', { name: 'Motion Mode' }))
    fireEvent.click(screen.getByRole('button', { name: 'Roll dice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide UI' }))

    expect(handlers.onOpenDiceManager).toHaveBeenCalledOnce()
    expect(handlers.onOpenSavedRolls).toHaveBeenCalledOnce()
    expect(handlers.onOpenHistory).toHaveBeenCalledOnce()
    expect(handlers.onOpenPlayerPanel).toHaveBeenCalledOnce()
    expect(handlers.onOpenSettings).toHaveBeenCalledOnce()
    expect(handlers.onOpenShop).toHaveBeenCalledOnce()
    expect(handlers.onRotateView).toHaveBeenCalledOnce()
    expect(handlers.onToggleMotion).toHaveBeenCalledOnce()
    expect(handlers.onRoll).toHaveBeenCalledOnce()
    expect(handlers.onToggleUIVisibility).toHaveBeenCalledOnce()
  })

  it('keeps the HUD below the full-screen overlay layer', () => {
    renderHud()

    // Overlays render at z-50 and above; nothing in the HUD may compete.
    expect(screen.getByRole('navigation').className).toContain('z-40')
    expect(screen.getByRole('button', { name: 'Rotate view 90 degrees' }).className).toContain('z-40')
    expect(screen.getByRole('button', { name: 'Motion Mode' }).className).toContain('z-40')
    expect(screen.getByRole('button', { name: 'Hide UI' }).className).toContain('z-40')
  })

  it('anchors the dice toolbar rail in its resolved lane and lets it scroll', () => {
    useInventoryStore.setState({
      dice: [
        { id: 'a', type: 'd6', name: 'D6', isFavorite: false, acquiredAt: 1 },
        { id: 'b', type: 'd20', name: 'D20', isFavorite: false, acquiredAt: 2 },
      ] as never,
    })
    renderHud({ isDiceManagerOpen: true })

    const lane = getDiceToolbarLane(window.innerHeight, true)
    const rail = screen.getByTestId('dice-toolbar-rail')
    expect(rail).toHaveStyle({
      bottom: `${lane.bottom}px`,
      maxHeight: `${lane.maxHeight}px`,
    })
    expect(screen.getByTestId('dice-toolbar-scroll').className).toContain('overflow-y-auto')
    expect(rail.className).toContain('z-40')
  })
})
