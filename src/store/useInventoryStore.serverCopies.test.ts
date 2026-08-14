import { beforeEach, describe, expect, it } from 'vitest'
import { COLLECTIBLE_CATALOG } from '../lib/collectibleCatalog'
import { createRealTargets } from '../lib/dataSync'
import type { NewInventoryDie } from '../types/inventory'
import {
  migratePersistedInventory,
  migratePersistedInventoryState,
  useInventoryStore,
} from './useInventoryStore'
import { useSavedRollsStore } from './useSavedRollsStore'

const makeNewDie = (overrides: Partial<NewInventoryDie> = {}): NewInventoryDie => ({
  type: 'd6',
  setId: 'test-set',
  rarity: 'common',
  appearance: {
    baseColor: '#ffffff',
    accentColor: '#000000',
    material: 'plastic',
  },
  vfx: {},
  name: 'Test Die',
  isFavorite: false,
  isLocked: false,
  // Deliberately NOT 'starter': the v4 -> v5 migration deletes seeded starter
  // rows, so a default of 'starter' would silently make every unrelated
  // persistence test a test of that deletion. Starter rows get their own tests.
  source: 'gacha_standard',
  assignedToRolls: [],
  ...overrides,
})

function liveGroup(itemId: string, copyId = 'server-copy-id') {
  return {
    [itemId]: {
      catalogItemId: itemId,
      liveCount: 1,
      everOwned: true,
      firstCopyAcquiredAt: '2026-07-20T00:00:00Z',
      copies: [{
        id: copyId,
        grantIdempotencyKey: `reward:${copyId}`,
        sourceKind: 'reward' as const,
        acquiredAt: '2026-07-20T00:00:00Z',
        isFirstCopy: true,
      }],
    },
  }
}

