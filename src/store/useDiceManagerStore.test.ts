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
})
