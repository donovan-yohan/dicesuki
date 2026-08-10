import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeContext } from '../../contexts/ThemeContext'
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
  isMobile?: boolean
  onAddDice?: (type: DiceShape, inventoryDieId?: string) => void
  onClearAllDice?: () => void
  onOpenInventory?: () => void
} = {}) {
  const props = {
    isOpen: true,
    isMobile: overrides.isMobile ?? true,
    onAddDice: overrides.onAddDice ?? vi.fn(),
    onClearAllDice: overrides.onClearAllDice ?? vi.fn(),
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
    useDragStore.setState({ draggedDiceId: null })
    useMultiplayerStore.getState().reset()
  })

  it('asks the backend to spawn a die of the tapped type from the main rail button', () => {
    addNamedDie('Starter D6', 'd6', 'common')
    const onAddDice = vi.fn()

    renderToolbar({ onAddDice })

    fireEvent.click(screen.getByTestId('dice-quick-slot-d6'))

    expect(onAddDice).toHaveBeenCalledWith('d6')
  })

  it('labels the rail button by what tapping does, not by how many dice are left', () => {
    addNamedDie('Starter D6', 'd6', 'common')

    renderToolbar()

    // One label whatever the inventory holds: the owned-first-then-basics
    // behaviour is the same for a type you own ten of and one you own none of.
    for (const label of ['D6', 'D20']) {
      expect(screen.getByRole('button', {
        name: `Add ${label} — your owned dice first, then unlimited basics`,
      })).toBeEnabled()
    }
  })

  it('shows no owned count on any quick slot', () => {
    addNamedDie('Starter D6', 'd6', 'common')
    addNamedDie('Spare D6', 'd6', 'common')

    renderToolbar()

    for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const) {
      const slot = screen.getByTestId(`dice-quick-slot-${type}`)
      // The face label and nothing else — no tally, and no ∞ standing in for
      // one. Owned supply is not a number the rail reports any more.
      expect(slot).toHaveTextContent(/^D(4|6|8|10|12|20)$/)
      expect(slot).not.toHaveAttribute('data-owned-available')
    }
  })

  it('offers every dice type even with a completely empty inventory', () => {
    const onAddDice = vi.fn()

    renderToolbar({ onAddDice })

    for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const) {
      expect(screen.getByTestId(`dice-quick-slot-${type}`)).toBeEnabled()
    }

    fireEvent.click(screen.getByTestId('dice-quick-slot-d20'))
    expect(onAddDice).toHaveBeenCalledWith('d20')
  })

  it('keeps a dice type spawnable when all owned dice of that type are on the table', () => {
    const ownedDie = addNamedDie('Only D6', 'd6', 'common')
    useMultiplayerStore.setState({
      localPlayerId: 'p1',
      dice: new Map([[
        'table-d6',
        makeMultiplayerDie({
          id: 'table-d6',
          presentation: { inventoryDieId: ownedDie.id },
        }),
      ]]),
    })
    const onAddDice = vi.fn()

    renderToolbar({ onAddDice })

    const d6Button = screen.getByTestId('dice-quick-slot-d6')
    expect(d6Button).toBeEnabled()

    // Beyond the owned dice the rail keeps spawning; the backend substitutes a
    // basic die rather than refusing.
    fireEvent.click(d6Button)
    expect(onAddDice).toHaveBeenCalledWith('d6')
  })

  it('drops a pending multiplayer favorite from the flyout until the server answers', () => {
    const favorite = addNamedDie('Lucky D6', 'd6', 'common', { isFavorite: true })
    addNamedDie('Backup D6', 'd6', 'common', { isFavorite: true })
    useMultiplayerStore.setState({ pendingInventoryDieIds: new Set([favorite.id]) })

    renderToolbar()

    fireEvent.click(screen.getByTestId('dice-quick-slot-favorites-d6'))

    // Offering an in-flight die would let the player spawn the same physical
    // die twice.
    expect(screen.queryByRole('button', { name: /add favorite lucky d6/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add favorite backup d6/i })).toBeInTheDocument()
  })

  it('drops a favorite already on the table from the flyout', () => {
    const onTable = addNamedDie('Table D6', 'd6', 'common', { isFavorite: true })
    addNamedDie('Bench D6', 'd6', 'common', { isFavorite: true })
    useMultiplayerStore.setState({
      localPlayerId: 'p1',
      dice: new Map([[
        'mp-d6',
        makeMultiplayerDie({
          id: 'mp-d6',
          presentation: { inventoryDieId: onTable.id },
        }),
      ]]),
    })

    renderToolbar()

    fireEvent.click(screen.getByTestId('dice-quick-slot-favorites-d6'))

    expect(screen.queryByRole('button', { name: /add favorite table d6/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add favorite bench d6/i })).toBeInTheDocument()
  })

  it('shows the favorites star on every slot, including types with no favorites', () => {
    addNamedDie('Lucky D20', 'd20', 'rare', { isFavorite: true })

    renderToolbar()

    for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const) {
      // A control that only appears once you already use the feature cannot
      // teach it, so the star is unconditional.
      expect(screen.getByTestId(`dice-quick-slot-favorites-${type}`)).toBeInTheDocument()
    }

    expect(screen.getByTestId('dice-quick-slot-favorites-d20'))
      .toHaveAttribute('data-has-favorites', 'true')
    expect(screen.getByTestId('dice-quick-slot-favorites-d4'))
      .toHaveAttribute('data-has-favorites', 'false')
  })

  it('opens a dismissable hint from a star with no favorites behind it', () => {
    const onAddDice = vi.fn()

    renderToolbar({ onAddDice })

    fireEvent.click(screen.getByTestId('dice-quick-slot-favorites-d8'))

    const hint = screen.getByTestId('favorite-dice-empty-hint')
    // Points at where favorites are made, rather than leaving a dead control.
    expect(hint).toHaveTextContent(/star dice in the inventory panel/i)
    expect(screen.queryByTestId('inventory-preview-canvas')).not.toBeInTheDocument()

    // A tap anywhere clears it — no aiming at a close button.
    fireEvent.click(screen.getByTestId('favorite-dice-hint-backdrop'))
    expect(screen.queryByTestId('favorite-dice-empty-hint')).not.toBeInTheDocument()
    // Dismissing is not spawning.
    expect(onAddDice).not.toHaveBeenCalled()
  })

  it('dismisses the empty-favorites hint when the hint itself is tapped', () => {
    renderToolbar()

    fireEvent.click(screen.getByTestId('dice-quick-slot-favorites-d8'))
    fireEvent.click(screen.getByTestId('favorite-dice-empty-hint'))

    expect(screen.queryByTestId('favorite-dice-empty-hint')).not.toBeInTheDocument()
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

  it('clears all table dice when the trash target is clicked directly', () => {
    addNamedDie('Starter D8', 'd8', 'common')
    const onClearAllDice = vi.fn()

    renderToolbar({ onClearAllDice })

    fireEvent.click(screen.getByRole('button', { name: /clear all dice/i }))

    expect(onClearAllDice).toHaveBeenCalledOnce()
  })

  it('keeps the trash target aligned in the rail for scene-level drag deletion', () => {
    addNamedDie('Starter D8', 'd8', 'common')

    renderToolbar()

    expect(screen.getByRole('button', { name: /clear all dice/i })).toHaveAttribute('id', 'trash-drop-zone')
  })
})
