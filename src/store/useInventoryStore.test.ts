import { describe, it, expect, beforeEach, vi } from 'vitest'

const customDiceDb = vi.hoisted(() => ({
  createBlobUrlFromStorage: vi.fn(),
  deleteCustomDiceModel: vi.fn(),
}))

vi.mock('../lib/customDiceDB', () => customDiceDb)

import {
  migratePersistedInventoryState,
  useInventoryStore,
} from './useInventoryStore'
import type { NewInventoryDie } from '../types/inventory'

// Minimal valid die for test fixtures
const makeNewDie = (overrides: Partial<NewInventoryDie> = {}): NewInventoryDie => ({
  type: 'd6',
  setId: 'test-set',
  rarity: 'common',
  appearance: {
    baseColor: '#ffffff',
    accentColor: '#000000',
    material: 'plastic'
  },
  vfx: {},
  name: 'Test Die',
  isFavorite: false,
  isLocked: false,
  // Deliberately NOT 'starter': the v4 -> v5 migration deletes seeded starter
  // rows, so a 'starter' default would turn every migration fixture here into an
  // accidental test of that deletion (which has its own tests in
  // `useInventoryStore.serverCopies.test.ts`).
  source: 'gacha_standard',
  assignedToRolls: [],
  ...overrides
})

