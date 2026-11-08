import { StrictMode, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentSoloTableScope, useSoloTableLoadout } from './useSoloTableLoadout'
import { useMultiplayerDiceBackend } from './useMultiplayerDiceBackend'
import { SOLO_WORKER_SERVER_URL, useMultiplayerStore } from '../store/useMultiplayerStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useAuthStore } from '../store/useAuthStore'
import { useInventoryStore } from '../store/useInventoryStore'
import { useWalletStore } from '../store/useWalletStore'
import { useDiceStore } from '../store/useDiceStore'
import { encodeSoloTable } from '../lib/soloTableLoadout'
import { createThemeDicePresentation } from '../lib/themeDicePresentation'
import type { EngineConfig, SpawnDiceEntry } from '../lib/multiplayerMessages'
import type { User } from '@supabase/supabase-js'
import { __resetDataSyncForTests, getInventoryHydration, startSync, stopSync } from '../lib/dataSync'
import { controlledInventoryClient } from '../test/controlledInventoryClient'

const key = 'dicesuki-solo-table:v1:guest'
const send = vi.fn()
let socket = { send, close: vi.fn() } as unknown as WebSocket
const requests = (): SpawnDiceEntry[] => send.mock.calls.map(([raw]) => JSON.parse(raw)).filter(m => m.type === 'spawn_dice').flatMap(m => m.dice)
function ready(transport = SOLO_WORKER_SERVER_URL) {
  act(() => useMultiplayerStore.setState({ connectionStatus: 'connected', socket, roomId: 'solo', serverUrl: transport, localPlayerId: 'p1', engineConfig: {} as EngineConfig }))
}
function ack(entries: SpawnDiceEntry[], ownerId = 'p1') {
  act(() => useMultiplayerStore.getState().handleServerMessage({ type: 'dice_spawned', ownerId, dice: entries.map(entry => ({ ...entry, ownerId, position: [0, 2, 0], rotation: [0, 0, 0, 1] })) }))
}
function mount(strict = false) {
  return renderHook(() => {
    const backend = useMultiplayerDiceBackend()
    return { ...useSoloTableLoadout(backend.addStandardDie), backend }
  }, { wrapper: strict ? ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> : undefined })
}
beforeEach(() => {
  vi.restoreAllMocks(); send.mockReset()
  socket = { send, close: vi.fn() } as unknown as WebSocket
  __resetDataSyncForTests()
  useInventoryStore.getState().reset()
  localStorage.clear()
  useMultiplayerStore.getState().reset()
  useDiceStore.getState().reset()
  useSettingsStore.getState().setThemeId('default')
  useAuthStore.setState({ status: 'guest', user: null })
})
afterEach(() => { act(() => { __resetDataSyncForTests(); useMultiplayerStore.getState().reset() }) })

