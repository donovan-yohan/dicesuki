import type { DiceShape } from './geometries'
import type { DicePresentationMetadata, RoomVisibility } from './multiplayerMessages'

/**
 * A single die captured from a solo room to be recreated in a fresh server room
 * at its resting transform (Shared-ADR-005). `presentation` carries the die's
 * owned/inventory identity + look; `position`/`rotation` reproduce where and how
 * it was sitting.
 */
export interface CarriedDie {
  diceType: DiceShape
  presentation?: DicePresentationMetadata
  position: [number, number, number]
  rotation: [number, number, number, number]
}

/** Half-extents of an arena floor on the X/Z plane (both arenas are origin-centered). */
export interface ArenaFootprint {
  halfX: number
  halfZ: number
}

/**
 * Everything the "Go Online" flow stashes in the solo panel and replays once the
 * new server room confirms the creator as host: the dice to recreate, the source
 * arena they were captured in (so their layout can be scaled to fit the — often
 * differently shaped — destination arena), the room-discovery choice, and the id
 * of the room this setup belongs to (so it can only ever be applied there).
 */
export interface PendingRoomSetup {
  /** Room this setup was created for; guards against applying it to another room. */
  roomId: string
  dice: CarriedDie[]
  /** Arena the dice positions were captured in, or `null` if it was unknown. */
  sourceArena: ArenaFootprint | null
  visibility: RoomVisibility
  /** Host-chosen public room name (blank when unlisted / left empty). */
  roomName: string
}

/**
 * Hand-off buffer between the solo room and the fresh server room. It is a plain
 * module-level singleton because the "Create Room" flow navigates within the
 * same SPA session (no reload): the create flow writes it once the server has
 * assigned a room id, and `MultiplayerRoom` consumes it (for that exact room)
 * after `room_state` confirms the creator as host. A single pending setup exists
 * at a time.
 */
let pending: PendingRoomSetup | null = null

/** Stash the setup to replay in the room we just created. */
export function setPendingRoomSetup(setup: PendingRoomSetup): void {
  pending = setup
}

/**
 * Take and clear the pending setup, but only if it belongs to `roomId`. Returns
 * `null` (leaving any mismatched setup untouched) when there is nothing to carry
 * for this room — so a setup created for room A can never be applied to room B.
 */
export function consumePendingRoomSetup(roomId: string): PendingRoomSetup | null {
  if (!pending || pending.roomId !== roomId) return null
  const setup = pending
  pending = null
  return setup
}

/** Discard any pending setup without applying it. */
export function clearPendingRoomSetup(): void {
  pending = null
}

/**
 * Scale a carried layout to fit the destination arena, preserving relative
 * arrangement and every die's orientation (so faces are unchanged). The two
 * arenas usually differ — solo is sized to the browser viewport while a server
 * room uses the fixed 9:16 arena — so positions captured in a larger arena must
 * be pulled inward or they'd be hard-clamped onto the wall and pile up.
 *
 * Only the X/Z plane is scaled (Y is a die's resting height, arena-independent),
 * and only ever *down* (`scale ≤ 1`): if the destination is larger the dice
 * already fit, so we leave them where they were rather than pushing them apart.
 */
export function fitCarriedDice(
  dice: CarriedDie[],
  source: ArenaFootprint | null,
  destination: ArenaFootprint | null,
): CarriedDie[] {
  if (!source || !destination || source.halfX <= 0 || source.halfZ <= 0) {
    return dice
  }
  const scale = Math.min(1, destination.halfX / source.halfX, destination.halfZ / source.halfZ)
  if (scale >= 1) return dice
  return dice.map((die) => ({
    ...die,
    position: [die.position[0] * scale, die.position[1], die.position[2] * scale],
  }))
}
