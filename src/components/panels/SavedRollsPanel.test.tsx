import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DiceBackendProvider } from '../../contexts/DiceBackendProvider'
import type { DiceBackendState } from '../../contexts/DiceBackendContext'
import { useDiceStore } from '../../store/useDiceStore'
import { useMultiplayerStore, type MultiplayerDie } from '../../store/useMultiplayerStore'
import { useSavedRollsStore } from '../../store/useSavedRollsStore'
import type { SavedRoll } from '../../types/savedRolls'
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
    expect(addDie).toHaveBeenCalledWith('d6', 'inventory-d6')
    expect(addGenericDie).toHaveBeenCalledWith('d6')
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
})