describe('solo loadout acknowledged lifecycle', () => {
  it('waits for real same-account copies and catalog, then ACKs the owned restore before retaining its ID on an added D8', async () => {
    const accountKey = 'dicesuki-solo-table:v1:user:account-a'
    const raw = encodeSoloTable([
      { shape: 'd6', presentation: { inventoryDieId: 'server-copy-mine', displayName: 'Original copy' } },
      { shape: 'd4', presentation: createThemeDicePresentation('monster-dungeon', 'd4') },
    ])
    localStorage.setItem(accountKey, raw)
    localStorage.setItem('dicesuki-sync-meta', JSON.stringify({ owner: 'account-a', users: {} }))
    useAuthStore.setState({ status: 'authenticated', user: { id: 'account-a' } as User })
    useWalletStore.setState({ userId: 'account-a' })
    const fake = controlledInventoryClient()
    // Exercise the complete real blob hydration -> copies/catalog producer.
    const sync = startSync('account-a', { client: fake.client })
    await fake.copiesRequested
    const mounted = mount(true); ready()
    // wallet/cache identity already matches, but neither is an ownership receipt.
    expect(requests()).toEqual([])
    await act(async () => { fake.acceptCopies(); await Promise.resolve() })
    await waitFor(() => expect(useWalletStore.getState().userId).toBe('account-a'))
    expect(requests()).toEqual([])
    await act(async () => { fake.acceptCatalog(); await sync })
    expect(requests()).toHaveLength(2)
    expect(requests()[0].presentation).toMatchObject({ inventoryDieId: 'server-copy-mine', displayName: fake.asset.metadata.name })
    expect(requests()[1].presentation?.customAssetId).toBe('monster-dungeon-set/d4')
    ack(requests().slice(0, 1))
    expect(localStorage.getItem(accountKey)).toBe(raw)
    ack(requests().slice(1, 2))
    expect(localStorage.getItem(accountKey)).toBe(raw)
    act(() => mounted.result.current.backend.addStandardDie('d8'))
    ack(requests().slice(2))
    expect(JSON.parse(localStorage.getItem(accountKey)!).dice[0].presentation.inventoryDieId).toBe('server-copy-mine')
    expect(JSON.parse(localStorage.getItem(accountKey)!).dice.map((die: { shape: string }) => die.shape)).toEqual(['d6', 'd4', 'd8'])
    mounted.unmount()
  })

  it('does not promote a retained cached row into ownership after the current server copy read confirms empty', async () => {
    const accountKey = 'dicesuki-solo-table:v1:user:account-a'
    const raw = encodeSoloTable([{ shape: 'd6', presentation: { inventoryDieId: 'cached-local-id' } }])
    localStorage.setItem(accountKey, raw)
    localStorage.setItem('dicesuki-sync-meta', JSON.stringify({ owner: 'account-a', users: {} }))
    useInventoryStore.getState().addDie({ id: 'cached-local-id', type: 'd6', setId: 'starter', rarity: 'rare', name: 'Cached unverified copy', appearance: { baseColor: '#123456', accentColor: '#ffffff', material: 'wood' }, vfx: {}, source: 'starter', isFavorite: false, isLocked: false })
    useAuthStore.setState({ status: 'authenticated', user: { id: 'account-a' } as User })
    const fake = controlledInventoryClient()
    const sync = startSync('account-a', { client: fake.client, targets: [] })
    const mounted = mount(); ready()
    await act(async () => { fake.acceptCatalog(); fake.acceptCopies([]); await sync })
    expect(requests()[0].presentation).toMatchObject({ basic: true })
    expect(requests()[0].presentation).not.toHaveProperty('inventoryDieId')
    expect(localStorage.getItem(accountKey)).toBe(raw)
    mounted.unmount()
  })

  it('retains an accepted D8 added while the owned read is pending and still restores the saved owned die', async () => {
    const accountKey = 'dicesuki-solo-table:v1:user:account-a'
    const raw = encodeSoloTable([{ shape: 'd6', presentation: { inventoryDieId: 'server-copy-mine' } }])
    localStorage.setItem(accountKey, raw)
    useAuthStore.setState({ status: 'authenticated', user: { id: 'account-a' } as User })
    const fake = controlledInventoryClient()
    const sync = startSync('account-a', { client: fake.client, targets: [] })
    const mounted = mount(); ready()
    await fake.copiesRequested
    act(() => mounted.result.current.backend.addStandardDie('d8')); ack(requests())
    expect(localStorage.getItem(accountKey)).toBe(raw)
    await act(async () => { fake.acceptCatalog(); fake.acceptCopies(); await sync })
    expect(requests().map(die => die.diceType)).toEqual(['d8', 'd6'])
    expect(requests()[1].presentation?.inventoryDieId).toBe('server-copy-mine')
    ack(requests().slice(1))
    const written = JSON.parse(localStorage.getItem(accountKey)!)
    expect(written.dice.map((die: { shape: string }) => die.shape)).toEqual(['d8', 'd6'])
    expect(written.dice[1].presentation.inventoryDieId).toBe('server-copy-mine')
    mounted.unmount()
  })

  it('bounds a hanging current read to playable fallback without reskinning or losing its owned source after late success', async () => {
    vi.useFakeTimers()
    const accountKey = 'dicesuki-solo-table:v1:user:account-a'
    const descriptor = { shape: 'd6' as const, presentation: { inventoryDieId: 'server-copy-mine', displayName: 'Original copy' } }
    const raw = encodeSoloTable([descriptor])
    localStorage.setItem(accountKey, raw)
    useAuthStore.setState({ status: 'authenticated', user: { id: 'account-a' } as User })
    const fake = controlledInventoryClient()
    const sync = startSync('account-a', { client: fake.client, targets: [] })
    const mounted = mount(); ready()
    try {
      await fake.copiesRequested
      expect(requests()).toEqual([])
      await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
      expect(getInventoryHydration().status).toBe('unavailable')
      expect(requests()).toHaveLength(1)
      expect(requests()[0].presentation).toMatchObject({ basic: true })
      ack(requests())
      await act(async () => { fake.acceptCatalog(); fake.acceptCopies(); await sync })
      expect(getInventoryHydration().status).toBe('ready')
      expect(requests()).toHaveLength(1)
      expect([...useMultiplayerStore.getState().dice.values()][0].presentation).toMatchObject({ basic: true })
      act(() => mounted.result.current.backend.addStandardDie('d8')); ack(requests().slice(1))
      expect(JSON.parse(localStorage.getItem(accountKey)!).dice[0]).toEqual(descriptor)
    } finally { mounted.unmount(); vi.useRealTimers() }
  })

  it.each(['fresh', 'empty', 'theme'] as const)('restores authenticated %s instantly while ownership is pending', async kind => {
    const accountKey = 'dicesuki-solo-table:v1:user:account-a'
    if (kind !== 'fresh') localStorage.setItem(accountKey, encodeSoloTable(kind === 'empty' ? [] : [{ shape: 'd8', presentation: createThemeDicePresentation('monster-dungeon', 'd8') }]))
    useAuthStore.setState({ status: 'authenticated', user: { id: 'account-a' } as User })
    const fake = controlledInventoryClient()
    const sync = startSync('account-a', { client: fake.client, targets: [] })
    const mounted = mount(true); ready()
    expect(getInventoryHydration().status).toBe('pending')
    expect(requests().map(die => die.diceType)).toEqual(kind === 'empty' ? [] : [kind === 'fresh' ? 'd20' : 'd8'])
    await act(async () => { fake.acceptCatalog(); fake.acceptCopies([]); await sync })
    mounted.unmount()
  })

  it('does not inherit same-account readiness or arm old queued ACKs after stop/restart', async () => {
    const accountKey = 'dicesuki-solo-table:v1:user:account-a'
    const raw = encodeSoloTable([{ shape: 'd6', presentation: { inventoryDieId: 'server-copy-mine' } }])
    localStorage.setItem(accountKey, raw)
    useAuthStore.setState({ status: 'authenticated', user: { id: 'account-a' } as User })
    const old = controlledInventoryClient()
    const sync = startSync('account-a', { client: old.client, targets: [] })
    const mounted = mount(); ready()
    await act(async () => { old.acceptCatalog(); old.acceptCopies(); await sync })
    const oldEntries = requests()
    const fresh = controlledInventoryClient()
    let next!: Promise<void>
    act(() => { stopSync(); next = startSync('account-a', { client: fresh.client, targets: [] }) })
    ack(oldEntries)
    act(() => mounted.result.current.backend.addStandardDie('d8')); ack(requests().slice(1))
    expect(localStorage.getItem(accountKey)).toBe(raw)
    // A new worker must wait for this generation, not use the previous ready view.
    act(() => useMultiplayerStore.getState().reset()); send.mockReset()
    socket = { send, close: vi.fn() } as unknown as WebSocket
    ready()
    expect(requests()).toEqual([])
    await act(async () => { fresh.acceptCatalog(); fresh.acceptCopies(); await next })
    expect(requests()).toHaveLength(1)
    expect(requests()[0].presentation?.inventoryDieId).toBe('server-copy-mine')
    ack(requests())
    act(() => mounted.result.current.backend.addStandardDie('d8')); ack(requests().slice(1))
    expect(JSON.parse(localStorage.getItem(accountKey)!).dice[0].presentation.inventoryDieId).toBe('server-copy-mine')
    mounted.unmount()
  })

  it('keeps unresolved owned source through StrictMode effect replay while bootstrap ACK is queued', () => {
    const accountKey = 'dicesuki-solo-table:v1:user:account-a'
    const descriptor = { shape: 'd6' as const, presentation: { inventoryDieId: 'server-copy-mine', displayName: 'Original copy' } }
    localStorage.setItem(accountKey, encodeSoloTable([descriptor]))
    useAuthStore.setState({ status: 'authenticated', user: { id: 'account-a' } as User })
    ready() // First effect sends, StrictMode cleanup/setup sees its pending request.
    const mounted = mount(true)
    expect(requests()).toHaveLength(1)
    ack(requests())
    act(() => mounted.result.current.backend.addStandardDie('d8')); ack(requests().slice(1))
    expect(JSON.parse(localStorage.getItem(accountKey)!).dice[0]).toEqual(descriptor)
    mounted.unmount()
  })

  it.each(['empty', 'failure', 'unconfigured'] as const)('distinguishes %s ownership and preserves unresolved descriptors through edit and reload', async outcome => {
    const accountKey = 'dicesuki-solo-table:v1:user:account-a'
    const descriptor = { shape: 'd6' as const, presentation: { inventoryDieId: 'server-copy-mine', displayName: 'Original copy', baseColor: '#123456', material: 'wood' } }
    const raw = encodeSoloTable([descriptor])
    localStorage.setItem(accountKey, raw)
    useAuthStore.setState({ status: 'authenticated', user: { id: 'account-a' } as User })
    const fake = controlledInventoryClient()
    const sync = outcome === 'unconfigured' ? Promise.resolve() : startSync('account-a', { client: fake.client, targets: [] })
    const mounted = mount(true); ready()
    if (outcome !== 'unconfigured') {
      await fake.copiesRequested
      expect(requests()).toEqual([])
      await act(async () => {
        fake.acceptCatalog()
        if (outcome === 'failure') fake.copies.resolve({ data: null, error: { message: 'offline' } })
        else fake.acceptCopies([])
        await sync
      })
    }
    expect(requests()).toHaveLength(1)
    expect(requests()[0].presentation).toMatchObject({ basic: true })
    expect(requests()[0].presentation).not.toHaveProperty('inventoryDieId')
    ack(requests())
    expect(localStorage.getItem(accountKey)).toBe(raw)
    act(() => mounted.result.current.backend.addStandardDie('d8'))
    ack(requests().slice(1))
    const saved = JSON.parse(localStorage.getItem(accountKey)!)
    expect(saved.dice.map((die: { shape: string }) => die.shape)).toEqual(['d6', 'd8'])
    if (outcome === 'empty') expect(saved.dice[0].presentation).not.toHaveProperty('inventoryDieId')
    else expect(saved.dice[0]).toEqual(descriptor)
    const stored = localStorage.getItem(accountKey)
    const write = vi.spyOn(Storage.prototype, 'setItem')
    for (let tick = 0; tick < 60; tick++) act(() => useMultiplayerStore.getState().handleServerMessage({ type: 'physics_snapshot', tick, dice: [] }))
    expect(write.mock.calls.filter(([name]) => name === accountKey)).toEqual([])
    expect(localStorage.getItem(accountKey)).toBe(stored)
    mounted.unmount()
    act(() => useMultiplayerStore.getState().reset()); send.mockReset()
    socket = { send, close: vi.fn() } as unknown as WebSocket
    const reload = mount(); ready(); ack(requests())
    expect(requests()).toHaveLength(2)
    expect(requests()[0].presentation).toMatchObject({ basic: true })
    expect(localStorage.getItem(accountKey)).toBe(stored)
    // Removing the stand-in explicitly removes its source descriptor as well.
    act(() => useMultiplayerStore.getState().handleServerMessage({ type: 'dice_removed', diceIds: [requests()[0].id] }))
    expect(JSON.parse(localStorage.getItem(accountKey)!).dice.map((die: { shape: string }) => die.shape)).toEqual(['d8'])
    reload.unmount()
  })

  it('preserves the owned token on a later unrelated edit even when the real read had already failed before mounting', async () => {
    const accountKey = 'dicesuki-solo-table:v1:user:account-a'
    const descriptor = { shape: 'd6' as const, presentation: { inventoryDieId: 'server-copy-mine', displayName: 'Original copy' } }
    const raw = encodeSoloTable([descriptor])
    localStorage.setItem(accountKey, raw)
    useAuthStore.setState({ status: 'authenticated', user: { id: 'account-a' } as User })
    const fake = controlledInventoryClient()
    const sync = startSync('account-a', { client: fake.client, targets: [] })
    fake.acceptCatalog(); fake.copies.resolve({ data: null, error: { message: 'offline' } }); await sync
    const mounted = mount(); ready(); ack(requests())
    expect(requests()[0].presentation).toMatchObject({ basic: true })
    act(() => mounted.result.current.backend.addStandardDie('d8')); ack(requests().slice(1))
    expect(JSON.parse(localStorage.getItem(accountKey)!).dice[0]).toEqual(descriptor)
    mounted.unmount()
  })

  it('does not arm persistence from queued owned ACKs after sync/account replacement', async () => {
    const accountKey = 'dicesuki-solo-table:v1:user:account-a'
    const raw = encodeSoloTable([{ shape: 'd6', presentation: { inventoryDieId: 'server-copy-mine' } }])
    localStorage.setItem(accountKey, raw)
    useAuthStore.setState({ status: 'authenticated', user: { id: 'account-a' } as User })
    const fake = controlledInventoryClient()
    const sync = startSync('account-a', { client: fake.client, targets: [] })
    const mounted = mount(); ready()
    await act(async () => { fake.acceptCatalog(); fake.acceptCopies(); await sync })
    const oldEntries = requests()
    const replacement = controlledInventoryClient()
    let nextSync!: Promise<void>
    act(() => { nextSync = startSync('account-b', { client: replacement.client, targets: [] }) })
    act(() => useAuthStore.setState({ status: 'authenticated', user: { id: 'account-b' } as User }))
    ack(oldEntries)
    act(() => mounted.result.current.backend.addStandardDie('d8')); ack(requests().slice(1))
    expect(localStorage.getItem(accountKey)).toBe(raw)
    expect(localStorage.getItem('dicesuki-solo-table:v1:user:account-b')).toBeNull()
    await act(async () => { replacement.acceptCatalog(); replacement.acceptCopies([]); await nextSync })
    expect(localStorage.getItem(accountKey)).toBe(raw)
    mounted.unmount()
  })

  it.each([
    ['default', undefined], ['sunlit-glade-cel', 'woodland-sculpted-set/d20'],
    ['cyberpunk-cutline', 'cyberpunk-cutline-set/d20'], ['monster-dungeon', 'monster-dungeon-set/d20'],
    ['dungeon-castle', 'monster-dungeon-set/d20'], ['unknown', undefined],
  ])('seeds exactly one native D20 for %s under StrictMode', (theme, asset) => {
    useSettingsStore.getState().setThemeId(theme)
    const { unmount } = mount(true)
    ready()
    expect(requests()).toHaveLength(1)
    expect(requests()[0]).toMatchObject({ diceType: 'd20' })
    expect(requests()[0].presentation?.customAssetId).toBe(asset)
    ack(requests())
    expect(JSON.parse(localStorage.getItem(key)!).dice).toHaveLength(1)
    unmount()
    expect(JSON.parse(localStorage.getItem(key)!).dice).toHaveLength(1)
  })

  it('preserves a mixed saved loadout until every restore echo, then persists only subsequent accepted edits', () => {
    const saved = encodeSoloTable([
      { shape: 'd6', presentation: createThemeDicePresentation('monster-dungeon', 'd6') },
      { shape: 'd8', presentation: createThemeDicePresentation('cyberpunk-cutline', 'd8') },
    ])
    localStorage.setItem(key, saved)
    const { result, unmount } = mount()
    ready()
    const restored = requests()
    expect(restored.map(d => d.presentation?.customAssetId)).toEqual(['monster-dungeon-set/d6', 'cyberpunk-cutline-set/d8'])
    ack(restored.slice(0, 1))
    expect(localStorage.getItem(key)).toBe(saved)
    ack(restored.slice(1))
    expect(localStorage.getItem(key)).toBe(saved)
    act(() => result.current.backend.addStandardDie('d4'))
    expect(localStorage.getItem(key)).toBe(saved)
    ack(requests().slice(2))
    expect(JSON.parse(localStorage.getItem(key)!).dice.map((d: { shape: string }) => d.shape)).toEqual(['d6', 'd8', 'd4'])
    const written = localStorage.getItem(key)
    const write = vi.spyOn(Storage.prototype, 'setItem')
    for (let tick = 0; tick < 60; tick++) act(() => useMultiplayerStore.getState().handleServerMessage({ type: 'physics_snapshot', tick, dice: [{ id: restored[0].id, p: [tick, 1, 0], r: [0, 0, 0, 1] }] }))
    expect(write).not.toHaveBeenCalled()
    expect(localStorage.getItem(key)).toBe(written)
    unmount()
    expect(localStorage.getItem(key)).toBe(written)
  })

  it('restores deliberate empty as empty and persists removal of the last accepted die', () => {
    localStorage.setItem(key, encodeSoloTable([]))
    const { result, unmount } = mount()
    ready()
    expect(requests()).toEqual([])
    act(() => result.current.backend.addStandardDie('d6'))
    ack(requests())
    const id = requests()[0].id
    act(() => result.current.backend.clearAll())
    expect(JSON.parse(localStorage.getItem(key)!).dice).toHaveLength(1)
    act(() => useMultiplayerStore.getState().handleServerMessage({ type: 'dice_removed', diceIds: [id] }))
    expect(localStorage.getItem(key)).toBe(encodeSoloTable([]))
    unmount()
    useMultiplayerStore.getState().reset()
    send.mockReset()
    const next = mount(); ready()
    expect(requests()).toEqual([])
    next.unmount()
  })

  it.each(['{broken', JSON.stringify({ version: 9, dice: [] })])('preserves rejected source bytes on passive boot but permits a later acknowledged table edit', raw => {
    localStorage.setItem(key, raw)
    const { result, unmount } = mount(); ready(); ack(requests())
    expect(localStorage.getItem(key)).toBe(raw)
    act(() => result.current.backend.addStandardDie('d4'))
    ack(requests().slice(1))
    expect(JSON.parse(localStorage.getItem(key)!).dice).toHaveLength(2)
    unmount()
  })

  it('does not overwrite missing catalog source with its playable basic fallback', () => {
    const raw = JSON.stringify({ version: 1, dice: [{ shape: 'd6', presentation: { customAssetId: 'gone/d6', customAssetVersionId: 'gone' } }] })
    localStorage.setItem(key, raw)
    const { unmount } = mount(); ready(); ack(requests())
    expect(requests()[0].presentation).toMatchObject({ basic: true })
    expect(localStorage.getItem(key)).toBe(raw)
    unmount()
  })

  it('never restores or persists remote rooms and foreign dice', () => {
    const { unmount } = mount(); ready('ws://remote')
    expect(requests()).toEqual([])
    expect(localStorage.getItem(key)).toBeNull()
    ready(); ack(requests())
    const stored = localStorage.getItem(key)
    ack([{ id: 'foreign', diceType: 'd8' }], 'p2')
    expect(localStorage.getItem(key)).toBe(stored)
    unmount()
    ack([{ id: 'late', diceType: 'd12' }])
    expect(localStorage.getItem(key)).toBe(stored)
  })

  it('does not truncate a restore on send refusal and retries from the original saved loadout on a new socket', () => {
    const raw = encodeSoloTable([{ shape: 'd6', presentation: { basic: true } }, { shape: 'd8', presentation: { basic: true } }])
    localStorage.setItem(key, raw)
    send.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('send failed') })
    const { result, unmount } = mount(); ready()
    expect(result.current.error).toMatch(/Could not restore/)
    ack(requests().slice(0, 1))
    expect(localStorage.getItem(key)).toBe(raw)
    act(() => useMultiplayerStore.getState().reset())
    send.mockReset()
    ready()
    expect(requests().map(d => d.diceType)).toEqual(['d6', 'd8'])
    ack(requests())
    expect(result.current.error).toBeNull()
    expect(localStorage.getItem(key)).toBe(raw)
    unmount()
  })

  it('preserves an admitted percentile pair through the native restoration requests', () => {
    localStorage.setItem(key, encodeSoloTable([
      { shape: 'd10tens', presentation: { basic: true, percentilePairId: 'saved-pair', percentileRole: 'tens' } },
      { shape: 'd10', presentation: { basic: true, percentilePairId: 'saved-pair', percentileRole: 'ones' } },
    ]))
    const { unmount } = mount(); ready()
    expect(requests().map(d => [d.presentation?.percentilePairId, d.presentation?.percentileRole])).toEqual([['saved-pair', 'tens'], ['saved-pair', 'ones']])
    ack(requests()); unmount()
  })

  it('surfaces an asynchronous bootstrap rejection without replacing the saved loadout', () => {
    const raw = encodeSoloTable([{ shape: 'd6', presentation: { basic: true } }])
    localStorage.setItem(key, raw)
    const { result, unmount } = mount(); ready()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => useMultiplayerStore.getState().handleServerMessage({ type: 'error', code: 'DICE_LIMIT', message: 'Too many dice' }))
    expect(result.current.error).toMatch(/Could not restore/)
    expect(localStorage.getItem(key)).toBe(raw)
    unmount()
  })

  it('does not persist an empty or partial table when attaching while a native spawn is awaiting its echo', () => {
    ready()
    act(() => useMultiplayerStore.getState().spawnDice('d8', { basic: true }))
    const { unmount } = mount()
    expect(requests()).toHaveLength(1)
    expect(localStorage.getItem(key)).toBeNull()
    ack(requests())
    expect(JSON.parse(localStorage.getItem(key)!).dice.map((d: { shape: string }) => d.shape)).toEqual(['d8'])
    unmount()
  })

  it('refuses a previous account inventory view even when the saved ID matches', () => {
    const owned = useInventoryStore.getState().addDie({ id: 'other-copy', type: 'd6', setId: 'starter', rarity: 'rare', name: 'Other account', appearance: { baseColor: '#123456', accentColor: '#ffffff', material: 'wood' }, vfx: {}, source: 'starter', isFavorite: false, isLocked: false })
    useInventoryStore.setState({ dice: [{ ...owned, serverCopyMetadata: { isFirstCopy: true } }], serverCopiesActive: true })
    useWalletStore.setState({ userId: 'account-a' })
    useAuthStore.setState({ status: 'authenticated', user: { id: 'account-b' } as User })
    localStorage.setItem('dicesuki-solo-table:v1:user:account-b', encodeSoloTable([{ shape: 'd6', presentation: { inventoryDieId: 'other-copy' } }]))
    const { unmount } = mount(); ready()
    expect(requests()[0].presentation).toMatchObject({ basic: true })
    expect(requests()[0].presentation).not.toHaveProperty('inventoryDieId')
    unmount()
  })

  it('waits for account identity and cannot write an old scope from a later callback', () => {
    useAuthStore.setState({ status: 'loading', user: null })
    const { unmount } = mount(); ready()
    expect(requests()).toEqual([])
    act(() => useAuthStore.setState({ status: 'authenticated', user: { id: 'account-a' } as User }))
    expect(currentSoloTableScope()).toBe('dicesuki-solo-table:v1:user:account-a')
    ack(requests())
    const old = localStorage.getItem(currentSoloTableScope()!)
    act(() => useAuthStore.setState({ status: 'authenticated', user: { id: 'account-b' } as User }))
    ack([{ id: 'late-old', diceType: 'd12' }])
    expect(localStorage.getItem('dicesuki-solo-table:v1:user:account-a')).toBe(old)
    expect(localStorage.getItem('dicesuki-solo-table:v1:user:account-b')).toBeNull()
    unmount()
  })
})
