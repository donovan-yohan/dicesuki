import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnDiceFromToolbar } from './diceSpawner'
import { useDiceManagerStore } from '../store/useDiceManagerStore'
import { useInventoryStore } from '../store/useInventoryStore'
import type { DiceShape } from '../types/diceShape'
import type { NewInventoryDie } from '../types/inventory'

const makeDie = (overrides: Partial<NewInventoryDie> = {}): NewInventoryDie => ({
  type: 'd6',
  setId: 'starter-devil',
  rarity: 'common',
  appearance: {
    baseColor: '#b91c1c',
    accentColor: '#ffffff',
    material: 'plastic',
  },
  vfx: {},
  name: 'Test Die',
  isFavorite: false,
  isLocked: false,
  tags: [],
  source: 'starter',
  assignedToRolls: [],
  ...overrides,
})

function addOwnedDie(name: string, type: DiceShape = 'd6') {
  return useInventoryStore.getState().addDie(makeDie({ name, type }))
}

describe('spawnDiceFromToolbar', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    useInventoryStore.getState().reset()
    useDiceManagerStore.getState().removeAllDice()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    useInventoryStore.getState().reset()
    useDiceManagerStore.getState().removeAllDice()
  })

  it('spawns a random available owned die of the requested type', () => {
    addOwnedDie('First D6')
    const second = addOwnedDie('Second D6')
    vi.spyOn(Math, 'random').mockReturnValue(0.99)

    const result = spawnDiceFromToolbar('d6', 'default')

    expect(result.success).toBe(true)
    expect(result.inventoryDieId).toBe(second.id)
  })

  it('does not spawn more active dice than owned inventory dice', () => {
    addOwnedDie('Only D6')

    expect(spawnDiceFromToolbar('d6', 'default').success).toBe(true)
    const secondSpawn = spawnDiceFromToolbar('d6', 'default')

    expect(secondSpawn.success).toBe(false)
    expect(secondSpawn.error).toBe('All D6 dice are in use')
    expect(useDiceManagerStore.getState().dice).toHaveLength(1)
  })
})
