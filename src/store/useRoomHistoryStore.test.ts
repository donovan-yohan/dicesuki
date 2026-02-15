import { describe, it, expect, beforeEach } from 'vitest'
import { useRoomHistoryStore } from './useRoomHistoryStore'

describe('useRoomHistoryStore', () => {
  beforeEach(() => {
    useRoomHistoryStore.getState().clear()
  })

  it('should start with empty rolls', () => {
    expect(useRoomHistoryStore.getState().rolls).toHaveLength(0)
  })

  it('should add a roll entry', () => {
    useRoomHistoryStore.getState().addRoll({
      id: 'r1',
      playerId: 'p1',
      displayName: 'Gandalf',
      color: '#8B5CF6',
      results: [{ diceId: 'd1', diceType: 'd20', faceValue: 17 }],
      total: 17,
      timestamp: Date.now(),
    })

    expect(useRoomHistoryStore.getState().rolls).toHaveLength(1)
    expect(useRoomHistoryStore.getState().rolls[0].displayName).toBe('Gandalf')
  })

  it('should add newest rolls first', () => {
    useRoomHistoryStore.getState().addRoll({
      id: 'r1',
      playerId: 'p1',
      displayName: 'First',
      color: '#FFF',
      results: [],
      total: 0,
      timestamp: 1000,
    })
    useRoomHistoryStore.getState().addRoll({
      id: 'r2',
      playerId: 'p1',
      displayName: 'Second',
      color: '#FFF',
      results: [],
      total: 0,
      timestamp: 2000,
    })

    const rolls = useRoomHistoryStore.getState().rolls
    expect(rolls[0].id).toBe('r2')
    expect(rolls[1].id).toBe('r1')
  })

  it('should cap at 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      useRoomHistoryStore.getState().addRoll({
        id: `r${i}`,
        playerId: 'p1',
        displayName: 'Test',
        color: '#FFF',
        results: [],
        total: i,
        timestamp: i,
      })
    }

    expect(useRoomHistoryStore.getState().rolls).toHaveLength(50)
  })

  it('should keep newest entries when capped', () => {
    for (let i = 0; i < 60; i++) {
      useRoomHistoryStore.getState().addRoll({
        id: `r${i}`,
        playerId: 'p1',
        displayName: 'Test',
        color: '#FFF',
        results: [],
        total: i,
        timestamp: i,
      })
    }

    // The most recent entry (r59) should be first
    expect(useRoomHistoryStore.getState().rolls[0].id).toBe('r59')
  })

  it('should clear all rolls', () => {
    useRoomHistoryStore.getState().addRoll({
      id: 'r1',
      playerId: 'p1',
      displayName: 'Test',
      color: '#FFF',
      results: [],
      total: 0,
      timestamp: 0,
    })
    useRoomHistoryStore.getState().clear()
    expect(useRoomHistoryStore.getState().rolls).toHaveLength(0)
  })
})
