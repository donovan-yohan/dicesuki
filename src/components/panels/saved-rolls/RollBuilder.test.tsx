import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INVENTORY_DIE_DRAG_TYPE, serializeInventoryDieDragPayload } from '../../../lib/inventoryDrag'
import {
  createAnonymousRollSource,
  createSpecificDieRollSource,
  getRollDiceCount,
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

/** Type into the quantity field and commit it the way a user would. */
function setQuantity(label: string, value: string) {
  const field = screen.getByLabelText(label)
  fireEvent.change(field, { target: { value } })
  fireEvent.blur(field)
  return field
}

/** A persisted roll holding one entry with the given sources. */
function rollWithSources(
  sources: SavedRoll['dice'][number]['sources'],
  overrides: Partial<SavedRoll['dice'][number]> = {},
): SavedRoll {
  return {
    id: 'roll-1',
    name: 'Persisted roll',
    createdAt: 0,
    flatBonus: 0,
    dice: [{ id: 'entry-1', type: 'd20', quantity: sources?.length ?? 1, perDieBonus: 0, sources, ...overrides }],
  }
}

type SavedRollDraft = Omit<SavedRoll, 'id' | 'createdAt'>

function renderBuilder(options: { initialRoll?: SavedRoll; tableDice?: TableDieSummary[] } = {}) {
  const onSave = vi.fn<(roll: SavedRollDraft) => void>()
  const onCancel = vi.fn()

  const { container } = render(<RollBuilder {...options} onSave={onSave} onCancel={onCancel} />)
  return { onSave, onCancel, container }
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

  it('commits an arbitrary dice count from the numeric quantity field', () => {
    // Arrange
    const { onSave } = renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))

    // Act
    setQuantity('D6 quantity', '5')

    // Assert — the formula reflects the typed count, not a preset bucket
    // (rendered twice: once on the entry card, once in the preview)
    expect(screen.getAllByText('5d6')).toHaveLength(2)

    fireEvent.change(screen.getByLabelText(/roll name/i), { target: { value: 'Five d6' } })
    fireEvent.click(screen.getByRole('button', { name: /save roll/i }))
    expect(onSave.mock.calls[0][0].dice[0].quantity).toBe(5)
  })

  it('commits the quantity on Enter without leaving the field', () => {
    // Arrange
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))
    const field = screen.getByLabelText('D6 quantity')

    // Act
    fireEvent.change(field, { target: { value: '7' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    // Assert
    expect(screen.getAllByText('7d6')).toHaveLength(2)
  })

  it('does not commit a multi-digit count until it is finished being typed', () => {
    // Arrange
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))
    const field = screen.getByLabelText('D6 quantity')

    // Act — keystrokes of "12": the intermediate "1" must not commit
    fireEvent.change(field, { target: { value: '1' } })
    fireEvent.change(field, { target: { value: '12' } })

    // Assert — still the committed value mid-typing
    expect(screen.getAllByText('1d6')).toHaveLength(2)

    fireEvent.blur(field)
    expect(screen.getAllByText('12d6')).toHaveLength(2)
  })

  it('keeps every owned die while a multi-digit count is typed', () => {
    // Arrange — one entry holding three specific owned dice
    const steel = addNamedDie('Steel d20', 'd20')
    const jade = addNamedDie('Jade d20', 'd20')
    const bone = addNamedDie('Bone d20', 'd20')
    const initialRoll = rollWithSources([
      createSpecificDieRollSource(steel.id),
      createSpecificDieRollSource(jade.id),
      createSpecificDieRollSource(bone.id),
    ])
    const { onSave } = renderBuilder({ initialRoll })
    const field = screen.getByLabelText('D20 quantity')

    // Act — typing "12" once passed through "1", truncating the entry to one die
    fireEvent.change(field, { target: { value: '1' } })
    fireEvent.change(field, { target: { value: '12' } })
    fireEvent.blur(field)

    // Assert — all three owned dice survive; the growth is generic
    fireEvent.click(screen.getByRole('button', { name: /update roll/i }))
    const saved = onSave.mock.calls[0][0]
    expect(saved.dice[0].quantity).toBe(12)
    expect(getSpecificDieIds(saved.dice[0])).toEqual([steel.id, jade.id, bone.id])
  })

  it('gives up generic dice before owned dice when the count shrinks', () => {
    // Arrange — 1 owned + 4 generic
    const steel = addNamedDie('Steel d20', 'd20')
    const initialRoll = rollWithSources(
      [createSpecificDieRollSource(steel.id), createAnonymousRollSource(4)],
      { quantity: 5 },
    )
    const { onSave } = renderBuilder({ initialRoll })

    // Act
    setQuantity('D20 quantity', '2')

    // Assert — the owned die survives; only the generics are given up, and the
    // notice says so rather than discarding three dice silently.
    fireEvent.click(screen.getByRole('button', { name: /update roll/i }))
    const saved = onSave.mock.calls[0][0]
    expect(saved.dice[0].sources).toEqual([
      createSpecificDieRollSource(steel.id),
      createAnonymousRollSource(1),
    ])
    const notice = screen.getByText(/Removed from this roll/i)
    expect(notice).toHaveTextContent('3 generic dice')
    expect(notice).not.toHaveTextContent('Steel d20')
  })

  it('names the owned dice a shrink had to remove', () => {
    // Arrange — two owned dice, no generics to give up
    const steel = addNamedDie('Steel d20', 'd20')
    const jade = addNamedDie('Jade d20', 'd20')
    const initialRoll = rollWithSources([
      createSpecificDieRollSource(steel.id),
      createSpecificDieRollSource(jade.id),
    ])
    renderBuilder({ initialRoll })

    // Act
    setQuantity('D20 quantity', '1')

    // Assert — destructive, so it is named rather than silent
    expect(screen.getByRole('status')).toHaveTextContent('Removed from this roll: Jade d20')
  })

  it('reverts to the last committed count when the field is blanked', () => {
    // Arrange
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /add 4 d6 dice/i }))

    // Act
    setQuantity('D6 quantity', '')

    // Assert — an unusable draft reverts, it does not reset the entry to 1
    expect(screen.getAllByText('4d6')).toHaveLength(2)
  })

  it('keeps the keep/drop policy when the rolled count is set by hand', () => {
    // Arrange — a keep-highest entry: roll 4, keep 2
    const initialRoll = rollWithSources([createAnonymousRollSource(4)], {
      quantity: 2,
      rollCount: 4,
      keepMode: 'highest',
    })
    const { onSave } = renderBuilder({ initialRoll })
    expect(screen.getAllByText('4d20 kh2').length).toBeGreaterThan(0)

    // Act — the quantity field edits the ROLLED count
    setQuantity('D20 quantity', '3')

    // Assert — keep/drop is editable in Advanced Options, so a count change
    // moves the rolled count instead of throwing the policy away
    expect(screen.getAllByText('3d20 kh2').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /update roll/i }))
    const saved = onSave.mock.calls[0][0]
    expect(saved.dice[0].rollCount).toBe(3)
    expect(saved.dice[0].quantity).toBe(2)
    expect(saved.dice[0].keepMode).toBe('highest')
    expect(getRollDiceCount(saved.dice)).toBe(3)
  })

  it('pulls the keep count down when the rolled count drops below it', () => {
    // Arrange — roll 4, keep 2
    const initialRoll = rollWithSources([createAnonymousRollSource(4)], {
      quantity: 2,
      rollCount: 4,
      keepMode: 'highest',
    })
    const { onSave } = renderBuilder({ initialRoll })

    // Act
    setQuantity('D20 quantity', '1')

    // Assert — an entry can never keep more dice than it rolls
    fireEvent.click(screen.getByRole('button', { name: /update roll/i }))
    const saved = onSave.mock.calls[0][0]
    expect(saved.dice[0].rollCount).toBe(1)
    expect(saved.dice[0].quantity).toBe(1)
  })

  it('keeps repeated increments as a single generic group', () => {
    // Arrange
    const { onSave } = renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))

    // Act — five presses of the entry's "+" control
    const increment = screen.getAllByRole('button', { name: '+' })[0]
    for (let i = 0; i < 5; i++) fireEvent.click(increment)

    // Assert — one chip and one source, not six of each
    expect(screen.getAllByText(/generic$/)).toHaveLength(1)
    expect(screen.getByText('6 generic')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/roll name/i), { target: { value: 'Six d6' } })
    fireEvent.click(screen.getByRole('button', { name: /save roll/i }))
    expect(onSave.mock.calls[0][0].dice[0].sources).toEqual([createAnonymousRollSource(6)])
  })

  it('caps the quantity field at three digits', () => {
    // Arrange
    renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))
    const field = screen.getByLabelText('D6 quantity')

    // Act — a long paste must not render absurd counts
    fireEvent.change(field, { target: { value: '12345678901234567890' } })

    // Assert
    expect(field).toHaveValue('123')
  })

  it('preserves a specific owned die when the quantity field grows the entry', () => {
    // Arrange
    const die = addNamedDie('Lucky D20', 'd20')
    const { onSave } = renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /add lucky d20 to roll/i }))

    // Act
    setQuantity('D20 quantity', '3')

    // Assert — the owned die survives; the extra two dice are generic
    expect(screen.getAllByText('3d20 [1 specific]')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText(/roll name/i), { target: { value: 'Grown' } })
    fireEvent.click(screen.getByRole('button', { name: /save roll/i }))
    const saved = onSave.mock.calls[0][0]
    expect(getSpecificDieIds(saved.dice[0])).toEqual([die.id])
    expect(saved.dice[0].sources).toEqual([
      createSpecificDieRollSource(die.id),
      createAnonymousRollSource(2),
    ])
  })

  it('blocks saving a roll over the room dice capacity and explains why', () => {
    // Arrange
    renderBuilder()
    fireEvent.change(screen.getByLabelText(/roll name/i), { target: { value: 'Too many dice' } })
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))

    // Act — one die past the 30-dice room cap
    setQuantity('D6 quantity', '31')

    // Assert
    const capacityError = screen.getByTestId('roll-capacity-error')
    expect(capacityError).toHaveTextContent('Rolls are limited to 30 dice')
    expect(capacityError).toHaveTextContent('This roll uses 31')
    expect(screen.getByRole('button', { name: /save roll/i })).toBeDisabled()
  })

  it('marks the offending quantity field invalid and describes the disabled save', () => {
    // Arrange
    renderBuilder()
    fireEvent.change(screen.getByLabelText(/roll name/i), { target: { value: 'Too many dice' } })
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))

    // Act
    const field = setQuantity('D6 quantity', '31')

    // Assert
    const capacityId = screen.getByTestId('roll-capacity-error').id
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAttribute('aria-describedby', capacityId)
    expect(screen.getByRole('button', { name: /save roll/i }))
      .toHaveAttribute('aria-describedby', capacityId)
  })

  it('announces the capacity breach politely, without the changing count', () => {
    // Arrange
    const { container } = renderBuilder()
    fireEvent.change(screen.getByLabelText(/roll name/i), { target: { value: 'Too many dice' } })
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))

    // Act
    setQuantity('D6 quantity', '31')

    // Assert — polite (never role=alert), and the per-keystroke count stays out
    const live = container.querySelector('[aria-live="polite"]')!
    expect(live).toHaveTextContent('Rolls are limited to 30 dice')
    expect(live).not.toHaveTextContent('31')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('allows saving a roll at exactly the room dice capacity', () => {
    // Arrange
    const { onSave } = renderBuilder()
    fireEvent.change(screen.getByLabelText(/roll name/i), { target: { value: 'Exactly thirty' } })
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))

    // Act
    setQuantity('D6 quantity', '30')

    // Assert
    expect(screen.queryByTestId('roll-capacity-error')).not.toBeInTheDocument()
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
    setQuantity('D6 quantity', '20')
    setQuantity('D20 quantity', '11')

    // Assert
    expect(screen.getByTestId('roll-capacity-error')).toHaveTextContent('This roll uses 31')
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

  it('shows a closed range for a roll that cannot exceed its dice', () => {
    // Arrange
    renderBuilder({ initialRoll: rollWithSources([createAnonymousRollSource(1)]) })

    // Assert
    expect(screen.getByText('Range: 1 - 20')).toBeInTheDocument()
  })

  it('marks an exploding roll as open-ended at the top of its range', () => {
    // Arrange — 1d20 that explodes on its maximum face
    renderBuilder({
      initialRoll: rollWithSources([createAnonymousRollSource(1)], { exploding: { on: 'max' } }),
    })

    // Assert — the maximum is a floor for the chain, not a ceiling
    expect(screen.getByText('Range: 1 - 20+')).toBeInTheDocument()
    expect(screen.queryByText('Range: 1 - 20')).not.toBeInTheDocument()
  })

  it('names the owned dice a quick preset had to remove', () => {
    // Arrange — three owned d20s, no generics to give up
    const steel = addNamedDie('Steel d20', 'd20')
    const jade = addNamedDie('Jade d20', 'd20')
    const bone = addNamedDie('Bone d20', 'd20')
    renderBuilder({
      initialRoll: rollWithSources([
        createSpecificDieRollSource(steel.id),
        createSpecificDieRollSource(jade.id),
        createSpecificDieRollSource(bone.id),
      ]),
    })
    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))

    // Act — advantage rolls two dice, so the entry has to shed the third
    fireEvent.click(screen.getByRole('button', { name: 'Apply Advantage to D20' }))

    // Assert — a preset is as destructive as a hand-typed shrink, and says so
    expect(screen.getByRole('status')).toHaveTextContent('Removed from this roll: Bone d20')
  })

  it('blocks a roll that mixes counting successes with adding dice up', () => {
    // Arrange — a d6 pool and a d20 that sums
    renderBuilder()
    fireEvent.change(screen.getByLabelText(/roll name/i), { target: { value: 'Mixed modes' } })
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))
    fireEvent.click(screen.getByRole('button', { name: /add 1 d20 die/i }))
    const advancedToggles = screen.getAllByRole('button', { name: /advanced options/i })
    fireEvent.click(advancedToggles[0])
    fireEvent.click(advancedToggles[1])

    // Act — only the d6 counts successes
    fireEvent.click(screen.getByLabelText('Count D6 successes'))

    // Assert — the whole roll would silently become a success count
    const error = screen.getByTestId('roll-success-mode-error')
    expect(error).toHaveTextContent(/no single total/i)
    expect(error).toHaveTextContent(/every entry, or on none of them/i)
    expect(screen.getByRole('button', { name: /save roll/i })).toBeDisabled()
    expect(screen.getByLabelText('Count D20 successes')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Count D20 successes'))
      .toHaveAttribute('aria-describedby', error.id)

    // Act — make the roll consistent
    fireEvent.click(screen.getByLabelText('Count D20 successes'))

    // Assert
    expect(screen.queryByTestId('roll-success-mode-error')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save roll/i })).toBeEnabled()
    expect(screen.getByLabelText('Count D20 successes')).not.toHaveAttribute('aria-invalid')
  })

  it('saves a roll where every entry counts successes', () => {
    // Arrange
    const { onSave } = renderBuilder()
    fireEvent.change(screen.getByLabelText(/roll name/i), { target: { value: 'Dice pool' } })
    fireEvent.click(screen.getByRole('button', { name: /add 1 d6 die/i }))
    fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))

    // Act
    fireEvent.click(screen.getByLabelText('Count D6 successes'))
    fireEvent.click(screen.getByRole('button', { name: /save roll/i }))

    // Assert — one entry counting successes is coherent on its own
    expect(screen.queryByTestId('roll-success-mode-error')).not.toBeInTheDocument()
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0][0].dice[0].countSuccesses).toEqual({ targetNumber: 5 })
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
