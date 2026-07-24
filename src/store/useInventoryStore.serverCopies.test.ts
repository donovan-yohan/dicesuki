import { beforeEach, describe, expect, it } from 'vitest'
import { COLLECTIBLE_CATALOG } from '../lib/collectibleCatalog'
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

  it('gives complete server copies precedence and restores local dice plus assignments', () => {
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
      assignments: {},
      localAssignments,
    })
    expect(useInventoryStore.getState().dice.map(die => die.id)).toEqual([
      'server-copy-id',
    ])
    expect(useInventoryStore.getState().dice[0].serverCopyMetadata).toEqual({
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
      useInventoryStore.getState().syncServerCopies(copies, COLLECTIBLE_CATALOG),
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
})
