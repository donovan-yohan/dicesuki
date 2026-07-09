import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INVENTORY_DIE_DRAG_TYPE, serializeInventoryDieDragPayload } from '../../../lib/inventoryDrag'
import {
  createAnonymousRollSource,
  getSpecificDieIds,
} from '../../../lib/rollSources'
import { useInventoryStore } from '../../../store/useInventoryStore'
import type { DiceShape } from '../../../types/diceShape'
import type { NewInventoryDie } from '../../../types/inventory'
import type { SavedRoll } from '../../../types/savedRolls'
import type { TableDieSummary } from '../../../types/tableDice'
import { RollBuilder } from './RollBuilder'

const makeDie = (overrides: Partial<NewInventoryDie> = {}): NewInventoryDie => ({
  type: 'd20',
  setId: 'starter-devil',
  rarity: 'rare',
  appearance: {
    baseColor: '#b91c1c',
    accentColor: '#ffffff',
    material: 'plastic',
  },
  vfx: {},
  name: 'Lucky D20',
  isFavorite: false,
  isLocked: false,
  tags: [],
  source: 'starter',
  assignedToRolls: [],
  ...overrides,
})

function addNamedDie(name: string, type: DiceShape) {
  return useInventoryStore.getState().addDie(makeDie({ name, type }))
}

function makeDataTransfer(payload: string) {
  return {
    dropEffect: 'none',
    getData: vi.fn((type: string) => type === INVENTORY_DIE_DRAG_TYPE ? payload : ''),
    setData: vi.fn(),
  } as unknown as DataTransfer
}

type SavedRollDraft = Omit<SavedRoll, 'id' | 'createdAt'>

function renderBuilder(options: { initialRoll?: SavedRoll; tableDice?: TableDieSummary[] } = {}) {
  const onSave = vi.fn<(roll: SavedRollDraft) => void>()
  const onCancel = vi.fn()

  render(<RollBuilder {...options} onSave={onSave} onCancel={onCancel} />)
  return { onSave, onCancel }
}

describe('RollBuilder', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useInventoryStore.getState().reset()
  })

  it('saves a readable recipe with bulk generic dice and a specific owned die', () => {
    const die = addNamedDie('Lucky D20', 'd20')
    const { onSave } = renderBuilder()

    fireEvent.change(screen.getByPlaceholderText(/roll name/i), {
      target: { value: 'Fireball plus lucky strike' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add 4 d6 dice/i }))
    fireEvent.click(screen.getByRole('button', { name: /add lucky d20 to roll/i }))

    expect(screen.getByText('4d6 + 1d20 [1 specific]')).toBeInTheDocument()
    expect(screen.getAllByText('Lucky D20').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /save roll/i }))

    expect(onSave).toHaveBeenCalledOnce()
    const saved = onSave.mock.calls[0][0]
    expect(saved.name).toBe('Fireball plus lucky strike')
    expect(saved.dice[0].sources).toEqual([createAnonymousRollSource(4)])
    expect(getSpecificDieIds(saved.dice[1])).toEqual([die.id])
  })

  it('accepts an inventory die dropped onto the owned dice builder zone', () => {
    const die = addNamedDie('Jade D8', 'd8')
    const { onSave } = renderBuilder()

    fireEvent.drop(screen.getByTestId('roll-builder-owned-drop-zone'), {
      dataTransfer: makeDataTransfer(serializeInventoryDieDragPayload({
        inventoryDieId: die.id,
        type: 'd8',
        name: 'Jade D8',
      })),
    })
    fireEvent.change(screen.getByPlaceholderText(/roll name/i), {
      target: { value: 'Jade opener' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save roll/i }))

    const saved = onSave.mock.calls[0][0]
    expect(saved.dice).toHaveLength(1)
    expect(saved.dice[0].type).toBe('d8')
    expect(getSpecificDieIds(saved.dice[0])).toEqual([die.id])
  })

  it('imports current table dice as grouped generic dice plus specific owned dice', () => {
    const die = addNamedDie('Lucky D20', 'd20')
    const { onSave } = renderBuilder({
      tableDice: [
        { id: 'generic-d6-a', type: 'd6' },
        { id: 'generic-d6-b', type: 'd6' },
        { id: 'owned-d20', type: 'd20', inventoryDieId: die.id, displayName: die.name },
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: /add table/i }))
    fireEvent.change(screen.getByPlaceholderText(/roll name/i), {
      target: { value: 'Table recipe' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save roll/i }))

    const saved = onSave.mock.calls[0][0]
    expect(saved.dice).toHaveLength(2)
    expect(saved.dice[0].sources).toEqual([createAnonymousRollSource(2)])
    expect(getSpecificDieIds(saved.dice[1])).toEqual([die.id])
  })
})
