import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DiceBackendProvider } from '../../contexts/DiceBackendProvider'
import type { DiceBackendState } from '../../contexts/DiceBackendContext'
import { useDiceStore } from '../../store/useDiceStore'
import { useMultiplayerStore, type MultiplayerDie } from '../../store/useMultiplayerStore'
import { useSavedRollsStore } from '../../store/useSavedRollsStore'
import type { SavedRoll } from '../../types/savedRolls'
import type { PercentilePresentationFields } from '../../lib/percentileRolls'
import { SavedRollsPanel } from './SavedRollsPanel'

vi.mock('./BottomSheet', () => ({
  BottomSheet: ({ isOpen, children, title }: { isOpen: boolean; children: ReactNode; title: string }) => (
    isOpen ? <section aria-label={title}>{children}</section> : null
  ),
}))

const savedRoll: SavedRoll = {
  id: 'roll-1',
  name: 'Room fireball',
  flatBonus: 4,
  createdAt: 1,
  dice: [{
    id: 'entry-1',
    type: 'd6',
    quantity: 2,
    perDieBonus: 2,
    sources: [
      { kind: 'specific', dieId: 'inventory-d6' },
      { kind: 'anonymous', quantity: 1 },
    ],
  }],
}

function roomDie(id: string, ownerId = 'player-1'): MultiplayerDie {
  return {
    id,
    ownerId,
    diceType: 'd6',
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    targetPosition: [0, 0, 0],
    targetRotation: [0, 0, 0, 1],
    prevPosition: [0, 0, 0],
    prevRotation: [0, 0, 0, 1],
    isRolling: false,
    faceValue: null,
  }
}

function renderPanel(backendOverrides: Partial<DiceBackendState> = {}) {
  const onClose = vi.fn()
  const backend: DiceBackendState = {
    mode: 'multiplayer',
    roll: vi.fn(),
    addDie: vi.fn(() => 'spawn-specific'),
    addGenericDie: vi.fn(() => 'spawn-generic'),
    removeDie: vi.fn(),
    clearAll: vi.fn(),
    rollHistory: [],
    clearHistory: vi.fn(),
    multiplayer: {
      players: new Map(),
      localPlayerId: 'player-1',
      roomId: 'solo',
      connectionStatus: 'connected',
    },
    ...backendOverrides,
  }

  render(
    <DiceBackendProvider value={backend}>
      <SavedRollsPanel isOpen onClose={onClose} />
    </DiceBackendProvider>,
  )

  return { backend, onClose }
}