describe('useInventoryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useInventoryStore.getState().reset()
  })

  describe('removeDie', () => {
    it('removes a die with no assignments', () => {
      // Arrange
      const die = useInventoryStore.getState().addDie(makeNewDie())
      expect(useInventoryStore.getState().dice).toHaveLength(1)

      // Act
      const result = useInventoryStore.getState().removeDie(die.id)

      // Assert
      expect(result).toBe(true)
      expect(useInventoryStore.getState().dice).toHaveLength(0)
    })

    it('removes a die that has roll assignments and cleans up those assignments', () => {
      // Arrange
      const die = useInventoryStore.getState().addDie(makeNewDie())
      useInventoryStore.getState().assignDieToSlot('roll-1', 'entry-1', 0, die.id)
      useInventoryStore.getState().assignDieToSlot('roll-2', 'entry-2', 1, die.id)

      const assignmentsBefore = useInventoryStore.getState().assignments
      expect(Object.values(assignmentsBefore)).toContain(die.id)

      // Act
      const result = useInventoryStore.getState().removeDie(die.id)

      // Assert
      expect(result).toBe(true)
      expect(useInventoryStore.getState().dice).toHaveLength(0)

      const assignmentsAfter = useInventoryStore.getState().assignments
      expect(Object.values(assignmentsAfter)).not.toContain(die.id)
      expect(Object.keys(assignmentsAfter)).toHaveLength(0)
    })

    it('preserves other dice assignments when removing a specific die', () => {
      // Arrange
      const die1 = useInventoryStore.getState().addDie(makeNewDie({ name: 'Die 1' }))
      const die2 = useInventoryStore.getState().addDie(makeNewDie({ name: 'Die 2' }))
      useInventoryStore.getState().assignDieToSlot('roll-1', 'entry-1', 0, die1.id)
      useInventoryStore.getState().assignDieToSlot('roll-1', 'entry-1', 1, die2.id)

      // Act
      useInventoryStore.getState().removeDie(die1.id)

      // Assert: die1 assignment is gone, die2 assignment remains
      const assignments = useInventoryStore.getState().assignments
      expect(Object.values(assignments)).not.toContain(die1.id)
      expect(Object.values(assignments)).toContain(die2.id)
    })

    it('returns false and does nothing for a nonexistent die id', () => {
      // Arrange
      useInventoryStore.getState().addDie(makeNewDie())
      const countBefore = useInventoryStore.getState().dice.length

      // Act
      const result = useInventoryStore.getState().removeDie('nonexistent-id')

      // Assert
      expect(result).toBe(false)
      expect(useInventoryStore.getState().dice).toHaveLength(countBefore)
    })

    it('returns false and does not remove a locked die', () => {
      // Arrange
      const die = useInventoryStore.getState().addDie(makeNewDie({ isLocked: true }))

      // Act
      const result = useInventoryStore.getState().removeDie(die.id)

      // Assert
      expect(result).toBe(false)
      expect(useInventoryStore.getState().dice).toHaveLength(1)
    })
  })

  it('adds a descriptive catalog ref to configured dice but not local custom dice', () => {
    const configured = useInventoryStore.getState().addDie(makeNewDie({
      setId: 'adventurer-starter',
    }))
    const custom = useInventoryStore.getState().addDie(makeNewDie({
      setId: 'custom-artist',
      rarity: 'rare',
      isDev: true,
    }))

    expect(configured.catalogRef?.itemId).toBe('adventurer-starter/d6/common@1')
    expect(custom.catalogRef).toBeUndefined()
  })

  describe('regenerateCustomDiceBlobUrls', () => {
    it('restores a legacy local die without a storage marker and skips bundled catalog GLBs', async () => {
      const legacy = useInventoryStore.getState().addDie(makeNewDie({
        id: 'legacy-local-die',
        setId: 'custom-artist',
        customAsset: {
          assetId: 'legacy-local-model',
          modelUrl: 'blob:expired-local-model',
          metadata: {
            version: '1.0', diceType: 'd6', name: 'Legacy local die', artist: 'Test',
            created: '2025-11-16', scale: 1, faceNormals: [],
            physics: { density: 1, restitution: 0.3, friction: 0.6 },
            colliderType: 'roundCuboid', colliderArgs: {},
          },
        },
      }))
      const bundled = useInventoryStore.getState().addDie(makeNewDie({
        id: 'bundled-catalog-die',
        setId: 'cozy-forest-imagegen-set',
        customAsset: {
          assetId: 'cozy-forest-imagegen-set/hearthwood-d6',
          modelUrl: '/dice/cozy-forest-imagegen-set/hearthwood-d6/model.glb',
          storage: 'bundled',
          metadata: {
            version: '1.0', diceType: 'd6', name: 'Hearthwood D6', artist: 'Operator',
            created: '2026-08-01', scale: 1, faceNormals: [],
            physics: { density: 1, restitution: 0.3, friction: 0.6 },
            colliderType: 'roundCuboid', colliderArgs: {},
          },
        },
      }))
      customDiceDb.createBlobUrlFromStorage.mockResolvedValue('blob:restored-local-model')

      await useInventoryStore.getState().regenerateCustomDiceBlobUrls()

      expect(customDiceDb.createBlobUrlFromStorage).toHaveBeenCalledTimes(1)
      expect(customDiceDb.createBlobUrlFromStorage).toHaveBeenCalledWith('legacy-local-model')
      expect(useInventoryStore.getState().dice.find(die => die.id === legacy.id)?.customAsset?.modelUrl)
        .toBe('blob:restored-local-model')
      expect(useInventoryStore.getState().dice.find(die => die.id === bundled.id)?.customAsset?.modelUrl)
        .toBe('/dice/cozy-forest-imagegen-set/hearthwood-d6/model.glb')
      expect(useInventoryStore.getState().customDiceLoadErrors).toEqual([])
    })

    it('reports a legacy die when its IndexedDB model bytes are missing', async () => {
      const legacy = useInventoryStore.getState().addDie(makeNewDie({
        id: 'missing-local-die',
        setId: 'custom-artist',
        customAsset: {
          assetId: 'missing-local-model',
          modelUrl: 'blob:expired-missing-model',
          metadata: {
            version: '1.0', diceType: 'd6', name: 'Missing legacy die', artist: 'Test',
            created: '2025-11-16', scale: 1, faceNormals: [],
            physics: { density: 1, restitution: 0.3, friction: 0.6 },
            colliderType: 'roundCuboid', colliderArgs: {},
          },
        },
      }))
      customDiceDb.createBlobUrlFromStorage.mockResolvedValue(null)

      await useInventoryStore.getState().regenerateCustomDiceBlobUrls()

      expect(customDiceDb.createBlobUrlFromStorage).toHaveBeenCalledWith('missing-local-model')
      expect(useInventoryStore.getState().dice.find(die => die.id === legacy.id)?.customAsset?.modelUrl)
        .toBe('blob:expired-missing-model')
      expect(useInventoryStore.getState().customDiceLoadErrors).toEqual([legacy.id])
    })
  })

  describe('v3 catalog ref migration', () => {
    it('preserves local ids, assignments, stats, custom data and duplicate copies', () => {
      const first = {
        ...useInventoryStore.getState().addDie(makeNewDie({
          id: 'legacy-devil-1',
          setId: 'devil-set',
          rarity: 'rare',
          name: 'Devil d6 #1',
          stats: { timesRolled: 3, totalValue: 11 },
          customAsset: {
            modelUrl: '/dice/devil-set/devil-d6/model.glb',
            assetId: 'devil-set/devil-d6',
            metadata: {
              version: '1.0',
              diceType: 'd6',
              name: 'Devil D6',
              artist: 'Zabi',
              created: '2025-12-08',
              scale: 0.4,
              faceNormals: [],
              physics: { density: 0.2, restitution: 0.4, friction: 0.6 },
              colliderType: 'roundCuboid',
              colliderArgs: {},
            },
          },
        })),
      }
      delete first.catalogRef
      const second = { ...first, id: 'legacy-devil-2', name: 'Devil d6 #2' }
      const persisted = {
        dice: [first, second],
        currency: { coins: 123, gems: 0, standardTokens: 5, premiumTokens: 0 },
        assignments: { 'roll-1:entry-1:0': first.id, 'roll-1:entry-1:1': second.id },
      }

      const migrated = migratePersistedInventoryState(persisted, 2) as typeof persisted

      expect('catalogRef' in first).toBe(false)
      expect(migrated.dice.map(die => die.id)).toEqual(['legacy-devil-1', 'legacy-devil-2'])
      expect(migrated.assignments).toEqual(persisted.assignments)
      expect(migrated.currency).toEqual(persisted.currency)
      expect(migrated.dice[0].stats).toEqual(first.stats)
      expect(migrated.dice[0].customAsset).toEqual({
        ...first.customAsset,
        storage: 'bundled',
      })
      expect(migrated.dice[1].customAsset).toEqual({
        ...second.customAsset,
        storage: 'bundled',
      })
      expect(migrated.dice.map(die => die.catalogRef?.itemId)).toEqual([
        'devil-set/devil-d6@1',
        'devil-set/devil-d6@1',
      ])
    })

    it('keeps local custom artist dice unmapped and never resets older states', () => {
      const custom = useInventoryStore.getState().addDie(makeNewDie({
        id: 'custom-local-1',
        setId: 'custom-artist',
        rarity: 'rare',
        isDev: true,
        customAsset: {
          modelUrl: '/dice/devil-set/devil-d6/model.glb',
          assetId: 'devil-set/devil-d6',
          storage: 'indexeddb',
          metadata: {
            version: '1.0',
            diceType: 'd6',
            name: 'Local custom die',
            artist: 'Test Artist',
            created: '2026-07-17',
            scale: 1,
            faceNormals: [],
            physics: { density: 1, restitution: 0.4, friction: 0.6 },
            colliderType: 'roundCuboid',
            colliderArgs: {},
          },
        },
      }))
      const persisted = {
        dice: [custom],
        currency: { coins: 9, gems: 8, standardTokens: 7, premiumTokens: 6 },
        assignments: { 'roll:entry:0': custom.id },
      }

      const migrated = migratePersistedInventoryState(persisted, 1) as typeof persisted

      expect(migrated.dice).toHaveLength(1)
      expect(migrated.dice[0]).toEqual(custom)
      expect(migrated.assignments).toEqual(persisted.assignments)
      expect(migrated.currency).toEqual(persisted.currency)
    })
  })
})
