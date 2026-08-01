import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMultiplayerDiceBackend } from '../hooks/useMultiplayerDiceBackend'

import { ROOM_DICE_CAPACITY } from '../config/roomCapacity'
import { useDiceStore } from '../store/useDiceStore'
import { useMultiplayerStore, type MultiplayerDie } from '../store/useMultiplayerStore'
import type { DiceShape } from './geometries'
import type { DicePresentationMetadata } from './multiplayerMessages'
import type { DiceEntry, SavedRoll } from '../types/savedRolls'
import { useInventoryStore } from '../store/useInventoryStore'
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
      // The real room echoes `presentation` back on `dice_spawned`, and the
      // executor reads it back to tell which named dice landed as basics.
      dice: new Map(state.dice).set(id, {
        ...roomDie(id, type),
        presentation: presentation as DicePresentationMetadata | undefined,
      }),
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

  afterEach(() => {
    // The determinism cases spy on `Math.random`; leaving one installed would
    // silently fix the RNG for every test that runs after them in this file.
    vi.restoreAllMocks()
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

  describe('basic-die substitution', () => {
    /**
     * The real backend, with only the protocol send stubbed, so `addDie`'s
     * inventory fallback and the executor's read-back of the room's echo are
     * both live. Faking either would only prove the fake.
     */
    function stubRealRoomTransport(faces: number[]) {
      // Same `activeRoomToken` guard as `createFakeRoom`: settle timers left
      // queued by a finished test must not land on the next test's dice.
      const token = Symbol('stub-room')
      activeRoomToken = token
      let nextId = 0
      const spawned: Array<{ id: string; presentation?: DicePresentationMetadata }> = []
      useMultiplayerStore.setState({
        spawnDice: ((type: DiceShape, presentation?: DicePresentationMetadata) => {
          const id = `real-${++nextId}`
          spawned.push({ id, presentation })
          useMultiplayerStore.setState((state) => ({
            dice: new Map(state.dice).set(id, { ...roomDie(id, type), presentation }),
          }))
          const face = faces.shift() ?? 1
          setTimeout(() => {
            if (activeRoomToken !== token) return
            useDiceStore.getState().recordDieSettled(id, face, type)
          }, 0)
          return id
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
      return spawned
    }

    beforeEach(() => {
      useInventoryStore.getState().reset()
    })

    it('rolls a saved roll whose named die is gone, as a basic die plus a notice', async () => {
      // Arrange — the roll names a die the player no longer has.
      const spawned = stubRealRoomTransport([4])
      const { result } = renderHook(() => useMultiplayerDiceBackend())
      const roll = makeRoll({
        type: 'd4',
        quantity: 1,
        sources: [{ kind: 'specific', dieId: 'die_sold_long_ago' }],
      })

      // Act
      await executePhysicalSavedRoll(roll, { backend: result.current, ownerId: OWNER })
      await waitFor(() => {
        expect(useDiceStore.getState().settledDice.has('real-1')).toBe(true)
      })

      // Assert — the roll ran to completion with a basic stand-in, and the HUD
      // is told why rather than the whole roll failing.
      expect(spawned).toHaveLength(1)
      expect(spawned[0].presentation).toMatchObject({ basic: true, displayName: 'Basic D4' })
      expect(useDiceStore.getState().rollNotice)
        .toBe('One die in this roll is no longer in your collection, so a basic die was rolled instead.')
    })

    it('says nothing when every named die is still owned', async () => {
      // Arrange
      const owned = useInventoryStore.getState().addDie({
        id: 'owned-d4',
        type: 'd4',
        setId: 'test-set',
        rarity: 'common',
        appearance: { baseColor: '#8b5cf6', accentColor: '#fff', material: 'plastic' },
        vfx: {},
        name: 'My D4',
        isFavorite: false,
        isLocked: false,
        source: 'gacha_standard',
      })
      const spawned = stubRealRoomTransport([3])
      const { result } = renderHook(() => useMultiplayerDiceBackend())
      const roll = makeRoll({
        type: 'd4',
        quantity: 1,
        sources: [{ kind: 'specific', dieId: owned.id }],
      })

      // Act
      await executePhysicalSavedRoll(roll, { backend: result.current, ownerId: OWNER })

      // Assert
      expect(spawned[0].presentation).toMatchObject({ inventoryDieId: 'owned-d4' })
      expect(useDiceStore.getState().rollNotice).toBeNull()
    })

    it('rolls a plain entry entirely as basics when the player owns none', async () => {
      // Arrange — an empty collection is the DEFAULT, not a shortfall, so this
      // must not accuse the player of running out of anything.
      const spawned = stubRealRoomTransport([2, 5])
      const { result } = renderHook(() => useMultiplayerDiceBackend())
      const roll = makeRoll({
        type: 'd6',
        quantity: 2,
        sources: [{ kind: 'anonymous', quantity: 2 }],
      })

      // Act
      await executePhysicalSavedRoll(roll, { backend: result.current, ownerId: OWNER })

      // Assert
      expect(spawned.every((die) => die.presentation?.basic === true)).toBe(true)
      expect(useDiceStore.getState().rollNotice).toBeNull()
    })
  })

  /**
   * PO decision (d), 2026-07-28: a PLAIN entry fills owned-first, then basics.
   * A roll for 6d4 by a player who owns 4 puts their 4 on the table and makes up
   * the difference with basics — it is never short and never refuses.
   */
  describe('owned-first fill for plain entries', () => {
    /**
     * The real backend with only the protocol send stubbed, so `addDie`'s
     * owned-first selection and the executor's read-back of the room's echo are
     * both live. Every die settles on 1.
     *
     * Guarded by `activeRoomToken` for the same reason `createFakeRoom` is: a
     * test that ends with settle timers still queued would otherwise have them
     * land on the NEXT test's identically-named die and wipe its face,
     * stranding that test's follow-up wave.
     */
    function stubRealRoomTransport() {
      const token = Symbol('stub-room')
      activeRoomToken = token
      let nextId = 0
      const spawned: Array<{ id: string; presentation?: DicePresentationMetadata }> = []
      const typeById = new Map<string, DiceShape>()
      const settle = (id: string) => {
        if (activeRoomToken !== token) return
        useDiceStore.getState().recordDieSettled(id, 1, typeById.get(id) ?? 'd4')
      }
      useMultiplayerStore.setState({
        spawnDice: ((type: DiceShape, presentation?: DicePresentationMetadata) => {
          const id = `stub-${++nextId}`
          spawned.push({ id, presentation })
          typeById.set(id, type)
          useMultiplayerStore.setState((state) => ({
            dice: new Map(state.dice).set(id, { ...roomDie(id, type), presentation }),
          }))
          // A spawned die drops and comes to rest on its own.
          setTimeout(() => settle(id), 0)
          return id
        }) as never,
        roll: (() => {
          const mine = Array.from(useMultiplayerStore.getState().dice.values())
            .filter((die) => die.ownerId === OWNER).map((die) => die.id)
          useMultiplayerStore.setState((state) => ({
            rollStartedSequence: state.rollStartedSequence + 1,
            lastRollStartedDiceIds: mine,
          }))
          // `roll_started` wipes the faces of every die it launches, so they
          // have to come to rest again or a follow-up wave waits forever.
          useDiceStore.getState().markDiceRolling(mine)
          for (const id of mine) setTimeout(() => settle(id), 0)
        }) as never,
      })
      return spawned
    }

    function ownD4s(count: number): string[] {
      return Array.from({ length: count }, (_, index) => (
        useInventoryStore.getState().addDie({
          id: `owned-d4-${index}`,
          type: 'd4',
          setId: 'test-set',
          rarity: 'common',
          appearance: { baseColor: '#2563eb', accentColor: '#fff', material: 'plastic' },
          vfx: {},
          name: `Blue d4 #${index}`,
          isFavorite: false,
          isLocked: false,
          source: 'gacha_standard',
        }).id
      ))
    }

    /** Which owned die (if any) each spawn used, in spawn order. */
    const ownedIdsOf = (spawned: Array<{ presentation?: DicePresentationMetadata }>) =>
      spawned.map((die) => die.presentation?.inventoryDieId)

    const plainD4Roll = (quantity: number, id = 'entry-1') => ({
      ...makeRoll({ type: 'd4', quantity, sources: [{ kind: 'anonymous', quantity }] }),
      dice: [{
        id,
        type: 'd4' as const,
        quantity,
        perDieBonus: 0,
        sources: [{ kind: 'anonymous' as const, quantity }],
      }],
    })

    beforeEach(() => {
      useInventoryStore.getState().reset()
    })

    it('uses only owned dice when the player owns enough, and says nothing', async () => {
      const ownedIds = ownD4s(4)
      const spawned = stubRealRoomTransport()
      const { result } = renderHook(() => useMultiplayerDiceBackend())

      await executePhysicalSavedRoll(plainD4Roll(4), { backend: result.current, ownerId: OWNER })

      expect(spawned).toHaveLength(4)
      expect(spawned.every((die) => die.presentation?.basic !== true)).toBe(true)
      // Each owned die is used exactly once — never twice in one roll.
      expect(ownedIdsOf(spawned).sort()).toEqual([...ownedIds].sort())
      expect(useDiceStore.getState().rollNotice).toBeNull()
    })

    it('fills the shortfall with basics and reports the count', async () => {
      const ownedIds = ownD4s(4)
      const spawned = stubRealRoomTransport()
      const { result } = renderHook(() => useMultiplayerDiceBackend())

      await executePhysicalSavedRoll(plainD4Roll(6), { backend: result.current, ownerId: OWNER })

      // 6 dice on the table: the 4 owned plus 2 basics. The roll is never short.
      expect(spawned).toHaveLength(6)
      const owned = spawned.filter((die) => die.presentation?.basic !== true)
      const basics = spawned.filter((die) => die.presentation?.basic === true)
      expect(owned).toHaveLength(4)
      expect(basics).toHaveLength(2)
      expect(ownedIdsOf(owned).sort()).toEqual([...ownedIds].sort())
      expect(useDiceStore.getState().rollNotice)
        .toBe('You ran out of owned dice, so 2 basic dice filled in.')
    })

    it('does not let two entries of the same type claim the same owned die', async () => {
      // Two 2d4 entries against a pool of 3: the first entry takes two, the
      // second gets the last owned die and one basic. A die spawned earlier in
      // the SAME roll counts as in use, before the room has acknowledged it.
      const ownedIds = ownD4s(3)
      const spawned = stubRealRoomTransport()
      const { result } = renderHook(() => useMultiplayerDiceBackend())
      const roll = {
        ...plainD4Roll(2),
        dice: [...plainD4Roll(2, 'entry-a').dice, ...plainD4Roll(2, 'entry-b').dice],
      }

      await executePhysicalSavedRoll(roll, { backend: result.current, ownerId: OWNER })

      expect(spawned).toHaveLength(4)
      const usedOwnedIds = ownedIdsOf(spawned).filter((id): id is string => id !== undefined)
      expect(usedOwnedIds.sort()).toEqual([...ownedIds].sort())
      expect(new Set(usedOwnedIds).size).toBe(3)
      expect(spawned.filter((die) => die.presentation?.basic === true)).toHaveLength(1)
      expect(useDiceStore.getState().rollNotice)
        .toBe('You ran out of owned dice, so 1 basic die filled in.')
    })

    const specificD4Entry = (id: string, dieId: string) => ({
      id,
      type: 'd4' as const,
      quantity: 1,
      perDieBonus: 0,
      sources: [{ kind: 'specific' as const, dieId }],
    })

    /**
     * A plain source must never take a die a `specific` source in the SAME roll
     * pinned. Before the reservation this depended on entry order and on
     * `Math.random`, and when the steal happened the pinned source degraded to a
     * basic and reported a die the player still owned as gone.
     */
    describe('pinned dice are reserved against the roll\'s own plain sources', () => {
      it('does not let a plain entry listed FIRST steal a later pinned die', async () => {
        // Pin the RNG at the top of the range so the plain pick would land on
        // the last available die — which is exactly the one the second entry
        // names. Without the reservation this test steals it every time.
        vi.spyOn(Math, 'random').mockReturnValue(0.999)
        const ownedIds = ownD4s(2)
        const spawned = stubRealRoomTransport()
        const { result } = renderHook(() => useMultiplayerDiceBackend())
        // Plain 1d4 first, then a pin on a specific die.
        const roll = {
          ...plainD4Roll(1),
          dice: [
            ...plainD4Roll(1, 'entry-plain').dice,
            specificD4Entry('entry-pinned', ownedIds[1]),
          ],
        }

        await executePhysicalSavedRoll(roll, { backend: result.current, ownerId: OWNER })

        // Both dice are owned, the pinned one is itself, and nothing is basic.
        expect(spawned).toHaveLength(2)
        expect(spawned[1].presentation?.inventoryDieId).toBe(ownedIds[1])
        expect(spawned[0].presentation?.inventoryDieId).toBe(ownedIds[0])
        expect(spawned.some((die) => die.presentation?.basic === true)).toBe(false)
        expect(useDiceStore.getState().rollNotice).toBeNull()
      })

      it('reserves within a single mixed [anonymous, specific] entry', async () => {
        const ownedIds = ownD4s(2)
        const spawned = stubRealRoomTransport()
        const { result } = renderHook(() => useMultiplayerDiceBackend())
        const roll = {
          ...plainD4Roll(2),
          dice: [{
            id: 'entry-mixed',
            type: 'd4' as const,
            quantity: 2,
            perDieBonus: 0,
            // The anonymous source is expanded BEFORE the specific one, so it
            // picks first.
            sources: [
              { kind: 'anonymous' as const, quantity: 1 },
              { kind: 'specific' as const, dieId: ownedIds[1] },
            ],
          }],
        }

        await executePhysicalSavedRoll(roll, { backend: result.current, ownerId: OWNER })

        expect(spawned).toHaveLength(2)
        expect(spawned[0].presentation?.inventoryDieId).toBe(ownedIds[0])
        expect(spawned[1].presentation?.inventoryDieId).toBe(ownedIds[1])
        expect(spawned.some((die) => die.presentation?.basic === true)).toBe(false)
      })

      it.each([0, 0.34, 0.67, 0.999])(
        'produces the same outcome with Math.random = %s',
        async (randomValue) => {
          // Determinism: the pinned die is always itself, the plain sources
          // always consume the rest of the pool, and the basic-fill count is
          // fixed — none of it may depend on which die the RNG happens to pick.
          vi.spyOn(Math, 'random').mockReturnValue(randomValue)
          const ownedIds = ownD4s(4)
          const spawned = stubRealRoomTransport()
          const { result } = renderHook(() => useMultiplayerDiceBackend())
          const roll = {
            ...plainD4Roll(3),
            dice: [
              ...plainD4Roll(3, 'entry-plain').dice,
              specificD4Entry('entry-pinned', ownedIds[3]),
            ],
          }

          await executePhysicalSavedRoll(roll, { backend: result.current, ownerId: OWNER })

          expect(spawned).toHaveLength(4)
          // The pinned die is always the 4th spawn and always itself.
          expect(spawned[3].presentation?.inventoryDieId).toBe(ownedIds[3])
          // The three plain slots consumed exactly the other three owned dice.
          expect(ownedIdsOf(spawned.slice(0, 3)).sort())
            .toEqual(ownedIds.slice(0, 3).sort())
          expect(spawned.filter((die) => die.presentation?.basic === true)).toHaveLength(0)
          expect(useDiceStore.getState().rollNotice).toBeNull()
        },
      )

      it('releases the reservation once the base wave is spawned', async () => {
        const ownedIds = ownD4s(1)
        stubRealRoomTransport()
        const { result } = renderHook(() => useMultiplayerDiceBackend())

        await executePhysicalSavedRoll(
          { ...plainD4Roll(1), dice: [specificD4Entry('entry-pinned', ownedIds[0])] },
          { backend: result.current, ownerId: OWNER },
        )

        // A leaked reservation would make that die unpickable for every later
        // roll in the session.
        expect(useDiceStore.getState().reservedInventoryDieIds.size).toBe(0)
      })
    })

    it('reports a reroll whose owned die vanished mid-roll, like the base wave', async () => {
      // The die was owned when the base wave spawned it, but is gone by the
      // time the reroll respawns it (sold in another tab, a revoked server
      // copy). Same failure as a base-wave substitution, so the same sentence.
      const owned = ownD4s(1)[0]
      const spawned = stubRealRoomTransport()
      // Removing the base die for the reroll is the moment the player loses it.
      // Stubbed BEFORE the hook renders so the backend closes over this version.
      useMultiplayerStore.setState({
        removeDice: ((ids: string[]) => {
          useInventoryStore.getState().removeDie(owned)
          useMultiplayerStore.setState((state) => {
            const dice = new Map(state.dice)
            for (const id of ids) dice.delete(id)
            return { dice }
          })
          for (const id of ids) useDiceStore.getState().removeDieState(id)
        }) as never,
      })
      const { result } = renderHook(() => useMultiplayerDiceBackend())
      const roll = {
        ...plainD4Roll(1),
        dice: [{
          id: 'entry-1',
          type: 'd4' as const,
          quantity: 1,
          perDieBonus: 0,
          sources: [{ kind: 'specific' as const, dieId: owned }],
          // The stub settles every die on 1, so this always triggers.
          reroll: { condition: 'lessOrEqual' as const, value: 2, maxRerolls: 1 },
        }],
      }

      await executePhysicalSavedRoll(roll, { backend: result.current, ownerId: OWNER })
      await waitFor(() => {
        expect(useDiceStore.getState().savedRollWavesPending).toBe(false)
      })

      // Base die was the owned one; its replacement had to be a basic.
      expect(spawned[0].presentation?.inventoryDieId).toBe(owned)
      expect(spawned[1].presentation?.basic).toBe(true)
      expect(useDiceStore.getState().rollNotice)
        .toContain('no longer in your collection')
    })

    it('leaves a type the player owns nothing of entirely basic and silent', async () => {
      ownD4s(2)
      const spawned = stubRealRoomTransport()
      const { result } = renderHook(() => useMultiplayerDiceBackend())
      // d6, not d4: the player owns d4s but no d6s at all.
      const roll = makeRoll({
        type: 'd6',
        quantity: 3,
        sources: [{ kind: 'anonymous', quantity: 3 }],
      })

      await executePhysicalSavedRoll(roll, { backend: result.current, ownerId: OWNER })

      expect(spawned).toHaveLength(3)
      expect(spawned.every((die) => die.presentation?.basic === true)).toBe(true)
      expect(useDiceStore.getState().rollNotice).toBeNull()
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
      // Only follow-up wave dice take the generic path now — the base wave's
      // plain source spawns owned-first through `addDie` — so the FIRST generic
      // spawn is the explosion.
      room.backend.addGenericDie = vi.fn(() => {
        useMultiplayerStore.setState({
          roomActionError: { code: 'DICE_LIMIT', message: 'Table is full' },
        })
        return null
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
