import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDiceManagerStore } from './useDiceManagerStore'

describe('useDiceManagerStore spawning', () => {
  beforeEach(() => {
    useDiceManagerStore.getState().removeAllDice()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    useDiceManagerStore.getState().removeAllDice()
  })

  it('spreads sequentially spawned dice so saved-roll dice do not overlap', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    useDiceManagerStore.getState().addDice('d6')
    useDiceManagerStore.getState().addDice('d20')

    const [first, second] = useDiceManagerStore.getState().dice

    expect(first.position).not.toEqual(second.position)
    expect(Math.abs(first.position[0] - second.position[0])).toBeGreaterThanOrEqual(0.6)
  })

  it('keeps adding new spawn rows beyond six dice', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    for (let i = 0; i < 9; i += 1) {
      useDiceManagerStore.getState().addDice('d6')
    }

    const positions = useDiceManagerStore.getState().dice.map(die => [die.position[0], die.position[2]])
    const uniquePositions = new Set(positions.map(position => position.join(',')))

    expect(uniquePositions.size).toBe(9)
    expect(positions[6]).not.toEqual(positions[0])
    expect(positions[7]).not.toEqual(positions[1])
    expect(positions[8]).not.toEqual(positions[2])
  })
})
