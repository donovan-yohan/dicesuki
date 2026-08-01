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

    fireEvent.change(screen.getByLabelText(/roll name/i), {
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
    fireEvent.change(screen.getByLabelText(/roll name/i), {
      target: { value: 'Jade opener' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save roll/i }))

    const saved = onSave.mock.calls[0][0]
    expect(saved.dice).toHaveLength(1)
    expect(saved.dice[0].type).toBe('d8')
    expect(getSpecificDieIds(saved.dice[0])).toEqual([die.id])
  })

  it('sets an arbitrary dice count from the numeric quantity field', () => {
    // Arrange
    const { onSave } = renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))

    // Act
    fireEvent.change(screen.getByLabelText('D6 quantity'), { target: { value: '5' } })

    // Assert — the formula reflects the typed count, not a preset bucket
    // (rendered twice: once on the entry card, once in the preview)
    expect(screen.getAllByText('5d6')).toHaveLength(2)

    fireEvent.change(screen.getByLabelText(/roll name/i), { target: { value: 'Five d6' } })
    fireEvent.click(screen.getByRole('button', { name: /save roll/i }))
    expect(onSave.mock.calls[0][0].dice[0].quantity).toBe(5)
  })

  it('clamps a blanked quantity field back to one die on blur', () => {
    // Arrange
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /add 4 d6 dice/i }))
    const quantityField = screen.getByLabelText('D6 quantity')

    // Act
    fireEvent.change(quantityField, { target: { value: '' } })
    fireEvent.blur(quantityField)

    // Assert
    expect(screen.getAllByText('1d6')).toHaveLength(2)
  })

  it('preserves a specific owned die when the quantity field grows the entry', () => {
    // Arrange
    const die = addNamedDie('Lucky D20', 'd20')
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /add lucky d20 to roll/i }))

    // Act
    fireEvent.change(screen.getByLabelText('D20 quantity'), { target: { value: '3' } })

    // Assert — the owned die survives; the extra two dice are generic
    expect(screen.getAllByText('3d20 [1 specific]')).toHaveLength(2)
    expect(die.id).toBeTruthy()
  })

  it('blocks saving a roll over the room dice capacity and explains why', () => {
    // Arrange
    renderBuilder()
    fireEvent.change(screen.getByLabelText(/roll name/i), { target: { value: 'Too many dice' } })
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))

    // Act — one die past the 30-dice room cap
    fireEvent.change(screen.getByLabelText('D6 quantity'), { target: { value: '31' } })

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('Rolls are limited to 30 dice')
    expect(screen.getByRole('alert')).toHaveTextContent('This roll uses 31')
    expect(screen.getByRole('button', { name: /save roll/i })).toBeDisabled()
  })

  it('allows saving a roll at exactly the room dice capacity', () => {
    // Arrange
    const { onSave } = renderBuilder()
    fireEvent.change(screen.getByLabelText(/roll name/i), { target: { value: 'Exactly thirty' } })
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))

    // Act
    fireEvent.change(screen.getByLabelText('D6 quantity'), { target: { value: '30' } })

    // Assert
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /save roll/i }))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('counts dice across every entry when enforcing the capacity', () => {
    // Arrange
    renderBuilder()
    fireEvent.change(screen.getByLabelText(/roll name/i), { target: { value: 'Split over cap' } })
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))
    fireEvent.click(screen.getByRole('button', { name: /add 1 d20 die/i }))

    // Act — 20 + 11 = 31 across two entries
    fireEvent.change(screen.getByLabelText('D6 quantity'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('D20 quantity'), { target: { value: '11' } })

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('This roll uses 31')
    expect(screen.getByRole('button', { name: /save roll/i })).toBeDisabled()
  })

  it('shows inline field errors instead of an alert() when requirements are unmet', () => {
    // Arrange
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    renderBuilder()

    // Act — engaging the name field surfaces both outstanding requirements
    fireEvent.blur(screen.getByLabelText(/roll name/i))

    // Assert
    const nameField = screen.getByLabelText(/roll name/i)
    expect(nameField).toHaveAttribute('aria-invalid', 'true')
    expect(nameField).toHaveAccessibleDescription('Roll name is required')
    expect(screen.getByText(/add at least one die/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save roll/i })).toBeDisabled()
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
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
    fireEvent.change(screen.getByLabelText(/roll name/i), {
      target: { value: 'Table recipe' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save roll/i }))

    const saved = onSave.mock.calls[0][0]
    expect(saved.dice).toHaveLength(2)
    expect(saved.dice[0].sources).toEqual([createAnonymousRollSource(2)])
    expect(getSpecificDieIds(saved.dice[1])).toEqual([die.id])
  })
})
