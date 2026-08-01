import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RollDicePicker } from './RollDicePicker'
import {
  createAnonymousRollSource,
  createSpecificDieRollSource,
  getSpecificDieIds,
  withRollSources,
} from '../../../lib/rollSources'
import type { DiceEntry } from '../../../types/savedRolls'
import type { InventoryDie } from '../../../types/inventory'

function makeDie(overrides: Partial<InventoryDie> = {}): InventoryDie {
  return {
    id: 'die-a',
    type: 'd20',
    setId: 'starter',
    rarity: 'rare',
    appearance: { baseColor: '#b91c1c', accentColor: '#ffffff', material: 'plastic' },
    vfx: {},
    name: 'Lucky D20',
    isFavorite: false,
    isLocked: false,
    tags: [],
    source: 'starter',
    assignedToRolls: [],
    acquiredAt: 1,
    stats: { timesRolled: 0, totalValue: 0, critsRolled: 0, failsRolled: 0 },
    ...overrides,
  } as InventoryDie
}

function makeEntry(sources = [createAnonymousRollSource(2)]): DiceEntry {
  return withRollSources({ id: 'entry-1', type: 'd20', quantity: 2, perDieBonus: 0 }, sources)
}

function renderPicker(options: {
  entry?: DiceEntry
  ownedDice?: InventoryDie[]
  pinnedElsewhere?: Set<string>
} = {}) {
  const onChange = vi.fn<(entry: DiceEntry) => void>()
  const onClose = vi.fn()
  const view = render(
    <RollDicePicker
      entry={options.entry ?? makeEntry()}
      entryLabel="2d20"
      ownedDice={options.ownedDice ?? [makeDie()]}
      pinnedElsewhere={options.pinnedElsewhere}
      onChange={onChange}
      onClose={onClose}
    />,
  )
  return { onChange, onClose, ...view }
}

describe('RollDicePicker', () => {
  it('is an accessible modal dialog naming the entry it composes', () => {
    renderPicker()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('heading', { name: 'Choose D20 dice' })).toBeInTheDocument()
    expect(within(dialog).getByTestId('roll-dice-picker-summary')).toHaveTextContent(
      '2d20 — 0 pinned, 2 auto',
    )
  })

  it('moves focus into the dialog and returns it to the opener on close', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    const { unmount } = renderPicker()
    await waitFor(() => {
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    })

    unmount()

    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('wraps Tab inside the dialog instead of leaking into the sheet behind it', () => {
    renderPicker()
    const dialog = screen.getByRole('dialog')
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('conveys the pinned state without relying on colour', () => {
    const entry = makeEntry([createSpecificDieRollSource('die-a'), createAnonymousRollSource(1)])
    renderPicker({ entry })

    const tile = screen.getByRole('button', { name: 'Unpin Lucky D20' })
    expect(tile).toHaveAttribute('aria-pressed', 'true')
    expect(tile).toHaveTextContent('Pinned')
  })

  it('reports a pin as a source change that keeps the dice count', () => {
    const { onChange } = renderPicker()

    fireEvent.click(screen.getByRole('button', { name: 'Pin Lucky D20' }))

    const next = onChange.mock.calls[0][0]
    expect(getSpecificDieIds(next)).toEqual(['die-a'])
    expect(next.sources).toEqual([
      createSpecificDieRollSource('die-a'),
      createAnonymousRollSource(1),
    ])
  })

  it('closes on a backdrop press and release, but not on a click inside', () => {
    const { onClose } = renderPicker()
    const backdrop = screen.getByRole('presentation')
    const dialog = screen.getByRole('dialog')

    fireEvent.mouseDown(dialog)
    fireEvent.mouseUp(dialog)
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.mouseDown(backdrop)
    fireEvent.mouseUp(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ignores a click the backdrop only RECEIVED, without being pressed', () => {
    // Pinning re-renders the grid, so a tile can vanish between press and
    // release and hand its click to the backdrop. That must not dismiss the
    // dialog the player was still using.
    const { onClose } = renderPicker()
    const backdrop = screen.getByRole('presentation')

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Pin Lucky D20' }))
    fireEvent.click(backdrop)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores a gesture that starts on the backdrop but ends inside the dialog', () => {
    // The browser fires `click` on the nearest common ancestor of press and
    // release — the backdrop — so checking the click target alone would dismiss
    // a drag that ended inside the dialog. Both halves must land on the
    // backdrop.
    const { onClose } = renderPicker()
    const backdrop = screen.getByRole('presentation')

    fireEvent.mouseDown(backdrop)
    fireEvent.mouseUp(screen.getByRole('dialog'))
    fireEvent.click(backdrop)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers a die claimed by another entry as unavailable rather than hiding it', () => {
    renderPicker({ pinnedElsewhere: new Set(['die-a']) })

    const tile = screen.getByRole('button', {
      name: 'Lucky D20 is already pinned to another entry',
    })
    expect(tile).toBeDisabled()
    expect(tile).toHaveTextContent('In another entry')
  })

  it('batches a large collection behind Show More', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      makeDie({ id: `die-${i}`, name: `Die ${i}`, acquiredAt: i }))
    renderPicker({ ownedDice: many })

    // 24 tiles, and — crucially — only 24 previews handed to the shared canvas,
    // since each one costs a geometry + material entry and a per-frame draw.
    expect(screen.getAllByTestId('roll-dice-picker-tile')).toHaveLength(24)
    expect(screen.getAllByTestId('roll-dice-picker-preview')).toHaveLength(24)

    fireEvent.click(screen.getByRole('button', { name: 'Show 6 More' }))

    expect(screen.getAllByTestId('roll-dice-picker-tile')).toHaveLength(30)
    expect(screen.queryByTestId('roll-dice-picker-show-more')).not.toBeInTheDocument()
  })

  it('draws every preview from one shared canvas, never one per tile', () => {
    renderPicker({
      ownedDice: [
        makeDie({ id: 'die-a', name: 'A' }),
        makeDie({ id: 'die-b', name: 'B' }),
        makeDie({ id: 'die-c', name: 'C' }),
      ],
    })

    // Three tiles, three preview slots — but a single WebGL canvas scissored
    // across them, which is the whole reason this reuses the inventory's
    // shared canvas instead of mounting a <Canvas> per tile.
    expect(screen.getAllByTestId('roll-dice-picker-tile')).toHaveLength(3)
    expect(screen.getAllByTestId('roll-dice-picker-preview')).toHaveLength(3)
    expect(screen.getAllByTestId('inventory-preview-canvas')).toHaveLength(1)
  })
})
