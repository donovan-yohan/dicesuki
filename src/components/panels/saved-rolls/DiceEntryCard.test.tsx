import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BottomSheet } from '../BottomSheet'
import { DiceEntryCard } from './DiceEntryCard'
import { createAnonymousRollSource, getDiceEntrySourceQuantity } from '../../../lib/rollSources'
import type { DiceEntry } from '../../../types/savedRolls'

function makeEntry(overrides: Partial<DiceEntry> = {}): DiceEntry {
  return {
    id: 'entry-1',
    type: 'd6',
    quantity: 4,
    perDieBonus: 0,
    sources: [createAnonymousRollSource(4)],
    ...overrides,
  }
}

/**
 * Mount the card where it actually lives — inside the sheet, which closes
 * itself on a document-level Escape listener.
 */
function renderInSheet(entry = makeEntry()) {
  const onClose = vi.fn()
  const onUpdate = vi.fn()

  render(
    <BottomSheet isOpen onClose={onClose} title="My Dice Rolls">
      <DiceEntryCard entry={entry} onUpdate={onUpdate} onRemove={vi.fn()} />
    </BottomSheet>,
  )

  return { onClose, onUpdate, field: screen.getByLabelText('D6 quantity') }
}

/**
 * Mount the card the way the builder does — controlled, so an edit feeds back
 * in as the next `entry` prop and the card's own display updates with it.
 * Advanced Options starts expanded because every mechanics control lives there.
 */
function renderAdvanced(entry = makeEntry()) {
  const updates: DiceEntry[] = []

  function Harness() {
    const [current, setCurrent] = useState(entry)
    return (
      <DiceEntryCard
        entry={current}
        onUpdate={(next) => {
          updates.push(next)
          setCurrent(next)
        }}
        onRemove={vi.fn()}
      />
    )
  }

  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: /advanced options/i }))

  return { updates, latest: () => updates[updates.length - 1] }
}

/** A d20 entry that rolls a single die, the shape presets act on. */
function d20Entry(overrides: Partial<DiceEntry> = {}): DiceEntry {
  return makeEntry({
    type: 'd20',
    quantity: 1,
    sources: [createAnonymousRollSource(1)],
    ...overrides,
  })
}

