import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BottomSheet } from '../BottomSheet'
import { DiceEntryCard } from './DiceEntryCard'
import { createAnonymousRollSource } from '../../../lib/rollSources'
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