describe('useInventoryStore server-copy slice', () => {
  beforeEach(() => {
    localStorage.clear()
    useInventoryStore.getState().reset()
  })

  it('overlays complete server copies and restores local dice plus assignments', () => {
    const local = useInventoryStore.getState().addDie(makeNewDie({
      id: 'local-guest-die',
      name: 'Guest die',
    }))
    useInventoryStore.getState().assignDieToSlot('roll-1', 'entry-1', 0, local.id)
    const localAssignments = { ...useInventoryStore.getState().assignments }
    const item = COLLECTIBLE_CATALOG.items[0]

    expect(
      useInventoryStore.getState().syncServerCopies(
        liveGroup(item.id),
        COLLECTIBLE_CATALOG,
      ),
    ).toBe(true)
    expect(useInventoryStore.getState()).toMatchObject({
      serverCopiesActive: true,
      assignments: localAssignments,
      localAssignments,
    })
    expect(useInventoryStore.getState().dice.map(die => die.id)).toEqual([
      local.id,
      'server-copy-id',
    ])
    expect(useInventoryStore.getState().dice[1].serverCopyMetadata).toEqual({
      isFirstCopy: true,
    })

    const persisted = JSON.parse(
      localStorage.getItem('dicesuki-player-inventory') ?? '{}',
    ) as { state?: { assignments?: Record<string, string> } }
    expect(persisted.state?.assignments).toEqual(localAssignments)
    expect(JSON.stringify(persisted)).not.toContain('serverCopyMetadata')

    useInventoryStore.getState().clearServerCopies()
    expect(useInventoryStore.getState()).toMatchObject({
      serverCopiesActive: false,
      assignments: localAssignments,
    })
    expect(useInventoryStore.getState().dice.map(die => die.id)).toEqual([local.id])
  })

  it('does not publish or replace state when clearing inactive server copies', () => {
    const stateBeforeClear = useInventoryStore.getState()
    let notificationCount = 0
    const unsubscribe = useInventoryStore.subscribe(() => {
      notificationCount += 1
    })

    stateBeforeClear.clearServerCopies()
    const stateAfterClear = useInventoryStore.getState()
    unsubscribe()

    expect(notificationCount).toBe(0)
    expect(stateAfterClear).toBe(stateBeforeClear)
  })

  it('leaves the inventory empty when the authoritative copy read is empty', () => {
    // The retired starter fallback re-seeded 23 instances here. An empty
    // inventory is now a valid, playable state — basic dice are the floor —
    // so an empty-but-successful read must stay empty.
    expect(useInventoryStore.getState().dice).toHaveLength(0)
    expect(
      useInventoryStore.getState().syncServerCopies(
        {},
        COLLECTIBLE_CATALOG,
      ),
    ).toBe(true)
    expect(useInventoryStore.getState()).toMatchObject({
      serverCopiesActive: true,
    })
    expect(useInventoryStore.getState().dice).toHaveLength(0)
    expect(useInventoryStore.getState().localDice).toHaveLength(0)
  })

  it('adds authoritative copies once on top of the retained local rows', () => {
    const local = useInventoryStore.getState().addDie(makeNewDie({
      id: 'retained-local-die',
      source: 'gacha_standard',
    }))
    const item = COLLECTIBLE_CATALOG.items.find(
      candidate => candidate.setId !== 'adventurer-starter',
    ) ?? COLLECTIBLE_CATALOG.items[0]

    expect(
      useInventoryStore.getState().syncServerCopies(
        liveGroup(item.id, 'first-server-copy'),
        COLLECTIBLE_CATALOG,
      ),
    ).toBe(true)
    expect(useInventoryStore.getState().dice).toHaveLength(2)

    expect(
      useInventoryStore.getState().syncServerCopies(
        liveGroup(item.id, 'refreshed-server-copy'),
        COLLECTIBLE_CATALOG,
      ),
    ).toBe(true)
    expect(useInventoryStore.getState().dice).toHaveLength(2)
    expect(useInventoryStore.getState().dice.map(die => die.id)).not
      .toContain('first-server-copy')
    expect(useInventoryStore.getState().dice.map(die => die.id))
      .toContain('refreshed-server-copy')

    useInventoryStore.getState().clearServerCopies()
    expect(useInventoryStore.getState().dice.map(die => die.id)).toEqual([local.id])
    expect(useInventoryStore.getState().dice.some(die => die.serverCopyMetadata))
      .toBe(false)
  })

  it('migrates v3 dice and assignments into separate retained-local fields', () => {
    const die = useInventoryStore.getState().addDie(makeNewDie({
      id: 'persisted-v3-die',
    }))
    const persisted = {
      dice: [die],
      currency: { coins: 4, gems: 3, standardTokens: 2, premiumTokens: 1 },
      assignments: { 'roll:entry:0': die.id },
    }

    const migrated = migratePersistedInventoryState(persisted, 3) as {
      dice: NewInventoryDie[]
      localDice: NewInventoryDie[]
      assignments: Record<string, string>
      localAssignments: Record<string, string>
      serverCopiesActive: boolean
    }
    expect(migrated.localDice).toEqual(migrated.dice)
    expect(migrated.localDice).not.toBe(migrated.dice)
    expect(migrated.localAssignments).toEqual(migrated.assignments)
    expect(migrated.localAssignments).not.toBe(migrated.assignments)
    expect(migrated.serverCopiesActive).toBe(false)
  })

  describe('v4 -> v5 retires the seeded starter inventory', () => {
    const starterDie = (id: string) => ({
      ...makeNewDie({ id, source: 'starter', name: `Starter ${id}` }),
      id,
      acquiredAt: 1,
      stats: { timesRolled: 0, totalValue: 0, critsRolled: 0, failsRolled: 0 },
    })
    const keptDie = (id: string) => ({
      ...makeNewDie({ id, source: 'gacha_standard', name: `Kept ${id}` }),
      id,
      acquiredAt: 2,
      stats: { timesRolled: 0, totalValue: 0, critsRolled: 0, failsRolled: 0 },
    })

    it('drops only starter rows and the assignments that named them', () => {
      const { state, removedDieIds } = migratePersistedInventory({
        dice: [starterDie('die_starter_a'), keptDie('die_reward_b')],
        localDice: [starterDie('die_starter_a'), keptDie('die_reward_b')],
        assignments: { 'roll:entry:0': 'die_starter_a', 'roll:entry:1': 'die_reward_b' },
        localAssignments: { 'roll:entry:0': 'die_starter_a' },
        currency: { coins: 4, gems: 3, standardTokens: 2, premiumTokens: 1 },
      }, 4)

      const migrated = state as {
        dice: NewInventoryDie[]
        localDice: NewInventoryDie[]
        assignments: Record<string, string>
        localAssignments: Record<string, string>
        currency: { coins: number }
      }

      expect(removedDieIds).toEqual(['die_starter_a'])
      expect(migrated.dice.map(die => die.id)).toEqual(['die_reward_b'])
      expect(migrated.localDice.map(die => die.id)).toEqual(['die_reward_b'])
      expect(migrated.assignments).toEqual({ 'roll:entry:1': 'die_reward_b' })
      expect(migrated.localAssignments).toEqual({})
      // Everything outside the starter rows is carried through untouched.
      expect(migrated.currency.coins).toBe(4)
    })

    it('still purges localDice when the payload has no dice array', () => {
      // The v1-v3 catalog pass needs `dice` to be an array and used to bail out
      // here — which skipped the starter purge entirely, so a starter row in
      // `localDice` survived and became the visible inventory on sign-out.
      const { state, removedDieIds } = migratePersistedInventory({
        localDice: [starterDie('die_starter_a'), keptDie('die_reward_b')],
        localAssignments: { 'roll:entry:0': 'die_starter_a' },
      }, 4)

      const migrated = state as {
        localDice: NewInventoryDie[]
        localAssignments: Record<string, string>
      }
      expect(removedDieIds).toEqual(['die_starter_a'])
      expect(migrated.localDice.map(die => die.id)).toEqual(['die_reward_b'])
      expect(migrated.localAssignments).toEqual({})
    })

    it('normalizes a missing localDice to an empty array when purging', () => {
      // A pre-v4 payload has no `localDice` at all; leaving it undefined would
      // hand the store a shape it does not expect.
      const { state } = migratePersistedInventory({
        dice: [starterDie('die_starter_a')],
        assignments: {},
      }, 4)

      expect((state as { localDice: unknown }).localDice).toEqual([])
      expect((state as { dice: unknown[] }).dice).toEqual([])
    })

    it('is a no-op for an inventory with no starter rows', () => {
      const persisted = {
        dice: [keptDie('die_reward_b')],
        localDice: [keptDie('die_reward_b')],
        assignments: {},
        localAssignments: {},
      }
      const { state, removedDieIds } = migratePersistedInventory(persisted, 4)

      expect(removedDieIds).toEqual([])
      expect(state).toBe(persisted)
    })

    it('rehydrates a v4 payload through the real middleware and rewrites saved rolls', async () => {
      const specificEntry = {
        id: 'entry-1',
        type: 'd4' as const,
        quantity: 2,
        sources: [
          { kind: 'specific' as const, dieId: 'die_starter_a' },
          { kind: 'specific' as const, dieId: 'die_reward_b' },
        ],
      }
      localStorage.setItem('dicesuki-saved-rolls', JSON.stringify({
        state: {
          savedRolls: [{
            id: 'roll-1',
            name: 'Starter roll',
            dice: [specificEntry],
            flatBonus: 0,
            createdAt: 1,
          }],
          currentlyEditing: null,
        },
        version: 1,
      }))
      await useSavedRollsStore.persist.rehydrate()

      localStorage.setItem('dicesuki-player-inventory', JSON.stringify({
        state: {
          dice: [starterDie('die_starter_a'), keptDie('die_reward_b')],
          localDice: [starterDie('die_starter_a'), keptDie('die_reward_b')],
          assignments: { 'roll-1:entry-1:0': 'die_starter_a' },
          localAssignments: { 'roll-1:entry-1:0': 'die_starter_a' },
          currency: { coins: 0, gems: 0, standardTokens: 0, premiumTokens: 0 },
          serverCopiesActive: false,
        },
        version: 4,
      }))

      await useInventoryStore.persist.rehydrate()

      expect(useInventoryStore.getState().dice.map(die => die.id)).toEqual(['die_reward_b'])
      expect(useInventoryStore.getState().assignments).toEqual({})

      // The roll survives; only the source naming the deleted die is rewritten,
      // and it will spawn as a basic die.
      expect(useSavedRollsStore.getState().savedRolls[0].dice[0].sources).toEqual([
        { kind: 'anonymous', quantity: 1 },
        { kind: 'specific', dieId: 'die_reward_b' },
      ])
    })
  })

  describe('v5 -> v6 purges retired customer dice', () => {
    const bundledAsset = () => ({
      modelUrl: '/dice/example/model.glb',
      storage: 'bundled' as const,
      metadata: {
        version: '1.0', diceType: 'd6' as const, name: 'Example', artist: 'Dicesuki',
        created: '2026-08-14', scale: 1, faceNormals: [],
        physics: { density: 1, restitution: 0.3, friction: 0.6 },
        colliderType: 'roundCuboid' as const, colliderArgs: {},
      },
    })

    it('removes custom-artist, IndexedDB, and missing-storage rows plus assignments', () => {
      const customArtist = {
        ...makeNewDie({ id: 'custom-artist-die', setId: 'custom-artist' }),
        id: 'custom-artist-die', acquiredAt: 1,
      }
      const indexedDb = {
        ...makeNewDie({
          id: 'indexeddb-die',
          customAsset: { ...bundledAsset(), storage: 'indexeddb' } as never,
        }),
        id: 'indexeddb-die', acquiredAt: 2,
      }
      const missingStorage = {
        ...makeNewDie({
          id: 'missing-storage-die',
          customAsset: { ...bundledAsset(), storage: undefined },
        }),
        id: 'missing-storage-die', acquiredAt: 3,
      }
      const bundled = {
        ...makeNewDie({ id: 'bundled-die', customAsset: bundledAsset() }),
        id: 'bundled-die', acquiredAt: 4,
      }

      const { state, removedDieIds } = migratePersistedInventory({
        dice: [customArtist, indexedDb, missingStorage, bundled],
        localDice: [customArtist, indexedDb, missingStorage, bundled],
        assignments: {
          artist: customArtist.id,
          indexeddb: indexedDb.id,
          missing: missingStorage.id,
          bundled: bundled.id,
        },
        localAssignments: { artist: customArtist.id, bundled: bundled.id },
      }, 5)
      const migrated = state as {
        dice: NewInventoryDie[]
        localDice: NewInventoryDie[]
        assignments: Record<string, string>
        localAssignments: Record<string, string>
      }

      expect(removedDieIds).toEqual([
        customArtist.id, indexedDb.id, missingStorage.id,
      ])
      expect(migrated.dice.map(die => die.id)).toEqual([bundled.id])
      expect(migrated.localDice.map(die => die.id)).toEqual([bundled.id])
      expect(migrated.assignments).toEqual({ bundled: bundled.id })
      expect(migrated.localAssignments).toEqual({ bundled: bundled.id })
    })

    it('never publishes a stale legacy row through the inventory sync payload', () => {
      const retired = useInventoryStore.getState().addDie(makeNewDie({
        id: 'stale-indexeddb',
        customAsset: { ...bundledAsset(), storage: 'indexeddb' } as never,
      }))
      const bundled = useInventoryStore.getState().addDie(makeNewDie({
        id: 'bundled-sync', customAsset: bundledAsset(),
      }))
      useInventoryStore.getState().assignDieToSlot('roll', 'entry', 0, retired.id)
      useInventoryStore.getState().assignDieToSlot('roll', 'entry', 1, bundled.id)

      const target = createRealTargets().find(candidate => candidate.table === 'inventory')
      const payload = target?.getPayload() as {
        v: number
        dice: NewInventoryDie[]
        assignments: Record<string, string>
      }
      expect(payload.v).toBe(6)
      expect(payload.dice.map(die => die.id)).toEqual([bundled.id])
      expect(payload.assignments).toEqual({ 'roll:entry:1': bundled.id })
    })
  })

  it.each([3, 1])(
    'rehydrates persisted v%s through the actual persist middleware migration',
    async (version) => {
      const die = {
        ...makeNewDie({ id: `persisted-v${version}-die` }),
        id: `persisted-v${version}-die`,
        acquiredAt: 123,
        stats: {
          timesRolled: 0,
          totalValue: 0,
          critsRolled: 0,
          failsRolled: 0,
        },
      }
      const assignments = { 'roll:entry:0': die.id }
      localStorage.setItem(
        'dicesuki-player-inventory',
        JSON.stringify({
          state: {
            dice: [die],
            currency: { coins: 4, gems: 3, standardTokens: 2, premiumTokens: 1 },
            assignments,
          },
          version,
        }),
      )

      await useInventoryStore.persist.rehydrate()

      expect(useInventoryStore.getState()).toMatchObject({
        dice: [expect.objectContaining({ id: die.id })],
        localDice: [expect.objectContaining({ id: die.id })],
        assignments,
        localAssignments: assignments,
        serverCopiesActive: false,
      })
    },
  )

  it('retains the local view when any live copy cannot join completely', () => {
    const local = useInventoryStore.getState().addDie(makeNewDie({
      id: 'local-before-failed-sync',
    }))
    const validItem = COLLECTIBLE_CATALOG.items[0]
    const unknownItemId = 'missing/item@1'
    const copies = {
      ...liveGroup(validItem.id, 'valid-copy'),
      ...liveGroup(unknownItemId, 'unjoinable-copy'),
    }

    expect(
      useInventoryStore.getState().syncServerCopies(
        copies,
        COLLECTIBLE_CATALOG,
      ),
    ).toBe(false)
    expect(useInventoryStore.getState().serverCopiesActive).toBe(false)
    expect(useInventoryStore.getState().dice.map(die => die.id)).toEqual([local.id])

    const catalogWithoutAsset = {
      ...COLLECTIBLE_CATALOG,
      assetVersions: COLLECTIBLE_CATALOG.assetVersions.filter(
        asset => asset.id !== validItem.assetVersionId,
      ),
    }
    expect(
      useInventoryStore.getState().syncServerCopies(
        liveGroup(validItem.id),
        catalogWithoutAsset,
      ),
    ).toBe(false)
    expect(
      useInventoryStore.getState().syncServerCopies(
        liveGroup(validItem.id),
        null,
      ),
    ).toBe(false)
    expect(useInventoryStore.getState().dice.map(die => die.id)).toEqual([local.id])
  })

  it('retains visible local mutations across refresh, persistence, and sign-out', () => {
    const baseline = useInventoryStore.getState().addDie(makeNewDie({
      id: 'baseline-local-die',
      source: 'gacha_standard',
    }))
    const item = COLLECTIBLE_CATALOG.items[0]
    expect(useInventoryStore.getState().syncServerCopies(
      liveGroup(item.id),
      COLLECTIBLE_CATALOG,
    )).toBe(true)

    const added = useInventoryStore.getState().addDie(makeNewDie({
      id: 'local-added-while-signed-in',
      name: 'Before rename',
    }))
    useInventoryStore.getState().renameDie(added.id, 'After rename')
    useInventoryStore.getState().assignDieToSlot(
      'roll-2',
      'entry-2',
      0,
      added.id,
    )

    const inventoryTarget = createRealTargets().find(
      target => target.table === 'inventory',
    )
    const payload = inventoryTarget?.getPayload() as {
      dice: NewInventoryDie[]
      assignments: Record<string, string>
    }
    expect(payload.dice.map(die => die.id)).toEqual([baseline.id, added.id])
    expect(payload.dice).toContainEqual(
      expect.objectContaining({ id: added.id, name: 'After rename' }),
    )
    expect(payload.dice.map(die => die.id)).not.toContain('server-copy-id')
    expect(payload.assignments).toEqual({
      'roll-2:entry-2:0': added.id,
    })

    expect(useInventoryStore.getState().syncServerCopies(
      liveGroup(item.id, 'refreshed-copy'),
      COLLECTIBLE_CATALOG,
    )).toBe(true)
    expect(useInventoryStore.getState().dice).toContainEqual(
      expect.objectContaining({ id: added.id, name: 'After rename' }),
    )

    const persisted = JSON.parse(
      localStorage.getItem('dicesuki-player-inventory') ?? '{}',
    ) as { state?: { dice?: NewInventoryDie[]; assignments?: Record<string, string> } }
    expect(persisted.state?.dice).toContainEqual(
      expect.objectContaining({ id: added.id, name: 'After rename' }),
    )
    expect(persisted.state?.assignments).toEqual({
      'roll-2:entry-2:0': added.id,
    })
    expect(JSON.stringify(persisted)).not.toContain('refreshed-copy')

    useInventoryStore.getState().clearServerCopies()
    expect(useInventoryStore.getState().dice).toContainEqual(
      expect.objectContaining({ id: added.id, name: 'After rename' }),
    )
    expect(useInventoryStore.getState().assignments).toEqual({
      'roll-2:entry-2:0': added.id,
    })
  })

  it('rejects an exact server/local id collision without mutating local state', () => {
    useInventoryStore.getState().addDie(makeNewDie({
      id: 'collision-baseline-die',
      source: 'gacha_standard',
    }))
    const item = COLLECTIBLE_CATALOG.items[0]
    expect(useInventoryStore.getState().syncServerCopies(
      liveGroup(item.id, 'existing-server-copy'),
      COLLECTIBLE_CATALOG,
    )).toBe(true)

    const local = useInventoryStore.getState().addDie(makeNewDie({
      id: 'colliding-copy-id',
      name: 'Local collision sentinel',
    }))
    useInventoryStore.getState().assignDieToSlot(
      'roll-collision',
      'entry-collision',
      0,
      local.id,
    )

    expect(useInventoryStore.getState().syncServerCopies(
      liveGroup(item.id, local.id),
      COLLECTIBLE_CATALOG,
    )).toBe(false)
    expect(useInventoryStore.getState()).toMatchObject({
      serverCopiesActive: true,
      assignments: {
        'roll-collision:entry-collision:0': local.id,
      },
    })
    expect(useInventoryStore.getState().dice).toHaveLength(3)
    const retainedCollision = useInventoryStore.getState().dice.find(
      die => die.id === local.id,
    )
    expect(retainedCollision).toMatchObject({
      id: local.id,
      name: 'Local collision sentinel',
    })
    expect(retainedCollision?.serverCopyMetadata).toBeUndefined()
    expect(useInventoryStore.getState().dice).toContainEqual(
      expect.objectContaining({
        id: 'existing-server-copy',
        serverCopyMetadata: { isFirstCopy: true },
      }),
    )

    const persisted = JSON.parse(
      localStorage.getItem('dicesuki-player-inventory') ?? '{}',
    ) as { state?: { dice?: NewInventoryDie[]; assignments?: Record<string, string> } }
    expect(persisted.state?.dice).toContainEqual(
      expect.objectContaining({ id: local.id, name: 'Local collision sentinel' }),
    )
    expect(persisted.state?.assignments).toEqual({
      'roll-collision:entry-collision:0': local.id,
    })
    expect(JSON.stringify(persisted)).not.toContain('serverCopyMetadata')
  })
})
