import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInventoryStore } from '../store/useInventoryStore'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useMultiplayerDiceBackend } from './useMultiplayerDiceBackend'

function addOwnedD20(id = 'owned-d20') {
  return useInventoryStore.getState().addDie({
    id,
    type: 'd20',
    setId: 'starter',
    rarity: 'common',
    appearance: {
      baseColor: '#8b5cf6',
      accentColor: '#ffffff',
      material: 'plastic',
    },
    vfx: {},
    name: 'Owned D20',
    isFavorite: false,
    isLocked: false,
    source: 'starter',
  })
}

describe('useMultiplayerDiceBackend', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    useInventoryStore.getState().reset()
    useMultiplayerStore.getState().reset()
  })

  it('spawns the owned die once, then a basic one, before server acknowledgement', () => {
    addOwnedD20()
    const send = vi.fn()
    useMultiplayerStore.setState({
      connectionStatus: 'connected',
      socket: { send } as unknown as WebSocket,
      localPlayerId: 'p1',
    })

    const { result } = renderHook(() => useMultiplayerDiceBackend())

    act(() => {
      result.current.addDie('d20')
      result.current.addDie('d20')
    })

    // The owned die is still spawned exactly once — it cannot be duplicated —
    // but the second request is met with a basic die instead of being refused.
    expect(send).toHaveBeenCalledTimes(2)
    expect(JSON.parse(send.mock.calls[0][0]).dice[0].presentation.inventoryDieId)
      .toBe('owned-d20')
    expect(useMultiplayerStore.getState().pendingInventoryDieIds.has('owned-d20')).toBe(true)

    expect(JSON.parse(send.mock.calls[1][0]).dice[0].presentation).toEqual({
      basic: true,
      displayName: 'Basic D20',
      baseColor: '#ffffff',
      accentColor: '#000000',
      material: 'plastic',
    })
    expect(useMultiplayerStore.getState().pendingInventoryDieIds.size).toBe(1)
  })

  it('spawns a random available owned inventory die', () => {
    addOwnedD20('owned-d20-a')
    addOwnedD20('owned-d20-b')
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const send = vi.fn()
    useMultiplayerStore.setState({
      connectionStatus: 'connected',
      socket: { send } as unknown as WebSocket,
      localPlayerId: 'p1',
    })

    const { result } = renderHook(() => useMultiplayerDiceBackend())

    act(() => {
      result.current.addDie('d20')
    })

    const payload = JSON.parse(send.mock.calls[0][0])
    expect(payload.dice[0].presentation.inventoryDieId).toBe('owned-d20-b')
  })

  it('never duplicates an explicitly requested die, substituting a basic instead', () => {
    addOwnedD20()
    const send = vi.fn()
    useMultiplayerStore.setState({
      connectionStatus: 'connected',
      socket: { send } as unknown as WebSocket,
      localPlayerId: 'p1',
    })

    const { result } = renderHook(() => useMultiplayerDiceBackend())

    act(() => {
      result.current.addDie('d20', 'owned-d20')
      result.current.addDie('d20', 'owned-d20')
    })

    expect(send).toHaveBeenCalledTimes(2)
    expect(JSON.parse(send.mock.calls[0][0]).dice[0].presentation.inventoryDieId)
      .toBe('owned-d20')
    const substituted = JSON.parse(send.mock.calls[1][0]).dice[0].presentation
    expect(substituted).toMatchObject({ basic: true })
    expect(substituted).not.toHaveProperty('inventoryDieId')
  })

  it('substitutes a basic die for a saved roll naming a die that no longer exists', () => {
    const send = vi.fn()
    useMultiplayerStore.setState({
      connectionStatus: 'connected',
      socket: { send } as unknown as WebSocket,
      localPlayerId: 'p1',
    })

    const { result } = renderHook(() => useMultiplayerDiceBackend())

    let spawnId: string | null = null
    act(() => {
      spawnId = result.current.addDie('d20', 'die_sold_long_ago')
    })

    // Degrades rather than failing: the rest of the roll still lands.
    expect(spawnId).not.toBeNull()
    expect(JSON.parse(send.mock.calls[0][0]).dice[0].presentation)
      .toMatchObject({ basic: true, displayName: 'Basic D20' })
  })

  it('spawns a generic die as a basic die, not as an anonymous owner-coloured one', () => {
    const send = vi.fn()
    useMultiplayerStore.setState({
      connectionStatus: 'connected',
      socket: { send } as unknown as WebSocket,
      localPlayerId: 'p1',
    })

    const { result } = renderHook(() => useMultiplayerDiceBackend())

    act(() => {
      result.current.addGenericDie('d6')
    })

    expect(send).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(send.mock.calls[0][0])
    expect(payload.dice[0].diceType).toBe('d6')
    // A presentation-less die renders in the OWNER'S player colour; a basic die
    // must be plain white with black numerals instead.
    expect(payload.dice[0].presentation).toEqual({
      basic: true,
      displayName: 'Basic D6',
      baseColor: '#ffffff',
      accentColor: '#000000',
      material: 'plastic',
    })
    expect(useMultiplayerStore.getState().pendingInventoryDieIds.size).toBe(0)
  })

  it('keeps percentile pairing fields on the basic tens die', () => {
    const send = vi.fn()
    useMultiplayerStore.setState({
      connectionStatus: 'connected',
      socket: { send } as unknown as WebSocket,
      localPlayerId: 'p1',
    })

    const { result } = renderHook(() => useMultiplayerDiceBackend())

    act(() => {
      result.current.addGenericDie('d10tens', {
        percentilePairId: 'pct_1',
        percentileRole: 'tens',
      })
    })

    expect(JSON.parse(send.mock.calls[0][0]).dice[0].presentation).toEqual({
      basic: true,
      displayName: 'Basic D100 (tens)',
      baseColor: '#ffffff',
      accentColor: '#000000',
      material: 'plastic',
      percentilePairId: 'pct_1',
      percentileRole: 'tens',
    })
  })
})
