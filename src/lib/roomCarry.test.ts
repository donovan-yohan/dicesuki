import { describe, it, expect, beforeEach } from 'vitest'
import {
  setPendingRoomSetup,
  consumePendingRoomSetup,
  clearPendingRoomSetup,
  fitCarriedDice,
  type PendingRoomSetup,
  type CarriedDie,
} from './roomCarry'

const setup: PendingRoomSetup = {
  roomId: 'ROOM_A',
  dice: [{ diceType: 'd20', position: [1, 2, 3], rotation: [0, 0, 0, 1] }],
  sourceArena: { halfX: 4.5, halfZ: 8 },
  visibility: 'public',
  roomName: 'Table 1',
}

describe('roomCarry hand-off buffer', () => {
  beforeEach(() => {
    clearPendingRoomSetup()
  })

  it('consume returns the stashed setup exactly once for its room, then null', () => {
    setPendingRoomSetup(setup)
    expect(consumePendingRoomSetup('ROOM_A')).toEqual(setup)
    // Consuming clears it so a later join can't replay it.
    expect(consumePendingRoomSetup('ROOM_A')).toBeNull()
  })

  it('never applies a setup to a different room, and leaves it intact', () => {
    setPendingRoomSetup(setup)
    // Wrong room: no match, buffer untouched.
    expect(consumePendingRoomSetup('ROOM_B')).toBeNull()
    // The correct room can still claim it.
    expect(consumePendingRoomSetup('ROOM_A')).toEqual(setup)
  })

  it('returns null when nothing was stashed', () => {
    expect(consumePendingRoomSetup('ROOM_A')).toBeNull()
  })

  it('clear discards a pending setup without applying it', () => {
    setPendingRoomSetup(setup)
    clearPendingRoomSetup()
    expect(consumePendingRoomSetup('ROOM_A')).toBeNull()
  })
})

describe('fitCarriedDice', () => {
  const dice: CarriedDie[] = [
    { diceType: 'd20', position: [8, 0.6, 4], rotation: [0, 0, 0, 1] },
    { diceType: 'd6', position: [-8, 0.6, -4], rotation: [0.1, 0.2, 0.3, 0.9] },
  ]

  it('scales a larger source layout down to fit the destination arena', () => {
    // Source half-extents 9 x 8, destination 4.5 x 8 → uniform scale 0.5.
    const out = fitCarriedDice(dice, { halfX: 9, halfZ: 8 }, { halfX: 4.5, halfZ: 8 })
    expect(out[0].position).toEqual([4, 0.6, 2])
    expect(out[1].position).toEqual([-4, 0.6, -2])
    // Y (rest height) and rotation (face) are untouched.
    expect(out[0].position[1]).toBe(0.6)
    expect(out[1].rotation).toEqual([0.1, 0.2, 0.3, 0.9])
  })

  it('leaves dice untouched when the destination is as large or larger', () => {
    const out = fitCarriedDice(dice, { halfX: 4.5, halfZ: 8 }, { halfX: 4.5, halfZ: 8 })
    expect(out).toEqual(dice)
  })

  it('passes dice through when either arena is unknown', () => {
    expect(fitCarriedDice(dice, null, { halfX: 4.5, halfZ: 8 })).toEqual(dice)
    expect(fitCarriedDice(dice, { halfX: 9, halfZ: 8 }, null)).toEqual(dice)
  })
})
