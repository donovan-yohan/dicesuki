import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetDataSyncForTests, getInventoryHydration, startSync, stopSync, subscribeInventoryHydration } from './dataSync'
import { controlledInventoryClient } from '../test/controlledInventoryClient'
import { useInventoryStore } from '../store/useInventoryStore'

beforeEach(() => { __resetDataSyncForTests(); localStorage.clear(); useInventoryStore.getState().reset() })
afterEach(() => { __resetDataSyncForTests(); vi.useRealTimers() })

describe('actual copy hydration lifecycle receipt', () => {
  it('publishes pending synchronously and ready only after both readers and accepted inventory join', async () => {
    const fake = controlledInventoryClient()
    const sync = startSync('a', { client: fake.client, targets: [] })
    await waitFor(() => expect(fake.tables).toContain('dice_copies'))
    const pending = getInventoryHydration()
    expect(pending).toMatchObject({ userId: 'a', status: 'pending' })
    await fake.copiesRequested
    fake.acceptCopies()
    await Promise.resolve()
    expect(getInventoryHydration()).toBe(pending)
    fake.acceptCatalog()
    await sync
    expect(getInventoryHydration()).toEqual({ ...pending, status: 'ready' })
    expect(useInventoryStore.getState().dice.map(die => die.id)).toEqual(['server-copy-mine'])
  })

  it('publishes accepted copy ownership without waiting for the unrelated wallet read', async () => {
    const fake = controlledInventoryClient(true)
    const sync = startSync('a', { client: fake.client, targets: [] })
    await fake.copiesRequested
    fake.acceptCatalog(); fake.acceptCopies()
    try {
      await waitFor(() => expect(getInventoryHydration().status).toBe('ready'))
      expect(useInventoryStore.getState().dice.map(die => die.id)).toEqual(['server-copy-mine'])
    } finally { fake.wallet.resolve({ data: null, error: null }); await sync }
  })

  it('a successful empty read is ready, not failed or pending', async () => {
    const fake = controlledInventoryClient()
    const sync = startSync('a', { client: fake.client, targets: [] })
    fake.acceptCatalog(); fake.acceptCopies([])
    await sync
    expect(getInventoryHydration()).toMatchObject({ userId: 'a', status: 'ready' })
    expect(useInventoryStore.getState().serverCopiesActive).toBe(true)
    expect(useInventoryStore.getState().dice).toEqual([])
  })

  it.each(['copies', 'catalog', 'join'] as const)('reports %s failure as unavailable, never resolved-missing', async failure => {
    const fake = controlledInventoryClient()
    const sync = startSync('a', { client: fake.client, targets: [] })
    if (failure === 'copies') fake.copies.resolve({ data: null, error: { message: 'offline' } })
    else fake.acceptCopies()
    if (failure === 'catalog') fake.catalog.resolve({ data: null, error: { message: 'offline' } })
    else if (failure === 'join') fake.catalog.resolve({ data: [], error: null })
    else fake.acceptCatalog()
    await sync
    expect(getInventoryHydration()).toMatchObject({ userId: 'a', status: 'unavailable' })
    expect(useInventoryStore.getState().serverCopiesActive).toBe(false)
  })

  it('bounds a hung read as unresolved and can later accept the real current result', async () => {
    vi.useFakeTimers()
    const fake = controlledInventoryClient()
    const sync = startSync('a', { client: fake.client, targets: [] })
    await fake.copiesRequested
    await vi.advanceTimersByTimeAsync(2999)
    expect(getInventoryHydration().status).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(getInventoryHydration().status).toBe('unavailable')
    fake.acceptCatalog(); fake.acceptCopies()
    await sync
    expect(getInventoryHydration().status).toBe('ready')
  })

  it('stop and account ABA retire old completion and never inherit same-account readiness', async () => {
    const old = controlledInventoryClient()
    const oldSync = startSync('a', { client: old.client, targets: [] })
    await old.copiesRequested
    const previous = getInventoryHydration()
    const middle = controlledInventoryClient()
    const middleSync = startSync('b', { client: middle.client, targets: [] })
    await middle.copiesRequested
    const fresh = controlledInventoryClient()
    const freshSync = startSync('a', { client: fresh.client, targets: [] })
    await fresh.copiesRequested
    const replacement = getInventoryHydration()
    expect(replacement).toMatchObject({ userId: 'a', status: 'pending' })
    expect(replacement.generation).toBeGreaterThan(previous.generation)
    old.acceptCatalog(); old.acceptCopies(['old-copy'])
    middle.acceptCatalog(); middle.acceptCopies(['middle-copy'])
    await Promise.all([oldSync, middleSync])
    expect(getInventoryHydration()).toBe(replacement)
    expect(useInventoryStore.getState().dice).toEqual([])
    fresh.acceptCatalog(); fresh.acceptCopies(['fresh-copy']); await freshSync
    expect(getInventoryHydration().status).toBe('ready')
    expect(useInventoryStore.getState().dice.map(die => die.id)).toEqual(['fresh-copy'])
    stopSync()
    expect(getInventoryHydration()).toMatchObject({ userId: null, status: 'idle' })
  })

  it('stopping during the inventory join cannot publish a stale ready receipt', async () => {
    const fake = controlledInventoryClient()
    const unsubscribe = useInventoryStore.subscribe(state => { if (state.serverCopiesActive) stopSync() })
    try {
      const sync = startSync('a', { client: fake.client, targets: [] })
      fake.acceptCatalog(); fake.acceptCopies(); await sync
      expect(getInventoryHydration()).toMatchObject({ userId: null, status: 'idle' })
      expect(useInventoryStore.getState().serverCopiesActive).toBe(false)
    } finally { unsubscribe() }
  })

  it('an account switch does not overwrite a newer start reentered from stop publication', async () => {
    const old = controlledInventoryClient()
    const oldSync = startSync('a', { client: old.client, targets: [] })
    old.acceptCatalog(); old.acceptCopies(); await oldSync
    const fresh = controlledInventoryClient()
    const superseded = controlledInventoryClient()
    let replacement: Promise<void> | undefined
    const unsubscribe = subscribeInventoryHydration(state => {
      if (state.status === 'idle') replacement = startSync('c', { client: fresh.client, targets: [] })
    })
    try {
      const switched = startSync('b', { client: superseded.client, targets: [] })
      expect(getInventoryHydration()).toMatchObject({ userId: 'c', status: 'pending' })
      expect(superseded.tables).toEqual([])
      fresh.acceptCatalog(); fresh.acceptCopies(['fresh-copy'])
      await Promise.all([replacement, switched])
      expect(getInventoryHydration()).toMatchObject({ userId: 'c', status: 'ready' })
    } finally { unsubscribe(); superseded.acceptCatalog(); superseded.acceptCopies([]) }
  })

  it('a stop observer can synchronously restart the same account without inheriting the old ready view', async () => {
    const old = controlledInventoryClient()
    const oldSync = startSync('a', { client: old.client, targets: [] })
    old.acceptCatalog(); old.acceptCopies(); await oldSync
    const previous = getInventoryHydration()
    const fresh = controlledInventoryClient()
    let replacement: Promise<void> | undefined
    const unsubscribe = subscribeInventoryHydration(state => {
      if (state.status === 'idle') replacement = startSync('a', { client: fresh.client, targets: [] })
    })
    try {
      stopSync()
      expect(getInventoryHydration()).toMatchObject({ userId: 'a', status: 'pending' })
      expect(getInventoryHydration().generation).toBeGreaterThan(previous.generation)
      fresh.acceptCatalog(); fresh.acceptCopies(['fresh-copy']); await replacement
      expect(useInventoryStore.getState().dice.map(die => die.id)).toEqual(['fresh-copy'])
    } finally { unsubscribe() }
  })

  it('a readiness subscriber may replace the account synchronously without old startup admission', async () => {
    const old = controlledInventoryClient()
    const fresh = controlledInventoryClient()
    let replacement: Promise<void> | undefined
    const unsubscribe = subscribeInventoryHydration(state => {
      if (state.userId === 'a' && state.status === 'pending') {
        stopSync()
        replacement = startSync('b', { client: fresh.client, targets: [] })
      }
    })
    try {
      await startSync('a', { client: old.client, targets: [] })
      await fresh.copiesRequested
      expect(old.tables).toEqual([])
      fresh.acceptCatalog(); fresh.acceptCopies(); await replacement
      expect(getInventoryHydration()).toMatchObject({ userId: 'b', status: 'ready' })
    } finally { unsubscribe() }
  })
})
