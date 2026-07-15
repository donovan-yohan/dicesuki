/**
 * Drift guard for the single-source-of-truth invariant (issue #117, epic #111,
 * Shared-ADR-007).
 *
 * The physics-engine constants live once in `dicesuki-core`. These tests fail
 * closed if an engine constant reappears on the client's live config
 * (`physicsConfig.ts`) or if the browser stops sourcing engine values (arena
 * bounds) from the room's `EngineConfig` and hard-codes them again.
 *
 * The complementary half — that a constant edited in core reaches BOTH the native
 * server and the wasm room — is enforced in Rust (`server/core/src/config.rs`
 * `engine_config_reflects_physics_constants`), since both targets link that one
 * crate.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { getEngineConfig } from './engineConfig'
import type { EngineConfig, RoomStateMessage } from '../lib/multiplayerMessages'
// Vite `?raw` imports hand us the exact source text so the guard inspects what
// ships, not a re-export. (`vite/client` types these as `string`.)
import physicsConfigSrc from './physicsConfig.ts?raw'
import arenaSrc from '../components/multiplayer/MultiplayerArena.tsx?raw'

/**
 * Engine-physics constant names that MUST NOT be defined on the client's live
 * config file. Presence of any as an `export const` means the single source of
 * truth was forked back onto the client.
 */
const FORBIDDEN_ENGINE_EXPORTS = [
  'GRAVITY',
  'DICE_RESTITUTION',
  'DICE_FRICTION',
  'EDGE_CHAMFER_RADIUS',
  'LINEAR_VELOCITY_THRESHOLD',
  'ANGULAR_VELOCITY_THRESHOLD',
  'REST_DURATION_MS',
  'KNOCK_WAKE_LINEAR_SPEED',
  'KNOCK_WAKE_ANGULAR_SPEED',
  'ROLL_HORIZONTAL_MIN',
  'ROLL_HORIZONTAL_MAX',
  'ROLL_VERTICAL_MIN',
  'ROLL_VERTICAL_MAX',
  'ROLL_TORQUE_MAGNITUDE',
  'THROW_VELOCITY_SCALE',
  'THROW_UPWARD_BOOST',
  'MIN_THROW_SPEED',
  'MAX_THROW_SPEED',
  'MAX_DICE_VELOCITY',
  'DRAG_FOLLOW_SPEED',
  'DRAG_DISTANCE_BOOST',
  'DRAG_DISTANCE_THRESHOLD',
  'DRAG_SPIN_FACTOR',
  'DRAG_ROLL_FACTOR',
  'MULTIPLAYER_ARENA_HALF_X',
  'MULTIPLAYER_ARENA_HALF_Z',
] as const

describe('physicsConfig.ts carries no engine constants (Shared-ADR-007)', () => {
  it.each(FORBIDDEN_ENGINE_EXPORTS)('does not export %s', (name) => {
    // Exact `export const NAME =` — client sensor-scaling constants like
    // MOTION_ACCEL_SCALE are unaffected because the ` =` anchor pins the exact name.
    const pattern = new RegExp(`export const ${name}\\s*=`)
    expect(physicsConfigSrc).not.toMatch(pattern)
  })

  it('mentions no gravity/restitution/friction/torque engine numbers', () => {
    // The mission's grep guard: none of these engine feel words appear as a
    // numeric constant definition in the live client config.
    for (const word of ['restitution', 'friction', 'torque']) {
      const pattern = new RegExp(`const [A-Z_]*${word.toUpperCase()}[A-Z_]*\\s*=\\s*-?\\d`, 'i')
      expect(physicsConfigSrc).not.toMatch(pattern)
    }
    expect(physicsConfigSrc).not.toMatch(/export const GRAVITY\s*=\s*-?\d/)
  })

  it('points readers to dicesuki-core / EngineConfig for engine constants', () => {
    expect(physicsConfigSrc).toMatch(/dicesuki-core/)
    expect(physicsConfigSrc).toMatch(/EngineConfig/)
  })
})

describe('arena bounds come from the room EngineConfig, not a local constant', () => {
  it('MultiplayerArena reads arena bounds from engineConfig, not physicsConfig', () => {
    expect(arenaSrc).toMatch(/useEngineConfig/)
    expect(arenaSrc).not.toMatch(/MULTIPLAYER_ARENA_HALF_[XZ]/)
    expect(arenaSrc).not.toMatch(/from '.*physicsConfig'/)
  })
})

describe('the client receives engine constants from room_state, not a literal', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
  })

  it('room_state.config populates engineConfig and the arena bounds read from it', () => {
    // A room delivers a distinctive (non-default) arena so a hard-coded fallback
    // would visibly disagree with what the test asserts.
    const config: EngineConfig = {
      gravity: -9.81,
      diceRestitution: 0.3,
      diceFriction: 0.6,
      linearVelocityThreshold: 0.01,
      angularVelocityThreshold: 0.01,
      restDurationMs: 500,
      knockWakeLinearSpeed: 0.5,
      knockWakeAngularSpeed: 0.5,
      rollHorizontalMin: 1,
      rollHorizontalMax: 3,
      rollVerticalMin: 3,
      rollVerticalMax: 5,
      rollTorqueMagnitude: 5,
      throwVelocityScale: 0.8,
      throwUpwardBoost: 3,
      minThrowSpeed: 2,
      maxThrowSpeed: 20,
      maxDiceVelocity: 25,
      dragFollowSpeed: 12,
      dragDistanceBoost: 2.5,
      dragDistanceThreshold: 3,
      dragSpinFactor: 0.33,
      dragRollFactor: 0.5,
      motionFieldMaxAccel: 2500,
      motionFieldStaleMs: 200,
      arenaHalfX: 7.25, // deliberately non-default
      arenaHalfZ: 12.5, // deliberately non-default
      arenaGroundY: -0.5,
      arenaCeilingY: 6,
      arenaWallHeight: 8,
      arenaWallThickness: 0.5,
    }
    const roomState: RoomStateMessage = {
      type: 'room_state',
      roomId: 'solo',
      hostId: 'p1',
      localPlayerId: 'p1',
      players: [{ id: 'p1', displayName: 'You', color: '#8B5CF6' }],
      dice: [],
      settings: { version: 1 },
      config,
    }

    // Before joining, there is deliberately no local fallback.
    expect(getEngineConfig()).toBeNull()

    useMultiplayerStore.getState().handleServerMessage(roomState)

    const received = getEngineConfig()
    expect(received).not.toBeNull()
    expect(received?.arenaHalfX).toBe(7.25)
    expect(received?.arenaHalfZ).toBe(12.5)
    expect(received?.rollTorqueMagnitude).toBe(5)
  })
})
