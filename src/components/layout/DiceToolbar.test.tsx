import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeContext } from '../../contexts/ThemeContext'
import { ROLL_TRAY_DIE_DRAG_TYPE, serializeRollTrayDieDragPayload } from '../../lib/rollTrayDrag'
import { useDiceManagerStore } from '../../store/useDiceManagerStore'
import { useInventoryStore } from '../../store/useInventoryStore'
import { defaultTheme } from '../../themes/tokens'
import type { DiceShape } from '../../types/diceShape'
import type { DieRarity, NewInventoryDie } from '../../types/inventory'
import { DiceToolbar } from './DiceToolbar'

const makeDie = (overrides: Partial<NewInventoryDie> = {}): NewInventoryDie => ({
  type: 'd6',
  setId: 'starter-devil',
  rarity: 'common',
  appearance: {
    baseColor: '#b91c1c',
    accentColor: '#ffffff',
    material: 'plastic',
  },
  vfx: {},
  name: 'Test Die',
  isFavorite: false,
  isLocked: false,
  tags: [],
  source: 'starter',
  assignedToRolls: [],
  ...overrides,
})

function addNamedDie(
  name: string,
  type: DiceShape,
  rarity: DieRarity,
  extra: Partial<NewInventoryDie> = {},
) {
  return useInventoryStore.getState().addDie(makeDie({
    name,
    type,
    rarity,
    ...extra,
  }))
}

function renderToolbar(overrides: {
  onAddGenericDie?: (type: DiceShape) => void
  onAddSpecificDie?: (type: DiceShape, inventoryDieId: string) => void
  onRemoveDie?: (id: string) => void
  onOpenInventory?: () => void
} = {}) {
  const props = {
    isOpen: true,
    onAddGenericDie: overrides.onAddGenericDie ?? vi.fn(),
    onAddSpecificDie: overrides.onAddSpecificDie ?? vi.fn(),
    onRemoveDie: overrides.onRemoveDie ?? vi.fn(),
    onOpenInventory: overrides.onOpenInventory ?? vi.fn(),
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
      <DiceToolbar {...props} />
    </ThemeContext.Provider>,
  )

  return props
}

function makeRollTrayDataTransfer(dieId: string) {
  return {
    dropEffect: 'none',
    getData: vi.fn((type: string) => (
      type === ROLL_TRAY_DIE_DRAG_TYPE ? serializeRollTrayDieDragPayload(dieId) : ''
    )),
  } as unknown as DataTransfer
}

describe('DiceToolbar', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useInventoryStore.getState().reset()
    useDiceManagerStore.getState().removeAllDice()
  })

  it('adds a generic die from the main rail button', () => {
    addNamedDie('Starter D6', 'd6', 'common')
    const onAddGenericDie = vi.fn()

    renderToolbar({ onAddGenericDie })

    fireEvent.click(screen.getByRole('button', { name: /add generic d6/i }))

    expect(onAddGenericDie).toHaveBeenCalledWith('d6')
  })

  it('cycles a favorite die onto the rail and spawns that specific inventory die', () => {
    const favorite = addNamedDie('Lucky D20', 'd20', 'rare', { isFavorite: true })
    const onAddSpecificDie = vi.fn()

    renderToolbar({ onAddSpecificDie })

    fireEvent.click(screen.getByRole('button', { name: /next favorite d20/i }))
    fireEvent.click(screen.getByRole('button', { name: /add lucky d20/i }))

    expect(onAddSpecificDie).toHaveBeenCalledWith('d20', favorite.id)
  })

  it('opens full inventory from the rail', () => {
    addNamedDie('Starter D4', 'd4', 'common')
    const onOpenInventory = vi.fn()

    renderToolbar({ onOpenInventory })

    fireEvent.click(screen.getByRole('button', { name: /open full dice inventory/i }))

    expect(onOpenInventory).toHaveBeenCalledOnce()
  })

  it('removes a tray die dropped on the trash target', () => {
    addNamedDie('Starter D8', 'd8', 'common')
    const onRemoveDie = vi.fn()

    renderToolbar({ onRemoveDie })

    fireEvent.drop(screen.getByRole('button', { name: /trash drop zone/i }), {
      dataTransfer: makeRollTrayDataTransfer('tray-die-1'),
    })

    expect(onRemoveDie).toHaveBeenCalledWith('tray-die-1')
  })
})
