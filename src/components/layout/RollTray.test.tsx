import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '../../contexts/ThemeContext'
import { INVENTORY_DIE_DRAG_TYPE, serializeInventoryDieDragPayload } from '../../lib/inventoryDrag'
import { defaultTheme } from '../../themes/tokens'
import type { DiceShape } from '../../types/diceShape'
import { RollTray, type RollTrayDie } from './RollTray'

function renderTray(overrides: {
  dice?: RollTrayDie[]
  onAddGenericDie?: (type: DiceShape) => void
  onAddSpecificDie?: (type: DiceShape, inventoryDieId: string) => void
  onRemoveDie?: (id: string) => void
  onClearAll?: () => void
  onOpenInventory?: () => void
  onInspectDie?: (inventoryDieId: string) => void
} = {}) {
  const props = {
    dice: overrides.dice ?? [],
    isVisible: true,
    onAddGenericDie: overrides.onAddGenericDie ?? vi.fn(),
    onAddSpecificDie: overrides.onAddSpecificDie ?? vi.fn(),
    onRemoveDie: overrides.onRemoveDie ?? vi.fn(),
    onClearAll: overrides.onClearAll ?? vi.fn(),
    onOpenInventory: overrides.onOpenInventory ?? vi.fn(),
    onInspectDie: overrides.onInspectDie ?? vi.fn(),
  }

  render(
    <ThemeContext.Provider
      value={{
        currentTheme: defaultTheme,
        setTheme: vi.fn(),
        availableThemes: [defaultTheme],
        ownedThemes: [defaultTheme.id],
        purchaseTheme: vi.fn(async () => true),
      }}
    >
      <RollTray {...props} />
    </ThemeContext.Provider>
  )

  return props
}

function makeDataTransfer(payload: string) {
  return {
    dropEffect: 'none',
    getData: vi.fn((type: string) => type === INVENTORY_DIE_DRAG_TYPE ? payload : ''),
    setData: vi.fn(),
  } as unknown as DataTransfer
}

describe('RollTray', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('adds generic dice through tap controls', () => {
    const onAddGenericDie = vi.fn()
    renderTray({ onAddGenericDie })

    fireEvent.click(screen.getByRole('button', { name: /add generic d6 to tray/i }))

    expect(onAddGenericDie).toHaveBeenCalledWith('d6')
  })

  it('accepts a dragged owned inventory die payload', () => {
    const onAddSpecificDie = vi.fn()
    renderTray({ onAddSpecificDie })

    fireEvent.drop(screen.getByTestId('roll-tray-drop-zone'), {
      dataTransfer: makeDataTransfer(serializeInventoryDieDragPayload({
        inventoryDieId: 'owned-d20',
        type: 'd20',
        name: 'Lucky D20',
      })),
    })

    expect(onAddSpecificDie).toHaveBeenCalledWith('d20', 'owned-d20')
  })

  it('removes and reorders selected dice in the tray', () => {
    const onRemoveDie = vi.fn()
    renderTray({
      onRemoveDie,
      dice: [
        { id: 'generic-d6', type: 'd6' },
        { id: 'owned-d20-instance', type: 'd20', inventoryDieId: 'owned-d20', displayName: 'Lucky D20', rarity: 'rare' },
      ],
    })

    const selectedDice = screen.getByLabelText('Selected dice')
    expect(within(selectedDice).getAllByRole('article')[0]).toHaveTextContent('D6')
    expect(within(selectedDice).getAllByRole('article')[1]).toHaveTextContent('Lucky D20')
    expect(screen.getByText('1d6 + Lucky D20')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /move lucky d20 left/i }))

    expect(within(selectedDice).getAllByRole('article')[0]).toHaveTextContent('Lucky D20')

    fireEvent.click(screen.getByRole('button', { name: /remove lucky d20/i }))

    expect(onRemoveDie).toHaveBeenCalledWith('owned-d20-instance')
  })

  it('opens inventory as a tap fallback for selecting owned dice', () => {
    const onOpenInventory = vi.fn()
    renderTray({ onOpenInventory })

    fireEvent.click(screen.getByRole('button', { name: /inventory/i }))

    expect(onOpenInventory).toHaveBeenCalledOnce()
  })

  it('opens the inspector for a specific owned tray die', () => {
    const onInspectDie = vi.fn()
    renderTray({
      onInspectDie,
      dice: [
        { id: 'owned-d20-instance', type: 'd20', inventoryDieId: 'owned-d20', displayName: 'Lucky D20', rarity: 'rare' },
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: /inspect lucky d20/i }))

    expect(onInspectDie).toHaveBeenCalledWith('owned-d20')
  })
})
