import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMultiplayerDiceBackend } from '../hooks/useMultiplayerDiceBackend'

import { ROOM_DICE_CAPACITY } from '../config/roomCapacity'
import { useDiceStore } from '../store/useDiceStore'
import { useMultiplayerStore, type MultiplayerDie } from '../store/useMultiplayerStore'
import type { DiceShape } from './geometries'
import type { DiceEntry, SavedRoll } from '../types/savedRolls'
import { executePhysicalSavedRoll, type SavedRollBackend } from './savedRollExecution'
import { aggregateSavedRollPlan, facesFromSettled } from './savedRollPlan'

const OWNER = 'player-1'

/**
 * Only the room built by the running test may settle dice.
 *
 * Dice ids restart at `die-1` for every test, and a test that ends before its
 * dice come to rest leaves settle timers queued. Without this guard those stale
 * timers land on the *next* test's identically-named die and hand it the
 * previous test's face.
 */
let activeRoomToken: symbol | null = null

function roomDie(id: string, type: DiceShape = 'd6', ownerId = OWNER): MultiplayerDie {
  return {
    id,
    ownerId,
    diceType: type,
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    targetPosition: [0, 0, 0],
    targetRotation: [0, 0, 0, 1],
    prevPosition: [0, 0, 0],
    prevRotation: [0, 0, 0, 1],
    isRolling: false,
    faceValue: null,
  }
}

/**
 * A room that behaves like the real one for the parts execution depends on:
 * spawns are acknowledged, a spawned die falls and settles on its own, `roll`
 * re-rolls every die the player owns, and removals are echoed back.
 *
 * Faces are handed out from `faceQueue` in spawn order and are sticky per die,
 * so re-rolling the base wave reproduces the same faces the queue promised.
 */
function createFakeRoom(faceQueue: number[]) {
  const token = Symbol('fake-room')
  activeRoomToken = token
  const faceById = new Map<string, number>()
  const spawnLog: Array<{
    id: string
    type: DiceShape
    inventoryDieId?: string
    presentation?: unknown
  }> = []
  const removed: string[] = []
  let nextId = 0
  let failNextSpawn: string | null = null
  let failRollWith: string | null = null

  function settle(id: string) {
    if (activeRoomToken !== token) return
    const die = useMultiplayerStore.getState().dice.get(id)
    const face = faceById.get(id)
    if (!die || face === undefined) return
    useMultiplayerStore.setState((state) => ({
      dice: new Map(state.dice).set(id, { ...die, isRolling: false, faceValue: face }),
    }))
    useDiceStore.getState().recordDieSettled(id, face, die.diceType)
  }

  function spawn(
    type: DiceShape,
    inventoryDieId?: string,
    presentation?: unknown,
  ): string | null {
    // The real `useMultiplayerDiceBackend.addDie`/`addGenericDie` clear the
    // saved-roll context on every spawn — including the executor's own
    // follow-up-wave spawns. Reproducing it here is what pins the regression
    // where wave tracking was torn down by the first reroll/explosion spawn.
    useDiceStore.getState().clearActiveSavedRoll()

    if (failNextSpawn) {
      useMultiplayerStore.setState({
        roomActionError: { code: 'DICE_LIMIT', message: failNextSpawn },
      })
      failNextSpawn = null
      return null
    }

    const id = `die-${++nextId}`
    faceById.set(id, faceQueue.shift() ?? 1)
    spawnLog.push({ id, type, inventoryDieId, presentation })
    useMultiplayerStore.setState((state) => ({
      dice: new Map(state.dice).set(id, roomDie(id, type)),
    }))
    // A spawned die drops and comes to rest on its own — the spawn IS the roll.
    setTimeout(() => settle(id), 0)
    return id
  }

  const backend: SavedRollBackend = {
    addDie: vi.fn((type: DiceShape, inventoryDieId?: string, presentation?: unknown) =>
      spawn(type, inventoryDieId, presentation)),
    addGenericDie: vi.fn((type: DiceShape, presentation?: unknown) =>
      spawn(type, undefined, presentation)),
    removeDie: vi.fn((id: string) => {
      removed.push(id)
      useMultiplayerStore.setState((state) => {
        const dice = new Map(state.dice)
        dice.delete(id)
        return { dice }
      })
      useDiceStore.getState().removeDieState(id)
    }),
    clearAll: vi.fn(() => {
      const mine = Array.from(useMultiplayerStore.getState().dice.values())
        .filter((die) => die.ownerId === OWNER)
        .map((die) => die.id)
      useMultiplayerStore.setState((state) => {
        const dice = new Map(state.dice)
        for (const id of mine) dice.delete(id)
        return { dice }
      })
    }),
    roll: vi.fn(() => {
      if (failRollWith) {
        useMultiplayerStore.setState({
          roomActionError: { code: 'SEND_FAILED', message: failRollWith },
        })
        failRollWith = null
        return
      }
      const mine = Array.from(useMultiplayerStore.getState().dice.values())
        .filter((die) => die.ownerId === OWNER)
        .map((die) => die.id)
      useMultiplayerStore.setState((state) => ({
        rollStartedSequence: state.rollStartedSequence + 1,
        lastRollStartedDiceIds: mine,
      }))
      // `roll_started` wipes the faces of every die it launches.
      useDiceStore.getState().markDiceRolling(mine)
      for (const id of mine) setTimeout(() => settle(id), 0)
    }),
  }

  /**
   * Resolve once every die this room spawned has either settled or been
   * removed. A roll without follow-up waves returns as soon as the dice are
   * launched, so assertions on the total have to wait for the table.
   */
  function quiesce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 2_000
      const poll = () => {
        const { settledDice } = useDiceStore.getState()
        const roomDice = useMultiplayerStore.getState().dice
        const done = spawnLog.every(({ id }) => settledDice.has(id) || !roomDice.has(id))
        if (done) return resolve()
        if (Date.now() > deadline) return reject(new Error('dice never settled'))
        setTimeout(poll, 1)
      }
      poll()
    })
  }

  return {
    backend,
    spawnLog,
    removed,
    quiesce,
    failSpawnWith: (message: string) => { failNextSpawn = message },
    failRollAckWith: (message: string) => { failRollWith = message },
  }
}

