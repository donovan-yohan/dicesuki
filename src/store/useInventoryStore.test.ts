import { beforeEach, describe, expect, it } from 'vitest'
import {
  migratePersistedInventoryState,
  useInventoryStore,
} from './useInventoryStore'
import type { NewInventoryDie } from '../types/inventory'

const makeNewDie = (overrides: Partial<NewInventoryDie> = {}): NewInventoryDie => ({
  type: 'd6',
  setId: 'test-set',
  rarity: 'common',
  appearance: { baseColor: '#ffffff', accentColor: '#000000', material: 'plastic' },
  vfx: {},
  name: 'Test Die',
  isFavorite: false,
  isLocked: false,
  source: 'gacha_standard',
  assignedToRolls: [],
  ...overrides,
})

describe('useInventoryStore', () => {
  beforeEach(() => {
    useInventoryStore.getState().reset()
  })

  describe('removeDie', () => {
    it('removes a die with no assignments', () => {
      const die = useInventoryStore.getState().addDie(makeNewDie())

      expect(useInventoryStore.getState().removeDie(die.id)).toBe(true)
      expect(useInventoryStore.getState().dice).toHaveLength(0)
    })

    it('removes a die and all assignments that name it', () => {
      const die = useInventoryStore.getState().addDie(makeNewDie())
      useInventoryStore.getState().assignDieToSlot('roll-1', 'entry-1', 0, die.id)
      useInventoryStore.getState().assignDieToSlot('roll-2', 'entry-2', 1, die.id)

      expect(useInventoryStore.getState().removeDie(die.id)).toBe(true)
      expect(useInventoryStore.getState().dice).toHaveLength(0)
      expect(useInventoryStore.getState().assignments).toEqual({})
    })

    it('preserves other dice assignments when removing a specific die', () => {
      const first = useInventoryStore.getState().addDie(makeNewDie())
      const second = useInventoryStore.getState().addDie(makeNewDie({ name: 'Second die' }))
      useInventoryStore.getState().assignDieToSlot('roll-1', 'entry-1', 0, first.id)
      useInventoryStore.getState().assignDieToSlot('roll-1', 'entry-1', 1, second.id)

      expect(useInventoryStore.getState().removeDie(first.id)).toBe(true)
      expect(useInventoryStore.getState().dice.map(die => die.id)).toEqual([second.id])
      expect(Object.values(useInventoryStore.getState().assignments)).toEqual([second.id])
    })

    it('returns false without changing inventory for a nonexistent id', () => {
      const die = useInventoryStore.getState().addDie(makeNewDie())

      expect(useInventoryStore.getState().removeDie('missing-die')).toBe(false)
      expect(useInventoryStore.getState().dice.map(item => item.id)).toEqual([die.id])
    })

    it('returns false without removing a locked die', () => {
      const die = useInventoryStore.getState().addDie(makeNewDie({ isLocked: true }))

      expect(useInventoryStore.getState().removeDie(die.id)).toBe(false)
      expect(useInventoryStore.getState().dice.map(item => item.id)).toEqual([die.id])
    })
  })

  it('adds catalog references only for catalog-backed, non-dev dice', () => {
    const configured = useInventoryStore.getState().addDie(makeNewDie({
      setId: 'adventurer-starter',
    }))
    const dev = useInventoryStore.getState().addDie(makeNewDie({ isDev: true }))

    expect(configured.catalogRef?.itemId).toBe('adventurer-starter/d6/common@1')
    expect(dev.catalogRef).toBeUndefined()
  })

  it('preserves ids, assignments, stats, custom data and duplicate copies in v3', () => {
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
            version: '1.0', diceType: 'd6', name: 'Devil D6', artist: 'Dicesuki',
            created: '2025-12-08', scale: 0.4, faceNormals: [],
            physics: { density: 0.2, restitution: 0.4, friction: 0.6 },
            colliderType: 'roundCuboid', colliderArgs: {},
          },
        },
      })),
    }
    delete first.catalogRef
    const second = { ...first, id: 'legacy-devil-2', name: 'Devil d6 #2' }
    const persisted = {
      dice: [first, second],
      assignments: { 'roll:entry:0': first.id, 'roll:entry:1': second.id },
      currency: { coins: 123 },
    }

    const migrated = migratePersistedInventoryState(persisted, 2) as typeof persisted

    expect(migrated.dice.map(die => die.id)).toEqual(['legacy-devil-1', 'legacy-devil-2'])
    expect(migrated.assignments).toEqual(persisted.assignments)
    expect(migrated.currency).toEqual(persisted.currency)
    expect(migrated.dice[0].stats).toEqual(first.stats)
    expect(migrated.dice.map(die => die.catalogRef?.itemId)).toEqual([
      'devil-set/devil-d6@1',
      'devil-set/devil-d6@1',
    ])
    expect(migrated.dice.map(die => die.customAsset)).toEqual([
      { ...first.customAsset, storage: 'bundled' },
      { ...second.customAsset, storage: 'bundled' },
    ])
  })
})
