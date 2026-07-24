import { describe, expect, it, vi } from 'vitest'
import type { CollectibleCatalog } from '../types/catalog'
import type { InventoryDie } from '../types/inventory'
import type {
  PullIntent,
  PullPrepareReceipt,
  PullRevealReceipt,
  PullRevealResult,
} from '../types/pull'
import type { DiceCopiesByCatalogItem } from './diceCopies'
import {
  INITIAL_PULL_FLOW_STATE,
  PULL_SESSION_STORAGE_KEY,
  assemblePullReveal,
  clearPersistedPullSession,
  createPullInventorySnapshot,
  createPullIntent,
  derivePullCtaState,
  derivePullVerification,
  persistPullSession,
  readPersistedPullSession,
  reducePullFlow,
  summarizePullReveal,
  toPersistedPullSession,
} from './pullFlow'

const intent: PullIntent = {
  ownerId: 'user-a',
  bannerVersionId: 'standard-banner@2',
  pullCount: 1,
  idempotencyKey: 'pull:11111111-1111-4111-8111-111111111111',
  createdAt: '2026-07-24T00:00:00.000Z',
}
const preparation: PullPrepareReceipt = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  bannerVersionId: intent.bannerVersionId,
  pullCount: 1,
  heldAmount: 1,
  preparedAt: '2026-07-24T00:00:01.000Z',
  expiresAt: '2026-07-24T00:02:01.000Z',
  commitmentScheme: 'sha256-result-v1+sha256-root-v1',
  commitmentRoot: 'a'.repeat(64),
  rngScheme: 'hmac-sha256-seed-v1',
}

function result(overrides: Partial<PullRevealResult> = {}): PullRevealResult {
  return {
    position: 1,
    catalogItemId: 'item-a',
    tierId: 'signature',
    tierRank: 3,
    selectedTargetCatalogItemId: null,
    reason: 'base',
    rareBefore: 0,
    rareAfter: 0,
    epicBefore: 0,
    epicAfter: 0,
    selectedBefore: 0,
    selectedAfter: 0,
    isDuplicate: false,
    isFirstCopy: true,
    duplicateDustAmount: 0,
    nonce: 'b'.repeat(64),
    commitment: 'c'.repeat(64),
    ...overrides,
  }
}

function receipt(results = [result()]): PullRevealReceipt {
  return {
    sessionId: preparation.sessionId,
    bannerVersionId: preparation.bannerVersionId,
    pullCount: results.length === 10 ? 10 : 1,
    heldAmount: results.length,
    committedAt: '2026-07-24T00:00:02.000Z',
    commitmentScheme: preparation.commitmentScheme,
    commitmentRoot: preparation.commitmentRoot,
    rngScheme: preparation.rngScheme,
    rngSeed: 'd'.repeat(64),
    results,
  }
}

describe('derivePullCtaState', () => {
  it('derives states A-D from auth and live balances', () => {
    expect(derivePullCtaState({
      signedIn: false, pullCount: 1, availableTickets: 99, promotionalStars: 99,
    }).kind).toBe('sign-in')
    expect(derivePullCtaState({
      signedIn: true, pullCount: 10, availableTickets: 10, promotionalStars: 0,
    })).toMatchObject({ kind: 'tickets', ticketDeficit: 0 })
    expect(derivePullCtaState({
      signedIn: true, pullCount: 10, availableTickets: 3, promotionalStars: 1120,
    })).toMatchObject({ kind: 'convert', ticketDeficit: 7, starsRequired: 1120 })
    expect(derivePullCtaState({
      signedIn: true, pullCount: 10, availableTickets: 3, promotionalStars: 1119,
    })).toMatchObject({
      kind: 'insufficient',
      ticketDeficit: 7,
      largestAffordablePull: 1,
    })
  })
})

describe('pull flow state machine', () => {
  it('permits prepare → sealing → hold → reveal and ignores impossible events', () => {
    let state = reducePullFlow(INITIAL_PULL_FLOW_STATE, { type: 'START', intent })
    state = reducePullFlow(state, {
      type: 'PREPARED',
      receipt: preparation,
      sealingStartedAt: 100,
    })
    expect(state.status).toBe('sealing')
    state = reducePullFlow(state, { type: 'HOLD_SLOW' })
    expect(state.status).toBe('hold')
    state = reducePullFlow(state, { type: 'REVEALED', reveal: receipt() })
    expect(state.status).toBe('revealed')
    expect(reducePullFlow(state, { type: 'CANCELLED' })).toBe(state)
  })

  it('models cancellation without clearing a live session early', () => {
    let state = reducePullFlow(INITIAL_PULL_FLOW_STATE, { type: 'START', intent })
    state = reducePullFlow(state, {
      type: 'PREPARED',
      receipt: preparation,
      sealingStartedAt: 100,
    })
    state = reducePullFlow(state, { type: 'CANCEL_STARTED' })
    expect(state.status).toBe('cancelling')
    state = reducePullFlow(state, { type: 'CANCELLED' })
    expect(state).toEqual({ status: 'cancelled', message: 'No rolls spent.' })
  })
})

