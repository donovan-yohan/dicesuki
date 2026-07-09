import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '../../contexts/ThemeContext'
import { useInventoryStore } from '../../store/useInventoryStore'
import type { DiceShape } from '../../types/diceShape'
import type { DieRarity, NewInventoryDie } from '../../types/inventory'
import { defaultTheme } from '../../themes/tokens'
import { InventoryPanel } from './InventoryPanel'

vi.mock('./BottomSheet', () => ({
  BottomSheet: ({ isOpen, children, title }: { isOpen: boolean; children: ReactNode; title: string }) => (
    isOpen ? <section aria-label={title}>{children}</section> : null
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

function renderInventory(onSpawnDie = vi.fn()) {
  return render(
    <ThemeContext.Provider
      value={{
        currentTheme: defaultTheme,
        setTheme: vi.fn(),
        availableThemes: [defaultTheme],
        ownedThemes: [defaultTheme.id],
        purchaseTheme: vi.fn(async () => true),
      }}
    >
      <InventoryPanel isOpen onClose={vi.fn()} onSpawnDie={onSpawnDie} />
    </ThemeContext.Provider>
  )
}

function addNamedDie(
  name: string,
  type: DiceShape,
  rarity: DieRarity,
  setId: string,
  extra: Partial<NewInventoryDie> = {}
) {
  return useInventoryStore.getState().addDie(makeDie({
    name,
    type,
    rarity,
    setId,
    ...extra,
  }))
}

describe('InventoryPanel', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useInventoryStore.getState().reset()
  })

  it('filters owned dice by shape, rarity, set, tag, status, and search', () => {
    addNamedDie('Lucky Devil D6', 'd6', 'rare', 'starter-devil', {
      isFavorite: true,
      tags: ['fire', 'starter'],
      recentRollValues: [6],
    })
    addNamedDie('Quiet Jade D20', 'd20', 'epic', 'jade-court', {
      tags: ['focus'],
    })
    addNamedDie('Pocket Bone D4', 'd4', 'common', 'bone-yard', {
      tags: ['travel'],
    })

    renderInventory()

    expect(screen.getByText('Showing 3 of 3 dice')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/filter by shape/i), { target: { value: 'd20' } })
    expect(screen.getByText('Quiet Jade D20')).toBeInTheDocument()
    expect(screen.queryByText('Lucky Devil D6')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/filter by shape/i), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText(/filter by rarity/i), { target: { value: 'rare' } })
    expect(screen.getByText('Lucky Devil D6')).toBeInTheDocument()
    expect(screen.queryByText('Quiet Jade D20')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/filter by rarity/i), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText(/filter by set/i), { target: { value: 'bone-yard' } })
    expect(screen.getByText('Pocket Bone D4')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }))
    fireEvent.change(screen.getByLabelText(/filter by tag/i), { target: { value: 'fire' } })
    expect(screen.getByText('Lucky Devil D6')).toBeInTheDocument()
    expect(screen.queryByText('Pocket Bone D4')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /recent/i }))
    expect(screen.getByText('Lucky Devil D6')).toBeInTheDocument()
    expect(screen.queryByText('Quiet Jade D20')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText(/name, set, tag, or id/i), { target: { value: 'missing' } })
    expect(screen.getByText('No Matching Dice')).toBeInTheDocument()
  })

  it('spawns the specific inventory die id selected from the grid', () => {
    const onSpawnDie = vi.fn()
    const die = addNamedDie('Lucky Devil D6', 'd6', 'rare', 'starter-devil')

    renderInventory(onSpawnDie)

    fireEvent.click(screen.getByRole('button', { name: /add lucky devil d6 to table/i }))

    expect(onSpawnDie).toHaveBeenCalledWith('d6', die.id)
  })

  it('only mounts previews for the visible dice window until more are requested', () => {
    for (let index = 0; index < 30; index += 1) {
      addNamedDie(`Batch Die ${index}`, 'd6', 'common', 'batch-set', {
        acquiredAt: Date.now() - index,
      })
    }

    renderInventory()

    expect(screen.getAllByTestId('dice-preview')).toHaveLength(24)
    expect(screen.getByText('Showing 24 of 30 dice')).toBeInTheDocument()
    expect(screen.queryByText('Batch Die 29')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /show 6 more/i }))

    expect(screen.getAllByTestId('dice-preview')).toHaveLength(30)
    expect(screen.getByText('Showing 30 of 30 dice')).toBeInTheDocument()
    expect(screen.getByText('Batch Die 29')).toBeInTheDocument()
  })
})