describe('SavedRollsPanel room execution', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useDiceStore.getState().reset()
    useMultiplayerStore.getState().reset()
    useMultiplayerStore.setState({
      connectionStatus: 'connected',
      localPlayerId: 'player-1',
      roomId: 'solo',
      dice: new Map([['old-die', roomDie('old-die')]]),
    })
    useSavedRollsStore.setState({ savedRolls: [savedRoll], currentlyEditing: null })
  })

  it('clears, reconciles out-of-order spawn acknowledgements, then rolls with exact bonuses', async () => {
    const operations: string[] = []
    const clearAll = vi.fn(() => {
      operations.push('clear')
      useMultiplayerStore.setState({ dice: new Map() })
    })
    const addDie = vi.fn(() => {
      operations.push('spawn-specific')
      return 'spawn-specific'
    })
    const addGenericDie = vi.fn(() => {
      operations.push('spawn-generic')
      setTimeout(() => {
        useMultiplayerStore.setState({
          dice: new Map([
            ['unrelated', roomDie('unrelated', 'other-player')],
            ['spawn-generic', roomDie('spawn-generic')],
            ['spawn-specific', roomDie('spawn-specific')],
          ]),
        })
      }, 0)
      return 'spawn-generic'
    })
    const roll = vi.fn(() => {
      operations.push('roll')
      useMultiplayerStore.setState((state) => ({
        rollStartedSequence: state.rollStartedSequence + 1,
        lastRollStartedDiceIds: ['spawn-specific', 'spawn-generic'],
      }))
    })
    const { onClose } = renderPanel({ clearAll, addDie, addGenericDie, roll })

    fireEvent.click(screen.getByRole('button', { name: 'Roll Room fireball' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(operations).toEqual(['clear', 'spawn-specific', 'spawn-generic', 'roll'])
    // Third/second arg is the presentation extras slot: `undefined` for a plain
    // entry, so an ordinary die still spawns with no presentation of its own.
    expect(addDie).toHaveBeenCalledWith('d6', 'inventory-d6', undefined)
    expect(addGenericDie).toHaveBeenCalledWith('d6', undefined)
    const active = useDiceStore.getState().activeSavedRoll
    expect(active?.name).toBe('Room fireball')
    expect(active?.flatBonus).toBe(4)
    expect(Array.from(active?.perDieBonuses.entries() ?? [])).toEqual([
      ['spawn-specific', 2],
      ['spawn-generic', 2],
    ])
  })

  it('surfaces a spawn failure and never rolls', async () => {
    const roll = vi.fn()
    const { onClose } = renderPanel({
      clearAll: vi.fn(() => useMultiplayerStore.setState({ dice: new Map() })),
      addDie: vi.fn(() => {
        useMultiplayerStore.setState({
          roomActionError: { code: 'DICE_LIMIT', message: 'Table is full (30/30 dice)' },
        })
        return null
      }),
      roll,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Roll Room fireball' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Table is full')
    expect(roll).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(useDiceStore.getState().activeSavedRoll).toBeNull()
  })

  it('surfaces a roll rejection after acknowledged spawns', async () => {
    const roll = vi.fn(() => {
      useMultiplayerStore.setState({
        roomActionError: { code: 'ROLL_REJECTED', message: 'The room rejected this roll.' },
      })
    })
    renderPanel({
      clearAll: vi.fn(() => useMultiplayerStore.setState({ dice: new Map() })),
      addDie: vi.fn(() => {
        useMultiplayerStore.setState({ dice: new Map([['spawn-specific', roomDie('spawn-specific')]]) })
        return 'spawn-specific'
      }),
      addGenericDie: vi.fn(() => {
        useMultiplayerStore.setState((state) => ({
          dice: new Map([...state.dice, ['spawn-generic', roomDie('spawn-generic')]]),
        }))
        return 'spawn-generic'
      }),
      roll,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Roll Room fireball' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('room rejected this roll')
    expect(roll).toHaveBeenCalledOnce()
    expect(useDiceStore.getState().activeSavedRoll).toBeNull()
  })

  it('budgets the capacity against dice clearAll will not remove', async () => {
    // Arrange — 25 foreign dice stay on the table; clearAll only clears our own,
    // so only 5 of the room's 30 slots will actually be free.
    const foreignDice = new Map(
      Array.from({ length: 25 }, (_, i) => [`foreign-${i}`, roomDie(`foreign-${i}`, 'player-2')] as const),
    )
    useMultiplayerStore.setState({
      dice: new Map([...foreignDice, ['old-die', roomDie('old-die')]]),
    })
    useSavedRollsStore.setState({
      savedRolls: [{
        ...savedRoll,
        name: 'Six dice',
        dice: [{
          id: 'entry-six',
          type: 'd6',
          quantity: 6,
          perDieBonus: 0,
          sources: [{ kind: 'anonymous', quantity: 6 }],
        }],
      }],
      currentlyEditing: null,
    })
    const clearAll = vi.fn()
    const roll = vi.fn()
    const { onClose } = renderPanel({ clearAll, roll })

    // Act — 6 dice fits the 30-die room but not the 5 free slots
    fireEvent.click(screen.getByRole('button', { name: 'Roll Six dice' }))

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Only 5 of the room's 30 dice are free",
    )
    expect(clearAll).not.toHaveBeenCalled()
    expect(roll).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('still executes a roll that fits the free capacity beside foreign dice', async () => {
    // Arrange — 24 foreign dice leave 6 free; the roll needs 2
    const foreignDice = new Map(
      Array.from({ length: 24 }, (_, i) => [`foreign-${i}`, roomDie(`foreign-${i}`, 'player-2')] as const),
    )
    useMultiplayerStore.setState({
      dice: new Map([...foreignDice, ['old-die', roomDie('old-die')]]),
    })
    const clearAll = vi.fn(() => {
      useMultiplayerStore.setState({ dice: new Map(foreignDice) })
    })
    const addDie = vi.fn(() => {
      useMultiplayerStore.setState((state) => ({
        dice: new Map([...state.dice, ['spawn-specific', roomDie('spawn-specific')]]),
      }))
      return 'spawn-specific'
    })
    const addGenericDie = vi.fn(() => {
      useMultiplayerStore.setState((state) => ({
        dice: new Map([...state.dice, ['spawn-generic', roomDie('spawn-generic')]]),
      }))
      return 'spawn-generic'
    })
    const roll = vi.fn(() => {
      useMultiplayerStore.setState((state) => ({
        rollStartedSequence: state.rollStartedSequence + 1,
        lastRollStartedDiceIds: ['spawn-specific', 'spawn-generic'],
      }))
    })
    const { onClose } = renderPanel({ clearAll, addDie, addGenericDie, roll })

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Roll Room fireball' }))

    // Assert
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(roll).toHaveBeenCalledOnce()
  })

  it('refuses an over-capacity legacy roll without clearing the table', async () => {
    // Arrange — a roll saved before the 30-dice cap existed
    useSavedRollsStore.setState({
      savedRolls: [{
        ...savedRoll,
        name: 'Legacy avalanche',
        dice: [{
          id: 'entry-huge',
          type: 'd6',
          quantity: 31,
          perDieBonus: 0,
          sources: [{ kind: 'anonymous', quantity: 31 }],
        }],
      }],
      currentlyEditing: null,
    })
    const clearAll = vi.fn()
    const roll = vi.fn()
    const { onClose } = renderPanel({ clearAll, roll })

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Roll Legacy avalanche' }))

    // Assert — guarded client-side, never reaching a server DICE_LIMIT
    expect(await screen.findByRole('alert')).toHaveTextContent('Rolls are limited to 30 dice')
    expect(screen.getByRole('alert')).toHaveTextContent('needs 31')
    expect(clearAll).not.toHaveBeenCalled()
    expect(roll).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lets 15 percentile dice through — exactly the 30-dice cap', async () => {
    // A d100 is TWO physical dice, so 15 sources is the cap exactly, not 15.
    useSavedRollsStore.setState({
      savedRolls: [{
        ...savedRoll,
        name: 'Fifteen percentiles',
        dice: [{
          id: 'entry-15-d100',
          type: 'd10',
          quantity: 15,
          perDieBonus: 0,
          percentile: true,
          sources: [{ kind: 'anonymous', quantity: 15 }],
        }],
      }],
      currentlyEditing: null,
    })

    const spawnedIds: string[] = []
    const addGenericDie = vi.fn((type: string) => {
      const id = `${type}-${spawnedIds.length}`
      spawnedIds.push(id)
      useMultiplayerStore.setState((state) => ({
        dice: new Map([...state.dice, [id, roomDie(id)]]),
      }))
      return id
    })
    const { onClose } = renderPanel({
      clearAll: vi.fn(() => useMultiplayerStore.setState({ dice: new Map() })),
      addGenericDie,
      roll: vi.fn(() => {
        useMultiplayerStore.setState((state) => ({
          rollStartedSequence: state.rollStartedSequence + 1,
          lastRollStartedDiceIds: [...spawnedIds],
        }))
      }),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Roll Fifteen percentiles' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(spawnedIds).toHaveLength(30)
  })

  it('caps 16 percentile dice with the roll-capacity message (32 > 30)', async () => {
    useSavedRollsStore.setState({
      savedRolls: [{
        ...savedRoll,
        name: 'Sixteen percentiles',
        dice: [{
          id: 'entry-16-d100',
          type: 'd10',
          quantity: 16,
          perDieBonus: 0,
          percentile: true,
          sources: [{ kind: 'anonymous', quantity: 16 }],
        }],
      }],
      currentlyEditing: null,
    })
    const clearAll = vi.fn()
    const roll = vi.fn()
    const { onClose } = renderPanel({ clearAll, roll })

    fireEvent.click(screen.getByRole('button', { name: 'Roll Sixteen percentiles' }))

    // The guard must count PHYSICAL dice: 16 sources are 32 dice, not 16.
    expect(await screen.findByRole('alert')).toHaveTextContent('Rolls are limited to 30 dice')
    expect(screen.getByRole('alert')).toHaveTextContent('needs 32')
    expect(clearAll).not.toHaveBeenCalled()
    expect(roll).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('spawns a d10tens + d10 pair per percentile die and records the pairing', async () => {
    useSavedRollsStore.setState({
      savedRolls: [{
        id: 'roll-d100',
        name: 'Percentile check',
        flatBonus: 0,
        createdAt: 1,
        dice: [{
          id: 'entry-d100',
          type: 'd10',
          quantity: 2,
          perDieBonus: 3,
          percentile: true,
          sources: [{ kind: 'anonymous', quantity: 2 }],
        }],
      }],
      currentlyEditing: null,
    })

    const spawned: Array<{ type: string; presentation?: PercentilePresentationFields }> = []
    const addGenericDie = vi.fn((type: string, presentation?: PercentilePresentationFields) => {
      const id = `${type}-${spawned.length}`
      spawned.push({ type, presentation })
      useMultiplayerStore.setState((state) => ({
        dice: new Map([...state.dice, [id, roomDie(id)]]),
      }))
      return id
    })
    const roll = vi.fn(() => {
      useMultiplayerStore.setState((state) => ({
        rollStartedSequence: state.rollStartedSequence + 1,
        lastRollStartedDiceIds: ['d10tens-0', 'd10-1', 'd10tens-2', 'd10-3'],
      }))
    })
    const { onClose } = renderPanel({
      clearAll: vi.fn(() => useMultiplayerStore.setState({ dice: new Map() })),
      addGenericDie,
      roll,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Roll Percentile check' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    // Tens die first, then its ones half — twice, one pair per percentile die.
    expect(spawned.map((die) => die.type)).toEqual(['d10tens', 'd10', 'd10tens', 'd10'])

    // The pairing is stamped onto the DICE (presentation), never into local roll
    // state: that is what makes it survive table edits, reach remote players and
    // outlive a refresh. Each pair shares one id with opposite roles, and the two
    // pairs must not share an id.
    const [tensA, onesA, tensB, onesB] = spawned
    expect(tensA.presentation?.percentileRole).toBe('tens')
    expect(onesA.presentation?.percentileRole).toBe('ones')
    expect(tensA.presentation?.percentilePairId).toBe(onesA.presentation?.percentilePairId)
    expect(tensB.presentation?.percentileRole).toBe('tens')
    expect(onesB.presentation?.percentileRole).toBe('ones')
    expect(tensB.presentation?.percentilePairId).toBe(onesB.presentation?.percentilePairId)
    expect(tensA.presentation?.percentilePairId).not.toBe(tensB.presentation?.percentilePairId)

    const active = useDiceStore.getState().activeSavedRoll
    expect(active).not.toBeNull()
    expect('percentilePairs' in (active ?? {})).toBe(false)
    // The per-die bonus lands ONCE per pair, on the ones half (it applies to the
    // combined 1-100 value, not to each physical die).
    expect(Array.from(active?.perDieBonuses.entries() ?? [])).toEqual([
      ['d10-1', 3],
      ['d10-3', 3],
    ])
  })

  it('does not pair dice for an ordinary d10 entry', async () => {
    useSavedRollsStore.setState({
      savedRolls: [{
        id: 'roll-d10',
        name: 'Plain d10',
        flatBonus: 0,
        createdAt: 1,
        dice: [{
          id: 'entry-d10',
          type: 'd10',
          quantity: 1,
          perDieBonus: 0,
          sources: [{ kind: 'anonymous', quantity: 1 }],
        }],
      }],
      currentlyEditing: null,
    })

    const spawned: Array<{ type: string; presentation?: PercentilePresentationFields }> = []
    const addGenericDie = vi.fn((type: string, presentation?: PercentilePresentationFields) => {
      spawned.push({ type, presentation })
      useMultiplayerStore.setState((state) => ({
        dice: new Map([...state.dice, ['plain-d10', roomDie('plain-d10')]]),
      }))
      return 'plain-d10'
    })
    const { onClose } = renderPanel({
      clearAll: vi.fn(() => useMultiplayerStore.setState({ dice: new Map() })),
      addGenericDie,
      roll: vi.fn(() => {
        useMultiplayerStore.setState((state) => ({
          rollStartedSequence: state.rollStartedSequence + 1,
          lastRollStartedDiceIds: ['plain-d10'],
        }))
      }),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Roll Plain d10' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(spawned.map((die) => die.type)).toEqual(['d10'])
    // A plain d10 spawns with NO presentation block at all (Shared-ADR-005).
    expect(spawned[0].presentation).toBeUndefined()
  })
})
