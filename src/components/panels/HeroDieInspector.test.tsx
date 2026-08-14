import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BottomSheet } from './BottomSheet'
import { useInventoryStore } from '../../store/useInventoryStore'
import { defaultTheme } from '../../themes/tokens'
import type { NewInventoryDie } from '../../types/inventory'
import { HeroDieInspector } from './HeroDieInspector'

// Canvas is mocked so the static preview meshes (StandardHeroDie / GltfHeroDie)
// never mount in jsdom; this keeps the test focused on the inspector's form logic.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="mock-canvas" />,
}))

vi.mock('@react-three/drei', () => ({
  Environment: () => null,
}))

const makeDie = (overrides: Partial<NewInventoryDie> = {}): NewInventoryDie => ({
  type: 'd20',
  setId: 'adventurer-starter',
  rarity: 'rare',
  appearance: {
    baseColor: '#2563eb',
    accentColor: '#ffffff',
    material: 'plastic',
  },
  vfx: {},
  name: 'Starter d20',
  description: 'Opening note',
  isFavorite: false,
  isLocked: false,
  tags: ['starter'],
  source: 'starter',
  assignedToRolls: [],
  ...overrides,
})

describe('HeroDieInspector', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useInventoryStore.getState().reset()
  })

  it('persists favorite, name, notes, and tags through the inventory store', () => {
    const die = useInventoryStore.getState().addDie(makeDie())

    render(
      <HeroDieInspector
        die={die}
        theme={defaultTheme}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByTestId('hero-die-stage')).toHaveAttribute('data-lod', expect.stringContaining('hero'))

    fireEvent.click(screen.getByRole('button', { name: /favorite/i }))
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Lucky Persuasion d20' } })
    fireEvent.change(screen.getByLabelText(/tags/i), { target: { value: 'social, lucky, social' } })
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: 'Saved for important checks' } })
    fireEvent.click(screen.getByRole('button', { name: /save identity/i }))

    const updated = useInventoryStore.getState().dice.find(item => item.id === die.id)
    expect(updated?.isFavorite).toBe(true)
    expect(updated?.name).toBe('Lucky Persuasion d20')
    expect(updated?.description).toBe('Saved for important checks')
    expect(updated?.tags).toEqual(['social', 'lucky'])
  })
})

/**
 * The nested-dialog contract, proved against the REAL `BottomSheet`.
 *
 * `BottomSheet` yields Escape and its focus trap while a nested
 * `[role="dialog"][aria-modal="true"]` is mounted. That yield is only safe if
 * the nested dialog then handles both itself — and this inspector declared
 * `aria-modal` while handling NEITHER, so the yield alone left Escape dead and
 * let Tab walk out of the sheet onto the HUD behind it.
 *
 * This is the regression gate for both halves at once, and it has to use the
 * real sheet: `InventoryPanel.test.tsx` mocks `BottomSheet` away, which is
 * exactly why the interaction went unnoticed.
 *
 * jsdom does not implement native Tab navigation, so these only prove the trap
 * WRAPS when it is reached. That a stray Tab cannot walk out onto the HUD is a
 * browser fact, and is asserted in `e2e/roll-picker.spec.ts`.
 */
describe('HeroDieInspector nested inside a BottomSheet', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useInventoryStore.getState().reset()
  })

  /**
   * Mounts the sheet FIRST and only then opens the inspector, which is the real
   * sequence: the sheet is already open and has already taken focus when a die
   * is inspected. Mounting both in one pass would race the two focus effects in
   * an order that cannot happen in the app.
   */
  function renderInSheet(options: { inspectorOpen?: boolean } = {}) {
    const die = useInventoryStore.getState().addDie(makeDie())
    const onSheetClose = vi.fn()
    const onInspectorClose = vi.fn()

    const Host = ({ children }: { children: ReactNode }) => (
      <BottomSheet isOpen onClose={onSheetClose} title="Dice Collection">
        <button type="button">Sheet control</button>
        {children}
      </BottomSheet>
    )

    const view = render(<Host>{null}</Host>)
    if (options.inspectorOpen !== false) {
      view.rerender(
        <Host>
          <HeroDieInspector die={die} theme={defaultTheme} onClose={onInspectorClose} />
        </Host>,
      )
    }

    const closeInspector = () => view.rerender(<Host>{null}</Host>)
    return { onSheetClose, onInspectorClose, closeInspector, ...view }
  }

  it('is an aria-modal dialog, which is what makes the sheet yield', () => {
    renderInSheet()

    const inspector = screen.getByTestId('hero-die-inspector')
    expect(inspector).toHaveAttribute('role', 'dialog')
    expect(inspector).toHaveAttribute('aria-modal', 'true')
  })

  it('closes only the inspector on the first Escape', () => {
    const { onSheetClose, onInspectorClose } = renderInSheet()

    fireEvent.keyDown(screen.getByTestId('hero-die-inspector'), { key: 'Escape' })

    expect(onInspectorClose).toHaveBeenCalledOnce()
    expect(onSheetClose).not.toHaveBeenCalled()
  })

  it('closes the sheet on the next Escape, once the inspector is gone', () => {
    const { onSheetClose } = renderInSheet({ inspectorOpen: false })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onSheetClose).toHaveBeenCalledOnce()
  })

  it('wraps Tab inside the inspector instead of leaking into the sheet', async () => {
    renderInSheet()
    const inspector = screen.getByTestId('hero-die-inspector')
    await waitFor(() => expect(inspector.contains(document.activeElement)).toBe(true))

    const focusable = Array.from(
      inspector.querySelectorAll<HTMLElement>('button:not([disabled]),input,textarea'),
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    last.focus()
    fireEvent.keyDown(inspector, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(inspector, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('restores focus to the opener when it closes', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const { closeInspector } = renderInSheet()
    await waitFor(() => {
      expect(screen.getByTestId('hero-die-inspector').contains(document.activeElement)).toBe(true)
    })

    closeInspector()

    expect(screen.queryByTestId('hero-die-inspector')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
