import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeContext } from '../../contexts/ThemeContext'
import { useDiceManagerStore } from '../../store/useDiceManagerStore'
import { useDragStore } from '../../store/useDragStore'
import { useInventoryStore } from '../../store/useInventoryStore'
import { useMultiplayerStore, type MultiplayerDie } from '../../store/useMultiplayerStore'
import { defaultTheme } from '../../themes/tokens'
import type { DiceShape } from '../../types/diceShape'
import type { DieRarity, NewInventoryDie } from '../../types/inventory'
import { DiceToolbar } from './DiceToolbar'

vi.mock('../panels/SharedInventoryDicePreviewCanvas', () => ({
  SharedInventoryDicePreviewCanvas: () => (
    <canvas data-testid="inventory-preview-canvas" />
  ),
}))

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

function makeMultiplayerDie(overrides: Partial<MultiplayerDie>): MultiplayerDie {
  return {
    id: 'mp-die',
    ownerId: 'p1',
    diceType: 'd6',
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    targetPosition: [0, 0, 0],
    targetRotation: [0, 0, 0, 1],
    prevPosition: [0, 0, 0],
    prevRotation: [0, 0, 0, 1],
    isRolling: false,
    faceValue: null,
    ...overrides,
  }
}

function renderToolbar(overrides: {
  onAddDice?: (type: DiceShape, inventoryDieId?: string) => void
  onOpenInventory?: () => void
} = {}) {
  const props = {
    isOpen: true,
    onAddDice: overrides.onAddDice ?? vi.fn(),
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

describe('DiceToolbar', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useInventoryStore.getState().reset()
    useDiceManagerStore.getState().removeAllDice()
    useDragStore.setState({ draggedDiceId: null })
    useMultiplayerStore.getState().reset()
  })

  it('asks the backend to spawn a random owned die from the main rail button', () => {
    addNamedDie('Starter D6', 'd6', 'common')
    const onAddDice = vi.fn()

    renderToolbar({ onAddDice })

    fireEvent.click(screen.getByRole('button', { name: /add random d6 from inventory/i }))

    expect(onAddDice).toHaveBeenCalledWith('d6')
  })

  it('disables a dice type when all owned dice of that type are already on the table', () => {
    const ownedDie = addNamedDie('Only D6', 'd6', 'common')
    useDiceManagerStore.getState().addDice('d6', 'default', 'table-d6', ownedDie.id)
    const onAddDice = vi.fn()

    renderToolbar({ onAddDice })

    const d6Button = screen.getByTestId('dice-quick-slot-d6')
    expect(d6Button).toBeDisabled()

    fireEvent.click(d6Button)

    expect(onAddDice).not.toHaveBeenCalled()
  })

  it('counts pending multiplayer inventory dice as unavailable', () => {
    const ownedDie = addNamedDie('Only Online D6', 'd6', 'common')
    useMultiplayerStore.setState({ pendingInventoryDieIds: new Set([ownedDie.id]) })
    const onAddDice = vi.fn()

    renderToolbar({ onAddDice })

    expect(screen.getByTestId('dice-quick-slot-d6')).toBeDisabled()
  })

  it('counts owned multiplayer table dice as unavailable after server acknowledgement', () => {
    const ownedDie = addNamedDie('Online Table D6', 'd6', 'common')
    useMultiplayerStore.setState({
      localPlayerId: 'p1',
      dice: new Map([[
        'mp-d6',
        makeMultiplayerDie({
          id: 'mp-d6',
          presentation: { inventoryDieId: ownedDie.id },
        }),
      ]]),
    })

    renderToolbar()

    expect(screen.getByTestId('dice-quick-slot-d6')).toBeDisabled()
  })

  it('opens a favorite dice flyout with 3d preview targets and spawns the tapped favorite', () => {
    const favorite = addNamedDie('Lucky D20', 'd20', 'rare', { isFavorite: true })
    const onAddDice = vi.fn()

    renderToolbar({ onAddDice })

    fireEvent.click(screen.getByRole('button', { name: /show favorite d20 dice/i }))

    expect(screen.getByLabelText('Favorite D20 dice', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByTestId('inventory-preview-canvas')).toBeInTheDocument()
    expect(screen.getAllByTestId('favorite-dice-preview')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /add favorite lucky d20/i }))

    expect(onAddDice).toHaveBeenCalledWith('d20', favorite.id)
  })

  it('opens full inventory from the rail', () => {
    addNamedDie('Starter D4', 'd4', 'common')
    const onOpenInventory = vi.fn()

    renderToolbar({ onOpenInventory })

    fireEvent.click(screen.getByRole('button', { name: /open full dice inventory/i }))

    expect(onOpenInventory).toHaveBeenCalledOnce()
  })

  it('keeps the trash target aligned in the rail for scene-level drag deletion', () => {
    addNamedDie('Starter D8', 'd8', 'common')

    renderToolbar()

    expect(screen.getByRole('button', { name: /trash drop zone/i })).toHaveAttribute('id', 'trash-drop-zone')
  })
})
