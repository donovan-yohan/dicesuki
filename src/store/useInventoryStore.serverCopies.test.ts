import { beforeEach, describe, expect, it } from 'vitest'
import { COLLECTIBLE_CATALOG } from '../lib/collectibleCatalog'
import { createRealTargets } from '../lib/dataSync'
import type { NewInventoryDie } from '../types/inventory'
import {
  migratePersistedInventoryState,
  useInventoryStore,
} from './useInventoryStore'

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
  source: 'starter',
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

  it('keeps a 23-die playable baseline when the authoritative copy read is empty', () => {
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
    expect(useInventoryStore.getState().dice).toHaveLength(23)
    expect(useInventoryStore.getState().dice.every(die => die.source === 'starter'))
      .toBe(true)
  })

  it('adds authoritative copies once on top of the retained 23-die baseline', () => {
    useInventoryStore.getState().initializeStarterDice()
    const item = COLLECTIBLE_CATALOG.items.find(
      candidate => candidate.setId !== 'adventurer-starter',
    ) ?? COLLECTIBLE_CATALOG.items[0]

    expect(
      useInventoryStore.getState().syncServerCopies(
        liveGroup(item.id, 'first-server-copy'),
        COLLECTIBLE_CATALOG,
      ),
    ).toBe(true)
    expect(useInventoryStore.getState().dice).toHaveLength(24)

    expect(
      useInventoryStore.getState().syncServerCopies(
        liveGroup(item.id, 'refreshed-server-copy'),
        COLLECTIBLE_CATALOG,
      ),
    ).toBe(true)
    expect(useInventoryStore.getState().dice).toHaveLength(24)
    expect(useInventoryStore.getState().dice.map(die => die.id)).not
      .toContain('first-server-copy')
    expect(useInventoryStore.getState().dice.map(die => die.id))
      .toContain('refreshed-server-copy')

    useInventoryStore.getState().clearServerCopies()
    expect(useInventoryStore.getState().dice).toHaveLength(23)
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

  it.each([3, 1])(
    'rehydrates persisted v%s through the actual v4 persist middleware migration',
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
    useInventoryStore.getState().initializeStarterDice()
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
    expect(payload.dice).toHaveLength(24)
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
    useInventoryStore.getState().initializeStarterDice()
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
    expect(useInventoryStore.getState().dice).toHaveLength(25)
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
