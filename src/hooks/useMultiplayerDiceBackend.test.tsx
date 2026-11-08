import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInventoryStore } from '../store/useInventoryStore'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useMultiplayerDiceBackend } from './useMultiplayerDiceBackend'
import { useSettingsStore } from '../store/useSettingsStore'
import { useDiceStore } from '../store/useDiceStore'
import { createBasicDicePresentation } from '../lib/basicDice'
import { getCatalogItemByKey } from '../lib/collectibleCatalog'
import * as catalog from '../lib/collectibleCatalog'

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
    useSettingsStore.getState().setThemeId('default')
  })

  it('uses the live personal theme from a retained action, not the room environment or captured settings', () => {
    const send = vi.fn()
    useMultiplayerStore.setState({
      connectionStatus: 'connected', socket: { send } as unknown as WebSocket, localPlayerId: 'p1',
      roomSettings: { ...useMultiplayerStore.getState().roomSettings, themeId: 'monster-dungeon' },
    })
    const { result } = renderHook(() => useMultiplayerDiceBackend())
    const retainedAdd = result.current.addStandardDie
    const tableBefore = useMultiplayerStore.getState().dice
    const inventoryBefore = useInventoryStore.getState()
    const reservedBefore = useDiceStore.getState().reservedInventoryDieIds
    act(() => retainedAdd('d20'))
    act(() => useSettingsStore.getState().setThemeId('cyberpunk-cutline'))
    act(() => retainedAdd('d20'))
    expect(JSON.parse(send.mock.calls[0][0]).dice[0].presentation).toEqual(createBasicDicePresentation('d20'))
    expect(JSON.parse(send.mock.calls[1][0]).dice[0].presentation.customAssetId).toBe('cyberpunk-cutline-set/d20')
    expect(useMultiplayerStore.getState().dice).toBe(tableBefore)
    expect(useInventoryStore.getState()).toBe(inventoryBefore)
    expect(useDiceStore.getState().reservedInventoryDieIds).toBe(reservedBefore)
  })

  it.each([
    ['fantasy-earth', 'woodland-sculpted-set'], ['critter-forest', 'woodland-sculpted-set'],
    ['sunlit-glade', 'woodland-sculpted-set'], ['neon-cyber-city', 'cyberpunk-cutline-set'],
    ['dungeon-castle', 'monster-dungeon-set'],
  ])('canonicalizes the retained personal alias %s before transport', (themeId, setId) => {
    const send = vi.fn()
    useMultiplayerStore.setState({ connectionStatus: 'connected', socket: { send } as unknown as WebSocket, localPlayerId: 'p1' })
    useSettingsStore.getState().setThemeId(themeId)
    const { result } = renderHook(() => useMultiplayerDiceBackend())
    act(() => result.current.addStandardDie('d6'))
    expect(JSON.parse(send.mock.calls[0][0]).dice[0].presentation.customAssetId).toBe(`${setId}/d6`)
  })

  for (const [themeId, setId] of [
    ['default', undefined], ['sunlit-glade-cel', 'woodland-sculpted-set'],
    ['cyberpunk-cutline', 'cyberpunk-cutline-set'], ['monster-dungeon', 'monster-dungeon-set'],
  ] as const) {
    it.each(['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const)(`${themeId} sends standard %s through the real store`, shape => {
      addOwnedD20()
      const inventoryBefore = useInventoryStore.getState()
      const send = vi.fn()
      useMultiplayerStore.setState({ connectionStatus: 'connected', socket: { send } as unknown as WebSocket, localPlayerId: 'p1' })
      useSettingsStore.getState().setThemeId(themeId)
      const { result } = renderHook(() => useMultiplayerDiceBackend())
      let requestId: string | null = null
      act(() => { requestId = result.current.addStandardDie(shape) })
      const payload = JSON.parse(send.mock.calls[0][0])
      expect(requestId).not.toBeNull()
      expect(payload.dice[0].diceType).toBe(shape)
      const presentation = payload.dice[0].presentation
      if (setId) {
        const item = getCatalogItemByKey(`${setId}/${shape}`)!
        expect(presentation).toMatchObject({ customAssetId: item.catalogKey, customAssetVersionId: item.assetVersionId })
        expect(presentation).not.toHaveProperty('basic')
      } else {
        expect(presentation).toEqual(createBasicDicePresentation(shape))
      }
      expect(presentation).not.toHaveProperty('inventoryDieId')
      expect(presentation).not.toHaveProperty('rarity')
      expect(useInventoryStore.getState()).toBe(inventoryBefore)
      expect(useMultiplayerStore.getState().pendingInventoryDieIds.size).toBe(0)
    })
  }

  it('clears active saved-roll metadata before sending a standard', () => {
    const send = vi.fn(() => expect(useDiceStore.getState().activeSavedRoll).toBeNull())
    useMultiplayerStore.setState({ connectionStatus: 'connected', socket: { send } as unknown as WebSocket, localPlayerId: 'p1' })
    useDiceStore.setState({ activeSavedRoll: { name: 'Old recipe', flatBonus: 3, perDieBonuses: new Map() } })
    const { result } = renderHook(() => useMultiplayerDiceBackend())
    act(() => result.current.addStandardDie('d6'))
    expect(send).toHaveBeenCalledOnce()
  })

  it('retains an acknowledged die and its presentation object across a theme switch and later spawn', () => {
    const send = vi.fn()
    useMultiplayerStore.setState({ connectionStatus: 'connected', socket: { send } as unknown as WebSocket, localPlayerId: 'p1' })
    const { result } = renderHook(() => useMultiplayerDiceBackend())
    act(() => result.current.addStandardDie('d6'))
    const request = JSON.parse(send.mock.calls[0][0]).dice[0]
    act(() => useMultiplayerStore.getState().handleServerMessage({ type: 'dice_spawned', ownerId: 'p1', dice: [{
      id: request.id, ownerId: 'p1', diceType: request.diceType,
      presentation: request.presentation, position: [1, 2, 3], rotation: [0, 0, 0, 1],
    }] }))
    const oldDie = useMultiplayerStore.getState().dice.get(request.id)!
    const oldPresentation = oldDie.presentation
    act(() => useSettingsStore.getState().setThemeId('monster-dungeon'))
    act(() => result.current.addStandardDie('d6'))
    expect(useMultiplayerStore.getState().dice.get(request.id)).toBe(oldDie)
    expect(oldDie.presentation).toBe(oldPresentation)
    expect(oldPresentation).toEqual(createBasicDicePresentation('d6'))
    expect(JSON.parse(send.mock.calls[1][0]).dice[0].presentation.customAssetId).toBe('monster-dungeon-set/d6')
  })

  it('preserves room refusal for a standard when disconnected', () => {
    const { result } = renderHook(() => useMultiplayerDiceBackend())
    expect(result.current.addStandardDie('d20')).toBeNull()
  })

  it.each(['missing item', 'wrong shape', 'missing bundled resolution', 'unknown theme'])('sends a basic fallback through the real store for %s', failure => {
    const wrongShape = catalog.getCatalogItemByKey('monster-dungeon-set/d6')!
    if (failure === 'missing item') vi.spyOn(catalog, 'getCatalogItemByKey').mockReturnValue(undefined)
    if (failure === 'wrong shape') vi.spyOn(catalog, 'getCatalogItemByKey').mockReturnValue(wrongShape)
    if (failure === 'missing bundled resolution') vi.spyOn(catalog, 'getBundledGltfDiceAsset').mockReturnValue(null)
    useSettingsStore.getState().setThemeId(failure === 'unknown theme' ? 'not-a-theme' : 'monster-dungeon')
    const send = vi.fn()
    useMultiplayerStore.setState({ connectionStatus: 'connected', socket: { send } as unknown as WebSocket, localPlayerId: 'p1' })
    const { result } = renderHook(() => useMultiplayerDiceBackend())
    act(() => result.current.addStandardDie('d20'))
    expect(JSON.parse(send.mock.calls[0][0]).dice[0].presentation).toEqual(createBasicDicePresentation('d20'))
  })

  it('preserves explicit-owned and generic percentile presentations under a managed personal theme', () => {
    addOwnedD20()
    useSettingsStore.getState().setThemeId('monster-dungeon')
    const send = vi.fn()
    useMultiplayerStore.setState({ connectionStatus: 'connected', socket: { send } as unknown as WebSocket, localPlayerId: 'p1' })
    const { result } = renderHook(() => useMultiplayerDiceBackend())
    act(() => {
      result.current.addDie('d20', 'owned-d20', { percentilePairId: 'pair', percentileRole: 'ones' })
      result.current.addGenericDie('d10tens', { percentilePairId: 'pair', percentileRole: 'tens' })
    })
    expect(JSON.parse(send.mock.calls[0][0]).dice[0].presentation).toMatchObject({ inventoryDieId: 'owned-d20', displayName: 'Owned D20', percentilePairId: 'pair', percentileRole: 'ones' })
    expect(JSON.parse(send.mock.calls[1][0]).dice[0].presentation).toEqual({ ...createBasicDicePresentation('d10tens'), percentilePairId: 'pair', percentileRole: 'tens' })
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