function makeRoll(entry: Partial<DiceEntry>, flatBonus = 0): SavedRoll {
  return {
    id: 'roll-1',
    name: 'Advanced roll',
    flatBonus,
    createdAt: 1,
    dice: [{
      id: 'entry-1',
      type: 'd6',
      quantity: 1,
      perDieBonus: 0,
      ...entry,
    }],
  }
}

function run(roll: SavedRoll, backend: SavedRollBackend) {
  return executePhysicalSavedRoll(roll, { backend, ownerId: OWNER })
}

/** The total the HUD and history will show for the roll now on the table. */
function activeTotal(): number {
  const { activeSavedRoll, settledDice } = useDiceStore.getState()
  if (!activeSavedRoll?.plan) throw new Error('no active plan')
  return aggregateSavedRollPlan(activeSavedRoll.plan, facesFromSettled(settledDice)).total
}

function keptFlags(): Array<[string, boolean]> {
  const { activeSavedRoll, settledDice } = useDiceStore.getState()
  const aggregate = aggregateSavedRollPlan(activeSavedRoll!.plan!, facesFromSettled(settledDice))
  return Array.from(aggregate.dice.entries()).map(([id, die]) => [id, die.kept])
}

describe('executePhysicalSavedRoll', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useDiceStore.getState().reset()
    useMultiplayerStore.getState().reset()
    useMultiplayerStore.setState({
      connectionStatus: 'connected',
      localPlayerId: OWNER,
      roomId: 'solo',
      dice: new Map(),
      roomActionError: null,
    })
  })

  describe('keep/drop', () => {
    it('spawns rollCount dice and keeps the best by settled value', async () => {
      // Arrange — advantage: roll 2 d20, keep the highest 1
      const room = createFakeRoom([7, 15])
      const roll = makeRoll({ type: 'd20', quantity: 1, rollCount: 2, keepMode: 'highest' })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert — both dice are physically on the table, only the 15 scores
      expect(room.spawnLog).toHaveLength(2)
      expect(activeTotal()).toBe(15)
      expect(keptFlags()).toEqual([['die-1', false], ['die-2', true]])
    })

    it('keeps the worst for disadvantage', async () => {
      // Arrange
      const room = createFakeRoom([7, 15])
      const roll = makeRoll({ type: 'd20', quantity: 1, rollCount: 2, keepMode: 'lowest' })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert
      expect(activeTotal()).toBe(7)
      expect(keptFlags()).toEqual([['die-1', true], ['die-2', false]])
    })

    it('adds the flat bonus once, not per kept die', async () => {
      // Arrange
      const room = createFakeRoom([7, 15])
      const roll = makeRoll({ type: 'd20', quantity: 1, rollCount: 2, keepMode: 'highest' }, 4)

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert
      expect(activeTotal()).toBe(19)
    })
  })

  describe('reroll', () => {
    it('physically replaces a matching die and takes the replacement face', async () => {
      // Arrange — 2d6, reroll anything at or below 2, once
      const room = createFakeRoom([1, 5, 6])
      const roll = makeRoll({
        quantity: 2,
        sources: [{ kind: 'anonymous', quantity: 2 }],
        reroll: { condition: 'lessOrEqual', value: 2, maxRerolls: 1 },
      })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert — the 1 was removed and respawned as a 6
      expect(room.removed).toEqual(['die-1'])
      expect(room.spawnLog.map((s) => s.id)).toEqual(['die-1', 'die-2', 'die-3'])
      expect(activeTotal()).toBe(11)
      expect(useMultiplayerStore.getState().dice.has('die-1')).toBe(false)
    })

    it('rerolls once only, even when the replacement also matches', async () => {
      // Arrange — the replacement is another 1, which must stand
      const room = createFakeRoom([1, 1])
      const roll = makeRoll({
        quantity: 1,
        reroll: { condition: 'equals', value: 1, maxRerolls: 1 },
      })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert — exactly one replacement spawn, total is the replacement's face
      expect(room.spawnLog).toHaveLength(2)
      expect(activeTotal()).toBe(1)
    })

    it('leaves dice that do not match the condition alone', async () => {
      // Arrange
      const room = createFakeRoom([4, 5])
      const roll = makeRoll({
        quantity: 2,
        sources: [{ kind: 'anonymous', quantity: 2 }],
        reroll: { condition: 'lessOrEqual', value: 2, maxRerolls: 1 },
      })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert
      expect(room.removed).toEqual([])
      expect(room.spawnLog).toHaveLength(2)
      expect(activeTotal()).toBe(9)
    })

    it('respawns a rerolled owned die as itself', async () => {
      // Arrange — a specific inventory die that rolls a 1
      const room = createFakeRoom([1, 6])
      const roll = makeRoll({
        quantity: 1,
        sources: [{ kind: 'specific', dieId: 'inventory-d6' }],
        reroll: { condition: 'equals', value: 1, maxRerolls: 1 },
      })
      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert — the first spawn asked for the owned die by id
      expect(room.spawnLog[0].inventoryDieId).toBe('inventory-d6')
      expect(activeTotal()).toBe(6)
    })
  })

  describe('exploding', () => {
    it('chains additional dice whose faces add to the original', async () => {
      // Arrange — d6 explodes on max: 6 then 6 then 2 stops the chain
      const room = createFakeRoom([6, 6, 2])
      const roll = makeRoll({ quantity: 1, exploding: { on: 'max' } })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert — three physical dice, one logical die worth 14
      expect(room.spawnLog).toHaveLength(3)
      expect(activeTotal()).toBe(14)
    })

    it('stops at the explosion depth cap even on an endless streak', async () => {
      // Arrange — every die shows the trigger face
      const room = createFakeRoom([6, 6, 6, 6, 6, 6])
      const roll = makeRoll({ quantity: 1, exploding: { on: 'max' } })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert — the base die plus MAX_EXPLOSION_WAVES (3) extras, and no more
      expect(room.spawnLog).toHaveLength(4)
      expect(activeTotal()).toBe(24)
      expect(useDiceStore.getState().rollNotice).toBeNull()
    })

    it('honours a lower per-entry explosion limit', async () => {
      // Arrange
      const room = createFakeRoom([6, 6, 6, 6])
      const roll = makeRoll({ quantity: 1, exploding: { on: 'max', limit: 1 } })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert
      expect(room.spawnLog).toHaveLength(2)
      expect(activeTotal()).toBe(12)
    })

    it('explodes on a non-maximum trigger face', async () => {
      // Arrange — explode on 5, so a 5 chains but a 6 does not
      const room = createFakeRoom([5, 6])
      const roll = makeRoll({ quantity: 1, exploding: { on: 5 } })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert
      expect(room.spawnLog).toHaveLength(2)
      expect(activeTotal()).toBe(11)
    })

    it('stops when the table runs out of room and says so', async () => {
      // Arrange — foreign dice leave exactly one free slot, which the base
      // wave takes; the explosion it triggers has nowhere to go.
      const foreign = new Map(
        Array.from({ length: ROOM_DICE_CAPACITY - 1 }, (_, i) => (
          [`foreign-${i}`, roomDie(`foreign-${i}`, 'd6', 'player-2')] as const
        )),
      )
      useMultiplayerStore.setState({ dice: new Map(foreign) })
      const room = createFakeRoom([6, 6])
      const roll = makeRoll({ quantity: 1, exploding: { on: 'max' } })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert — one spawn only, and the player is told why
      expect(room.spawnLog).toHaveLength(1)
      expect(activeTotal()).toBe(6)
      expect(useDiceStore.getState().rollNotice).toBe(
        'The table was full, so 1 explosion was skipped.',
      )
    })
  })

  describe('aggregation modes', () => {
    it('clamps each die before summing', async () => {
      // Arrange — a minimum of 3 lifts the 1, a maximum of 5 caps the 6
      const room = createFakeRoom([1, 6])
      const roll = makeRoll({
        quantity: 2,
        sources: [{ kind: 'anonymous', quantity: 2 }],
        minimum: 3,
        maximum: 5,
      })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert
      expect(activeTotal()).toBe(8)
    })

    it('counts successes and ignores the flat bonus', async () => {
      // Arrange — 3d6, success on 5+, with a flat bonus that must be ignored
      const room = createFakeRoom([5, 2, 6])
      const roll = makeRoll({
        quantity: 3,
        sources: [{ kind: 'anonymous', quantity: 3 }],
        countSuccesses: { targetNumber: 5 },
      }, 10)

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert
      expect(activeTotal()).toBe(2)
    })

    it('applies the per-die bonus once per exploding chain', async () => {
      // Arrange — one logical die worth 6 + 2, plus a single +1
      const room = createFakeRoom([6, 2])
      const roll = makeRoll({ quantity: 1, perDieBonus: 1, exploding: { on: 'max' } })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert — 9, not 10: the explosion is part of the same die
      expect(activeTotal()).toBe(9)
      const bonuses = useDiceStore.getState().activeSavedRoll!.perDieBonuses
      expect(Array.from(bonuses.entries())).toEqual([['die-1', 1]])
    })
  })

  describe('history', () => {
    it('records one row for the whole wave sequence, with the corrected total', async () => {
      // Arrange
      const room = createFakeRoom([6, 6, 2])
      const roll = makeRoll({ quantity: 1, exploding: { on: 'max' } })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert — a single history entry covering all three dice
      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(1)
      expect(history[0].sum).toBe(14)
      expect(history[0].dice.map((d) => d.diceId)).toEqual(['die-1', 'die-2', 'die-3'])
      expect(useDiceStore.getState().savedRollWavesPending).toBe(false)
    })

    it('drops a rerolled die from the recorded cycle', async () => {
      // Arrange
      const room = createFakeRoom([1, 6])
      const roll = makeRoll({
        quantity: 1,
        reroll: { condition: 'equals', value: 1, maxRerolls: 1 },
      })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert
      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(1)
      expect(history[0].dice.map((d) => d.diceId)).toEqual(['die-2'])
      expect(history[0].sum).toBe(6)
    })

    it('corrects the roll_complete row for a wave-less roll', async () => {
      // Arrange — no advanced mechanics, so the room's own roll_complete lands
      useMultiplayerStore.setState({
        players: new Map([[OWNER, {
          id: OWNER, displayName: 'Solo', color: '#fff', isHost: true,
        } as never]]),
      })
      const room = createFakeRoom([3, 4])
      const roll = makeRoll({ quantity: 2, sources: [{ kind: 'anonymous', quantity: 2 }] }, 5)

      // Act
      await run(roll, room.backend)
      await room.quiesce()
      useMultiplayerStore.getState().handleServerMessage({
        type: 'roll_complete',
        playerId: OWNER,
        total: 7,
        results: [
          { diceId: 'die-1', diceType: 'd6', faceValue: 3 },
          { diceId: 'die-2', diceType: 'd6', faceValue: 4 },
        ],
      } as never)

      // Assert — the roller's row carries the flat bonus the room cannot know
      // about, not the room's raw `total: 7`.
      const history = useDiceStore.getState().rollHistory
      const attributed = history.filter((row) => row.player !== undefined)
      expect(attributed).toHaveLength(1)
      expect(attributed[0].sum).toBe(12)
    })

    it('leaves a remote player\'s roll_complete row as the raw face sum', async () => {
      // Arrange — someone else's roll; we hold no plan for their dice
      useMultiplayerStore.setState({
        players: new Map([['player-2', {
          id: 'player-2', displayName: 'Rival', color: '#0f0', isHost: false,
        } as never]]),
      })

      // Act
      useMultiplayerStore.getState().handleServerMessage({
        type: 'roll_complete',
        playerId: 'player-2',
        total: 9,
        results: [
          { diceId: 'their-1', diceType: 'd6', faceValue: 4 },
          { diceId: 'their-2', diceType: 'd6', faceValue: 5 },
        ],
      } as never)

      // Assert — documented limitation: remote viewers see raw faces
      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(1)
      expect(history[0].sum).toBe(9)
      expect(history[0].player?.displayName).toBe('Rival')
    })

    it('attributes the wave row the way roll_complete would have', async () => {
      // Arrange — a multiplayer room where we have a player record
      useMultiplayerStore.setState({
        players: new Map([[OWNER, {
          id: OWNER, displayName: 'Me', color: '#f00', isHost: true,
        } as never]]),
      })
      const room = createFakeRoom([6, 2])
      const roll = makeRoll({ quantity: 1, exploding: { on: 'max' } })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert — the suppressed roll_complete row's attribution is preserved
      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(1)
      expect(history[0].player?.displayName).toBe('Me')
      expect(history[0].sum).toBe(8)
    })
  })

  describe('wave tracking survives the backend clearing the saved-roll context', () => {
    it('keeps the plan and one history row across reroll and explosion waves', async () => {
      // Arrange — a roll that needs BOTH follow-up waves
      const room = createFakeRoom([1, 6, 6, 2])
      const roll = makeRoll({
        quantity: 1,
        reroll: { condition: 'equals', value: 1, maxRerolls: 1 },
        exploding: { on: 'max' },
      })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert — the 1 was rerolled into a 6, which exploded into a 6, which
      // exploded into a 2: one logical die worth 14 across four physical dice.
      expect(useDiceStore.getState().activeSavedRoll?.plan).toBeDefined()
      expect(useDiceStore.getState().savedRollWavesPending).toBe(false)
      expect(useDiceStore.getState().rollHistory).toHaveLength(1)
      expect(room.spawnLog).toHaveLength(4)
      expect(activeTotal()).toBe(14)
    })

    it('survives the REAL backend, whose spawns clear activeSavedRoll', async () => {
      // Arrange — drive useMultiplayerDiceBackend itself, stubbing only the
      // protocol send, so the production side effects are all present.
      const spawned: string[] = []
      let nextId = 0
      const faces = [6, 2]
      useMultiplayerStore.setState({
        spawnDice: ((type: DiceShape) => {
          const id = `real-${++nextId}`
          spawned.push(id)
          useMultiplayerStore.setState((state) => ({
            dice: new Map(state.dice).set(id, roomDie(id, type)),
          }))
          const face = faces.shift() ?? 1
          setTimeout(() => {
            const die = useMultiplayerStore.getState().dice.get(id)
            if (!die) return
            useDiceStore.getState().recordDieSettled(id, face, die.diceType)
          }, 0)
          return id
        }) as never,
        removeDice: ((ids: string[]) => {
          useMultiplayerStore.setState((state) => {
            const dice = new Map(state.dice)
            for (const id of ids) dice.delete(id)
            return { dice }
          })
          for (const id of ids) useDiceStore.getState().removeDieState(id)
        }) as never,
        roll: (() => {
          const mine = Array.from(useMultiplayerStore.getState().dice.values())
            .filter((die) => die.ownerId === OWNER).map((die) => die.id)
          useMultiplayerStore.setState((state) => ({
            rollStartedSequence: state.rollStartedSequence + 1,
            lastRollStartedDiceIds: mine,
          }))
          useDiceStore.getState().markDiceRolling(mine)
        }) as never,
      })

      const { result } = renderHook(() => useMultiplayerDiceBackend())
      // Exploding, not reroll: an explosion wave spawns a SECOND follow-up die,
      // so the plan must survive two rounds of the backend clearing it — which
      // is exactly the teardown this block exists to pin.
      const roll = makeRoll({ quantity: 1, exploding: { on: 'max' } })

      // Act
      await executePhysicalSavedRoll(roll, { backend: result.current, ownerId: OWNER })
      await waitFor(() => {
        expect(useDiceStore.getState().settledDice.has('real-2')).toBe(true)
      })

      // Assert — the plan is still published and the roll is one history row
      expect(spawned).toEqual(['real-1', 'real-2'])
      expect(useDiceStore.getState().activeSavedRoll?.plan).toBeDefined()
      expect(useDiceStore.getState().savedRollWavesPending).toBe(false)
      expect(useDiceStore.getState().rollHistory).toHaveLength(1)
      // 6 exploded into a 2: one logical die worth 8 across two physical dice.
      expect(useDiceStore.getState().rollHistory[0].sum).toBe(8)
    })
  })

  describe('failure handling', () => {
    it('rejects a base-wave spawn failure so the panel can render it inline', async () => {
      // Arrange
      const room = createFakeRoom([4])
      room.failSpawnWith('Table is full (30/30 dice)')
      const roll = makeRoll({ quantity: 1 })

      // Act / Assert
      await expect(run(roll, room.backend)).rejects.toThrow('Table is full')
      expect(room.backend.roll).not.toHaveBeenCalled()
    })

    it('rejects an over-capacity roll before touching the table', async () => {
      // Arrange — a legacy roll that no longer fits
      const room = createFakeRoom([])
      const roll = makeRoll({
        quantity: ROOM_DICE_CAPACITY + 1,
        sources: [{ kind: 'anonymous', quantity: ROOM_DICE_CAPACITY + 1 }],
      })

      // Act / Assert
      await expect(run(roll, room.backend)).rejects.toThrow('Rolls are limited to 30 dice')
      expect(room.backend.clearAll).not.toHaveBeenCalled()
    })

    it('releases the wave latch when the base roll never starts', async () => {
      // Arrange — a roll WITH follow-up waves, whose `roll` is rejected by the
      // room (socket drop, room error, ack timeout, spawn-id mismatch).
      const room = createFakeRoom([6, 6])
      room.failRollAckWith('Could not reach the room.')
      const roll = makeRoll({ quantity: 1, exploding: { on: 'max' } })

      // Act
      await expect(run(roll, room.backend)).rejects.toThrow('Could not reach the room')

      // Assert — the wave sequence opened before `roll` must not stay open, or
      // every later roll is locked out for the rest of the session.
      expect(useDiceStore.getState().savedRollWavesPending).toBe(false)
    })

    it('still rolls normally after a failed base-roll acknowledgement', async () => {
      // Arrange — first attempt fails at the roll ack
      const failing = createFakeRoom([6, 6])
      failing.failRollAckWith('Could not reach the room.')
      const roll = makeRoll({ quantity: 1, exploding: { on: 'max' } })
      await expect(run(roll, failing.backend)).rejects.toThrow()
      useMultiplayerStore.setState({ roomActionError: null })
      // The lockout would show up here: a stuck flag disables every saved roll
      // and the HUD Roll button before the second attempt is even possible.
      expect(useDiceStore.getState().savedRollWavesPending).toBe(false)

      // Act — a second, healthy attempt
      const room = createFakeRoom([6, 2])
      await run(roll, room.backend)
      await room.quiesce()

      // Assert — the lockout is gone: waves ran and history recorded one row
      expect(room.spawnLog).toHaveLength(2)
      expect(activeTotal()).toBe(8)
      expect(useDiceStore.getState().savedRollWavesPending).toBe(false)
      expect(useDiceStore.getState().rollHistory).toHaveLength(1)
    })

    it('reports a follow-up wave failure as a notice and leaves no stuck state', async () => {
      // Arrange — the explosion's spawn is rejected by the room
      const room = createFakeRoom([6, 6])
      const roll = makeRoll({ quantity: 1, exploding: { on: 'max' } })
      const originalAdd = room.backend.addGenericDie
      let spawns = 0
      room.backend.addGenericDie = vi.fn((type) => {
        spawns += 1
        if (spawns === 2) {
          useMultiplayerStore.setState({
            roomActionError: { code: 'DICE_LIMIT', message: 'Table is full' },
          })
          return null
        }
        return originalAdd(type)
      })

      // Act — the base wave already started, so this must not reject
      await expect(run(roll, room.backend)).resolves.toBeUndefined()

      // Assert — the player is told, and nothing is left latched
      expect(useDiceStore.getState().rollNotice).toContain('Follow-up dice stopped early')
      expect(useDiceStore.getState().savedRollWavesPending).toBe(false)
      expect(useDiceStore.getState().rollHistory).toHaveLength(1)
      // Only the base die landed — the explosion it earned was never spawned.
      expect(useDiceStore.getState().rollHistory[0].sum).toBe(6)
    })
  })

  describe('percentile (d100) entries', () => {
    it('spawns a tens+ones pair and scores the combined result', async () => {
      // Arrange — one d100; the tens die lands 70, the ones die 3
      const room = createFakeRoom([70, 3])
      const roll = makeRoll({ type: 'd10', percentile: true, quantity: 1 })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert — two physical dice, one logical result
      expect(room.spawnLog.map((s) => s.type)).toEqual(['d10tens', 'd10'])
      expect(activeTotal()).toBe(73)
      // Both halves carry the same pair id so the pairing survives the table
      const [tens, ones] = room.spawnLog
      expect((tens.presentation as { percentilePairId?: string }).percentilePairId)
        .toBe((ones.presentation as { percentilePairId?: string }).percentilePairId)
    })

    it('reads 00 + 0 as 100 through the whole execution path', async () => {
      // Arrange
      const room = createFakeRoom([0, 0])
      const roll = makeRoll({ type: 'd10', percentile: true, quantity: 1 })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert — the history row agrees with the HUD
      expect(activeTotal()).toBe(100)
      expect(useDiceStore.getState().rollHistory).toHaveLength(1)
      expect(useDiceStore.getState().rollHistory[0].sum).toBe(100)
    })

    it('counts both halves against the room dice cap', async () => {
      // Arrange — 15 d100s is exactly 30 physical dice
      const room = createFakeRoom(Array.from({ length: 30 }, () => 1))
      const roll = makeRoll({
        type: 'd10',
        percentile: true,
        quantity: 15,
        sources: [{ kind: 'anonymous', quantity: 15 }],
      })

      // Act
      await run(roll, room.backend)
      await room.quiesce()

      // Assert
      expect(room.spawnLog).toHaveLength(ROOM_DICE_CAPACITY)
    })

    it('refuses 16 d100s, which would need 32 dice', async () => {
      // Arrange
      const room = createFakeRoom([])
      const roll = makeRoll({
        type: 'd10',
        percentile: true,
        quantity: 16,
        sources: [{ kind: 'anonymous', quantity: 16 }],
      })

      // Act / Assert — the guard counts physical dice, not d100s
      await expect(run(roll, room.backend)).rejects.toThrow('needs 32')
      expect(room.backend.clearAll).not.toHaveBeenCalled()
    })
  })
})
