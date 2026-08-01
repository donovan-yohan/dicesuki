/**
 * Drift guard for the room dice cap.
 *
 * `ROOM_DICE_CAPACITY` is a hand-mirrored copy of `MAX_DICE` in
 * `server/core/src/room.rs` — `EngineConfig` (Shared-ADR-007) does not project
 * the room cap to the client yet, so nothing else stops the two from drifting.
 * This test fails closed: it reads the Rust source and asserts the two agree, so
 * changing `MAX_DICE` without updating the client breaks the build rather than
 * silently letting the builder accept rolls the room will reject with
 * `DICE_LIMIT`.
 *
 * Mirrors the `physicsConfig.guard.test.ts` pattern of inspecting the shipped
 * source text rather than a re-export.
 */
import { describe, expect, it } from 'vitest'
import { ROLL_DICE_CAPACITY_MESSAGE, ROOM_DICE_CAPACITY } from './roomCapacity'
// Vite `?raw` hands us the exact Rust source text, so the guard inspects what
// the room actually compiles from.
import roomSrc from '../../server/core/src/room.rs?raw'

describe('ROOM_DICE_CAPACITY drift guard', () => {
  it('matches MAX_DICE in server/core/src/room.rs', () => {
    // Arrange / Act
    // Anchored per-line so a commented-out declaration cannot satisfy the guard.
    const match = roomSrc.match(/^pub const MAX_DICE:\s*usize\s*=\s*(\d+)\s*;/m)

    // Assert — a rename or removal must fail here, not silently pass
    expect(match, 'MAX_DICE declaration not found in server/core/src/room.rs').not.toBeNull()
    expect(Number(match![1])).toBe(ROOM_DICE_CAPACITY)
  })

  it('builds the shared over-capacity copy from the constant', () => {
    // Arrange / Act / Assert
    expect(ROLL_DICE_CAPACITY_MESSAGE).toBe(`Rolls are limited to ${ROOM_DICE_CAPACITY} dice`)
  })
})