describe('pull intent persistence', () => {
  it('keeps one stable idempotency key through intent and prepared lifecycle', () => {
    const storage = new Map<string, string>()
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
    }
    const created = createPullIntent({
      ownerId: intent.ownerId,
      bannerVersionId: intent.bannerVersionId,
      pullCount: 1,
      now: 0,
      randomUUID: () => '22222222-2222-4222-8222-222222222222',
    })
    persistPullSession(toPersistedPullSession(created, null, 'intent'), adapter)
    expect(readPersistedPullSession(created.ownerId, adapter)?.intent.idempotencyKey)
      .toBe(created.idempotencyKey)
    persistPullSession(
      toPersistedPullSession(created, { ...preparation, bannerVersionId: created.bannerVersionId }, 'prepared'),
      adapter,
    )
    expect(readPersistedPullSession(created.ownerId, adapter)).toMatchObject({
      status: 'prepared',
      intent: { idempotencyKey: created.idempotencyKey },
    })
    expect(readPersistedPullSession('other-user', adapter)).toBeNull()
    clearPersistedPullSession(created.ownerId, adapter)
    expect(storage.has(PULL_SESSION_STORAGE_KEY)).toBe(false)
  })
})

describe('reveal derivations', () => {
  it('joins real first-copy, duplicate copy+Dust, exact copy id, and live count', () => {
    const duplicate = result({
      isDuplicate: true,
      isFirstCopy: false,
      duplicateDustAmount: 25,
    })
    const reveal = receipt([duplicate])
    const copies: DiceCopiesByCatalogItem = {
      'item-a': {
        catalogItemId: 'item-a',
        liveCount: 2,
        everOwned: true,
        firstCopyAcquiredAt: '2026-07-01T00:00:00Z',
        copies: [
          {
            id: 'copy-old',
            grantIdempotencyKey: 'reward:old-copy',
            sourceKind: 'reward',
            acquiredAt: '2026-07-01T00:00:00Z',
            isFirstCopy: true,
          },
          {
            id: 'copy-new',
            grantIdempotencyKey: `pull-copy-grant:${reveal.sessionId}:result:1`,
            sourceKind: 'pull',
            acquiredAt: reveal.committedAt,
            isFirstCopy: false,
          },
        ],
      },
    }
    const die = {
      id: 'copy-new',
      catalogRef: { itemId: 'item-a', assetVersionId: 'asset-a' },
      rarity: 'mythic',
    } as InventoryDie
    const catalog = {
      contractVersion: 1,
      items: [{
        id: 'item-a',
        catalogKey: 'set/d20/mythic',
        contractVersion: 1,
        itemKind: 'die',
        setId: 'set',
        diceType: 'd20',
        rarity: 'mythic',
        assetVersionId: 'asset-a',
      }],
      assetVersions: [],
    } as unknown as CollectibleCatalog
    const snapshot = createPullInventorySnapshot(copies, catalog)
    // The store mapper requires a real asset; isolate the pure receipt join.
    const assembly = assemblePullReveal(reveal, {
      catalog,
      copies,
      dice: [die],
    })
    expect(snapshot).toBeNull()
    expect(assembly.items[0]).toMatchObject({
      inventoryDieId: 'copy-new',
      liveCopyCount: 2,
      isNew: false,
      copyLine: '+1 copy (owned ×2)',
      dustLine: '+25 Dust',
      rarity: 'mythic',
    })
  })

  it('degrades one stale copy join without dropping the other committed results', () => {
    const results = Array.from({ length: 10 }, (_, index) => result({
      position: index + 1,
      catalogItemId: index === 0 ? 'item-a' : `item-${index + 1}`,
      nonce: `${index}`.repeat(64),
      commitment: `${index + 1}`.repeat(64),
    }))
    const reveal = receipt(results)
    const copies = Object.fromEntries(results.slice(1).map(entry => {
      const copyId = `copy-${entry.position}`
      return [entry.catalogItemId, {
        catalogItemId: entry.catalogItemId,
        liveCount: 1,
        everOwned: true,
        firstCopyAcquiredAt: reveal.committedAt,
        copies: [{
          id: copyId,
          grantIdempotencyKey: `pull-copy-grant:${reveal.sessionId}:result:${entry.position}`,
          sourceKind: 'pull' as const,
          acquiredAt: reveal.committedAt,
          isFirstCopy: true,
        }],
      }]
    })) as DiceCopiesByCatalogItem
    const catalog = {
      contractVersion: 1,
      items: [{
        id: 'item-a',
        catalogKey: 'ember/d20/mythic',
        contractVersion: 1,
        itemKind: 'die',
        setId: 'ember',
        diceType: 'd20',
        rarity: 'mythic',
        assetVersionId: 'asset-a',
      }],
      assetVersions: [{
        id: 'asset-a',
        catalogItemId: 'item-a',
        assetVersion: 1,
        assetKind: 'builtin',
        modelPath: 'builtin:d20',
        modelSha256: null,
        metadataSha256: 'asset-hash',
        metadata: {
          source: 'configured',
          name: 'Stale Ember d20',
          appearance: {
            baseColor: '#111111',
            accentColor: '#eeeeee',
            material: 'metal',
          },
          vfx: {},
        },
      }],
    } as unknown as CollectibleCatalog
    const dice = results.slice(1).map(entry => ({
      id: `copy-${entry.position}`,
      catalogRef: {
        itemId: entry.catalogItemId,
        assetVersionId: `asset-${entry.position}`,
      },
      rarity: 'mythic',
    })) as InventoryDie[]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const assembly = assemblePullReveal(reveal, { catalog, copies, dice })

      expect(assembly.items).toHaveLength(10)
      expect(assembly.items[0]).toMatchObject({
        inventoryDieId: null,
        liveCopyCount: null,
        copyLine: null,
        inventoryDie: { name: 'Stale Ember d20' },
      })
      expect(assembly.items.slice(1).map(item => item.inventoryDieId)).toEqual(
        results.slice(1).map(entry => `copy-${entry.position}`),
      )
      expect(warn).toHaveBeenCalledWith(
        '[pullFlow] Pull result 1 copy join degraded: missing copy group',
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('keeps a metadata-less committed row as a receipt-only placeholder', () => {
    const results = Array.from({ length: 10 }, (_, index) => result({
      position: index + 1,
      catalogItemId: `missing-or-valid-item-${index + 1}`,
      nonce: `${index}`.repeat(64),
      commitment: `${index + 1}`.repeat(64),
    }))
    const reveal = receipt(results)
    const copies = Object.fromEntries(results.slice(1).map(entry => {
      const copyId = `valid-copy-${entry.position}`
      return [entry.catalogItemId, {
        catalogItemId: entry.catalogItemId,
        liveCount: 1,
        everOwned: true,
        firstCopyAcquiredAt: reveal.committedAt,
        copies: [{
          id: copyId,
          grantIdempotencyKey: `pull-copy-grant:${reveal.sessionId}:result:${entry.position}`,
          sourceKind: 'pull' as const,
          acquiredAt: reveal.committedAt,
          isFirstCopy: true,
        }],
      }]
    })) as DiceCopiesByCatalogItem
    const dice = results.slice(1).map(entry => ({
      id: `valid-copy-${entry.position}`,
      catalogRef: {
        itemId: entry.catalogItemId,
        assetVersionId: `valid-asset-${entry.position}`,
      },
      rarity: 'mythic',
    })) as InventoryDie[]
    const catalog = {
      contractVersion: 1,
      items: [],
      assetVersions: [],
    } as unknown as CollectibleCatalog
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const assembly = assemblePullReveal(reveal, { catalog, copies, dice })

      expect(assembly.items).toHaveLength(10)
      expect(assembly.items[0]).toMatchObject({
        result: {
          position: 1,
          catalogItemId: 'missing-or-valid-item-1',
          tierId: 'signature',
        },
        rarity: null,
        inventoryDie: null,
        inventoryDieId: null,
        liveCopyCount: null,
        copyLine: null,
      })
      expect(assembly.items.slice(1).map(item => item.inventoryDieId)).toEqual(
        results.slice(1).map(entry => `valid-copy-${entry.position}`),
      )
      expect(warn).toHaveBeenCalledWith(
        '[pullFlow] Pull result 1 copy join degraded: missing copy group; catalog metadata unavailable',
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('summarizes ten pulls in rank order and discloses verification values', () => {
    const results = Array.from({ length: 10 }, (_, index) => result({
      position: index + 1,
      catalogItemId: `item-${index}`,
      tierId: index === 4 ? 'signature' : index < 4 ? 'epic' : 'standard',
      tierRank: index === 4 ? 3 : index < 4 ? 2 : 0,
      isDuplicate: index >= 3,
      isFirstCopy: index < 3,
      duplicateDustAmount: index >= 3 ? 5 : 0,
      nonce: (index % 10).toString().repeat(64),
    }))
    const reveal = receipt(results)
    expect(summarizePullReveal(reveal)).toMatchObject({
      pullCount: 10,
      newCount: 3,
      duplicateCount: 7,
      firstCopyCount: 3,
      duplicateDustTotal: 35,
      highlights: [
        { tierId: 'signature', count: 1 },
        { tierId: 'epic', count: 4 },
        { tierId: 'standard', count: 5 },
      ],
    })
    expect(derivePullVerification(reveal)).toEqual({
      commitmentRoot: reveal.commitmentRoot,
      rngSeed: reveal.rngSeed,
      rows: results.map(value => ({
        position: value.position,
        nonce: value.nonce,
        commitment: value.commitment,
      })),
    })
  })
})