describe('DiceEntryCard quantity field inside the sheet', () => {
  it('abandons the draft on Escape without closing the sheet', () => {
    // Arrange
    const { onClose, onUpdate, field } = renderInSheet()
    fireEvent.change(field, { target: { value: '12' } })
    expect(field).toHaveValue('12')

    // Act
    fireEvent.keyDown(field, { key: 'Escape' })

    // Assert — the draft is abandoned, the session survives
    expect(field).toHaveValue('4')
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'My Dice Rolls' })).toBeInTheDocument()
  })

  it('lets Escape close the sheet once there is no draft to abandon', () => {
    // Arrange
    const { onClose, field } = renderInSheet()
    fireEvent.change(field, { target: { value: '12' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    // Act — a second Escape has no draft to swallow it
    fireEvent.keyDown(field, { key: 'Escape' })

    // Assert
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('lets Escape close the sheet when the field was never touched', () => {
    // Arrange
    const { onClose, field } = renderInSheet()

    // Act
    fireEvent.keyDown(field, { key: 'Escape' })

    // Assert
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('DiceEntryCard quick presets', () => {
  it('turns a d20 into advantage: roll two, keep the best one', () => {
    // Arrange
    const { latest } = renderAdvanced(d20Entry())

    // Act
    fireEvent.click(screen.getByLabelText('Apply Advantage to D20'))

    // Assert — keep, roll and sources all agree, and the formula says so
    const entry = latest()
    expect(entry.rollCount).toBe(2)
    expect(entry.quantity).toBe(1)
    expect(entry.keepMode).toBe('highest')
    expect(getDiceEntrySourceQuantity(entry)).toBe(2)
    expect(screen.getByText('2d20 kh1')).toBeInTheDocument()
  })

  it('turns a d20 into disadvantage, keeping the worst of two', () => {
    // Arrange
    const { latest } = renderAdvanced(d20Entry())

    // Act
    fireEvent.click(screen.getByLabelText('Apply Disadvantage to D20'))

    // Assert
    expect(latest()).toMatchObject({ rollCount: 2, quantity: 1, keepMode: 'lowest' })
    expect(getDiceEntrySourceQuantity(latest())).toBe(2)
    expect(screen.getByText('2d20 kl1')).toBeInTheDocument()
  })

  it('rolls three dice for Elven Accuracy and keeps one', () => {
    // Arrange
    const { latest } = renderAdvanced(d20Entry())

    // Act
    fireEvent.click(screen.getByLabelText('Apply Elven Accuracy to D20'))

    // Assert
    expect(latest()).toMatchObject({ rollCount: 3, quantity: 1, keepMode: 'highest' })
    expect(getDiceEntrySourceQuantity(latest())).toBe(3)
  })

  it('applies Great Weapon Fighting without changing how many dice are rolled', () => {
    // Arrange — 2d6 of greatsword damage
    const { latest } = renderAdvanced(makeEntry({
      quantity: 2,
      sources: [createAnonymousRollSource(2)],
    }))

    // Act
    fireEvent.click(screen.getByLabelText('Apply Great Weapon Fighting to D6'))

    // Assert — a reroll-only preset must not touch the rolled count
    const entry = latest()
    expect(entry.reroll).toEqual({ condition: 'lessOrEqual', value: 2, maxRerolls: 1 })
    expect(entry.rollCount).toBeUndefined()
    expect(entry.quantity).toBe(2)
    expect(getDiceEntrySourceQuantity(entry)).toBe(2)
    expect(screen.getByText('2d6 r≤2')).toBeInTheDocument()
  })

  it('applies Halfling Luck as a reroll of ones only', () => {
    // Arrange
    const { latest } = renderAdvanced(d20Entry())

    // Act
    fireEvent.click(screen.getByLabelText('Apply Halfling Luck to D20'))

    // Assert
    expect(latest().reroll).toEqual({ condition: 'equals', value: 1, maxRerolls: 1 })
    expect(getDiceEntrySourceQuantity(latest())).toBe(1)
  })
})

describe('DiceEntryCard mechanics badges', () => {
  it('renders no badges for a plain entry and adds one live', () => {
    // Arrange
    renderAdvanced(d20Entry())
    expect(screen.queryByText('⬆️ ADV')).not.toBeInTheDocument()

    // Act
    fireEvent.click(screen.getByLabelText('Apply Advantage to D20'))

    // Assert
    expect(screen.getByText('⬆️ ADV')).toBeInTheDocument()

    // Act — a second mechanic stacks alongside the first
    fireEvent.click(screen.getByLabelText('Exploding D20 dice'))

    // Assert
    expect(screen.getByText('⬆️ ADV')).toBeInTheDocument()
    expect(screen.getByText('💥 Explode')).toBeInTheDocument()
  })
})

describe('DiceEntryCard keep / drop', () => {
  it('keeps one fewer die than it rolls and says so in plain language', () => {
    // Arrange
    const { latest } = renderAdvanced()

    // Act
    fireEvent.click(screen.getByLabelText('Keep only some D6 dice'))

    // Assert — the rolled count is untouched; only the keep count moves
    expect(latest()).toMatchObject({ rollCount: 4, quantity: 3, keepMode: 'highest' })
    expect(getDiceEntrySourceQuantity(latest())).toBe(4)
    expect(screen.getByText('Roll 4, keep best 3')).toBeInTheDocument()
  })

  it('switches to keeping the worst dice and to a smaller keep count', () => {
    // Arrange
    const { latest } = renderAdvanced()
    fireEvent.click(screen.getByLabelText('Keep only some D6 dice'))

    // Act
    fireEvent.change(screen.getByLabelText('D6 keep mode'), { target: { value: 'lowest' } })
    fireEvent.change(screen.getByLabelText('D6 dice to keep'), { target: { value: '2' } })

    // Assert
    expect(latest()).toMatchObject({ rollCount: 4, quantity: 2, keepMode: 'lowest' })
    expect(screen.getByText('Roll 4, keep worst 2')).toBeInTheDocument()
    expect(screen.getByText('4d6 kl2')).toBeInTheDocument()
  })

  it('never lets the keep count outrank the rolled count', () => {
    // Arrange
    const { latest } = renderAdvanced()
    fireEvent.click(screen.getByLabelText('Keep only some D6 dice'))

    // Act — ask to keep more dice than the entry rolls
    fireEvent.change(screen.getByLabelText('D6 dice to keep'), { target: { value: '9' } })

    // Assert
    expect(latest().quantity).toBe(4)
    expect(latest().rollCount).toBe(4)
  })

  it('drops the policy and scores every die again when switched off', () => {
    // Arrange
    const { latest } = renderAdvanced()
    fireEvent.click(screen.getByLabelText('Keep only some D6 dice'))

    // Act
    fireEvent.click(screen.getByLabelText('Keep only some D6 dice'))

    // Assert
    expect(latest().rollCount).toBeUndefined()
    expect(latest().keepMode).toBeUndefined()
    expect(latest().quantity).toBe(4)
    expect(screen.getByText('4d6')).toBeInTheDocument()
  })

  it('preserves keep / drop when the rolled count is typed by hand', () => {
    // Arrange — roll 4, keep the worst 2
    const { latest } = renderAdvanced(makeEntry({
      quantity: 2,
      rollCount: 4,
      keepMode: 'lowest',
      sources: [createAnonymousRollSource(4)],
    }))
    const field = screen.getByLabelText('D6 quantity')

    // Act — the main field is the ROLLED count
    fireEvent.change(field, { target: { value: '5' } })
    fireEvent.blur(field)

    // Assert
    expect(latest()).toMatchObject({ rollCount: 5, quantity: 2, keepMode: 'lowest' })
    expect(getDiceEntrySourceQuantity(latest())).toBe(5)

    // Act — shrinking past the keep count pulls the keep count down with it
    fireEvent.change(screen.getByLabelText('D6 quantity'), { target: { value: '1' } })
    fireEvent.blur(screen.getByLabelText('D6 quantity'))

    // Assert
    expect(latest()).toMatchObject({ rollCount: 1, quantity: 1, keepMode: 'lowest' })
  })
})

describe('DiceEntryCard exploding dice', () => {
  it('explodes on the die maximum by default, stored as "max"', () => {
    // Arrange
    const { latest } = renderAdvanced()

    // Act
    fireEvent.click(screen.getByLabelText('Exploding D6 dice'))

    // Assert
    expect(latest().exploding).toEqual({ on: 'max' })
    expect(screen.getByLabelText('D6 explodes on')).toHaveValue(6)
    expect(screen.getByText('4d6!')).toBeInTheDocument()
  })

  it('stores a lower trigger as a number and the maximum as "max" again', () => {
    // Arrange
    const { latest } = renderAdvanced()
    fireEvent.click(screen.getByLabelText('Exploding D6 dice'))

    // Act
    fireEvent.change(screen.getByLabelText('D6 explodes on'), { target: { value: '5' } })

    // Assert
    expect(latest().exploding).toEqual({ on: 5 })
    expect(screen.getByText('4d6!5')).toBeInTheDocument()

    // Act — back up to the die's own maximum
    fireEvent.change(screen.getByLabelText('D6 explodes on'), { target: { value: '6' } })

    // Assert
    expect(latest().exploding).toEqual({ on: 'max' })
  })

  it('names the wave cap so the limit is never a silent surprise', () => {
    // Arrange
    renderAdvanced()

    // Assert
    expect(screen.getByText(/up to 3 extra waves/i)).toBeInTheDocument()
  })

  it('clears the configuration when switched off', () => {
    // Arrange
    const { latest } = renderAdvanced()
    fireEvent.click(screen.getByLabelText('Exploding D6 dice'))

    // Act
    fireEvent.click(screen.getByLabelText('Exploding D6 dice'))

    // Assert
    expect(latest().exploding).toBeUndefined()
    expect(screen.queryByLabelText('D6 explodes on')).not.toBeInTheDocument()
  })
})

describe('DiceEntryCard reroll', () => {
  it('rerolls ones once by default and takes an editable threshold', () => {
    // Arrange
    const { latest } = renderAdvanced()

    // Act
    fireEvent.click(screen.getByLabelText('Reroll low D6 dice'))

    // Assert
    expect(latest().reroll).toEqual({ condition: 'lessOrEqual', value: 1, maxRerolls: 1 })

    // Act
    fireEvent.change(screen.getByLabelText('D6 reroll at or below'), { target: { value: '2' } })

    // Assert — still once only; the physical table cannot reroll forever
    expect(latest().reroll).toEqual({ condition: 'lessOrEqual', value: 2, maxRerolls: 1 })
    expect(screen.getByText('4d6 r≤2')).toBeInTheDocument()
  })
})

describe('DiceEntryCard min / max clamps', () => {
  it('sets both clamps and clears one back to no limit', () => {
    // Arrange
    const { latest } = renderAdvanced()

    // Act
    fireEvent.change(screen.getByLabelText('D6 minimum value'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('D6 maximum value'), { target: { value: '5' } })

    // Assert
    expect(latest()).toMatchObject({ minimum: 3, maximum: 5 })
    expect(screen.getByText('🎯 Limits')).toBeInTheDocument()

    // Act — an empty field means "no limit", not zero
    fireEvent.change(screen.getByLabelText('D6 minimum value'), { target: { value: '' } })

    // Assert
    expect(latest().minimum).toBeUndefined()
    expect(latest().maximum).toBe(5)
    expect(screen.getByLabelText('D6 minimum value')).toHaveValue(null)
  })

  it('refuses to let the minimum climb past the maximum', () => {
    // Arrange
    const { latest } = renderAdvanced()
    fireEvent.change(screen.getByLabelText('D6 maximum value'), { target: { value: '4' } })

    // Act
    fireEvent.change(screen.getByLabelText('D6 minimum value'), { target: { value: '6' } })

    // Assert
    expect(latest()).toMatchObject({ minimum: 4, maximum: 4 })
  })
})

describe('DiceEntryCard success counting', () => {
  it('counts successes at an editable target', () => {
    // Arrange
    const { latest } = renderAdvanced(makeEntry({
      quantity: 5,
      sources: [createAnonymousRollSource(5)],
    }))

    // Act
    fireEvent.click(screen.getByLabelText('Count D6 successes'))

    // Assert — one below the die maximum is the usual dice-pool target
    expect(latest().countSuccesses).toEqual({ targetNumber: 5 })

    // Act
    fireEvent.change(screen.getByLabelText('D6 success on or above'), { target: { value: '4' } })

    // Assert
    expect(latest().countSuccesses).toEqual({ targetNumber: 4 })
    expect(screen.getByText('5d6 ≥4')).toBeInTheDocument()
    expect(screen.getByText('✓4+')).toBeInTheDocument()
  })

  it('says that successes are counted and the flat bonus ignored', () => {
    // Arrange
    renderAdvanced()

    // Assert
    expect(screen.getByText(/counted, not summed/i)).toBeInTheDocument()
    expect(screen.getByText(/flat bonus is ignored/i)).toBeInTheDocument()
  })
})
