import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '../../contexts/ThemeContext'
import { INVENTORY_DIE_DRAG_TYPE, serializeInventoryDieDragPayload } from '../../lib/inventoryDrag'
import { ROLL_TRAY_DIE_DRAG_TYPE } from '../../lib/rollTrayDrag'
import { defaultTheme } from '../../themes/tokens'
import type { DiceShape } from '../../types/diceShape'
import { RollTray, type RollTrayDie } from './RollTray'

function renderTray(overrides: {
  dice?: RollTrayDie[]
  onAddSpecificDie?: (type: DiceShape, inventoryDieId: string) => void
  onRemoveDie?: (id: string) => void
  onInspectDie?: (inventoryDieId: string) => void
} = {}) {
  const props = {
    dice: overrides.dice ?? [],
    isVisible: true,
    onAddSpecificDie: overrides.onAddSpecificDie ?? vi.fn(),
    onRemoveDie: overrides.onRemoveDie ?? vi.fn(),
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

  it('shows selected dice and removes tray dice through keyboard fallback', () => {
    const onRemoveDie = vi.fn()
    renderTray({
      onRemoveDie,
      dice: [
        { id: 'generic-d6', type: 'd6' },
        { id: 'owned-d20-instance', type: 'd20', inventoryDieId: 'owned-d20', displayName: 'Lucky D20', rarity: 'rare' },
      ],
    })

    const selectedDice = screen.getByLabelText('Selected dice')
    expect(within(selectedDice).getAllByTestId('roll-tray-die')[0]).toHaveTextContent('D6')
    expect(within(selectedDice).getAllByTestId('roll-tray-die')[1]).toHaveTextContent('Lucky D20')
    expect(screen.getByText('1d6 + Lucky D20')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByLabelText('Lucky D20 tray die'), { key: 'Delete' })

    expect(onRemoveDie).toHaveBeenCalledWith('owned-d20-instance')
  })

  it('opens the inspector for a specific owned tray die', () => {
    const onInspectDie = vi.fn()
    renderTray({
      onInspectDie,
      dice: [
        { id: 'owned-d20-instance', type: 'd20', inventoryDieId: 'owned-d20', displayName: 'Lucky D20', rarity: 'rare' },
      ],
    })

    fireEvent.click(screen.getByLabelText('Lucky D20 tray die'))

    expect(onInspectDie).toHaveBeenCalledWith('owned-d20')
  })

  it('serializes tray dice for the trash drop zone', () => {
    renderTray({
      dice: [
        { id: 'owned-d20-instance', type: 'd20', inventoryDieId: 'owned-d20', displayName: 'Lucky D20', rarity: 'rare' },
      ],
    })

    const dataTransfer = {
      effectAllowed: 'copy',
      setData: vi.fn(),
    } as unknown as DataTransfer

    fireEvent.dragStart(screen.getByLabelText('Lucky D20 tray die'), { dataTransfer })

    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'owned-d20-instance')
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      ROLL_TRAY_DIE_DRAG_TYPE,
      expect.stringContaining('owned-d20-instance'),
    )
  })
})
