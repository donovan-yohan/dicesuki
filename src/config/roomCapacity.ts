/**
 * Room Capacity Configuration
 *
 * Client-side mirror of the room engine's hard dice cap. Kept here so the
 * builder, the saved-roll execution guard, and the pull-reveal "add to table"
 * flow all agree on one number.
 */

/**
 * Maximum number of dice a room holds at once.
 *
 * Server authority: `server/core/src/room.rs` `MAX_DICE`. The room rejects any
 * spawn that would push it past this with the `DICE_LIMIT` error code.
 * `EngineConfig` (Shared-ADR-007) does not project this room cap to the client
 * yet, so this is a hand-mirrored copy — change it only together with
 * `MAX_DICE`.
 *
 * Recommended range: exactly `MAX_DICE`. A lower client value silently makes
 * rolls unbuildable; a higher one lets the room reject them server-side.
 *
 * Saved-roll execution clears the table before spawning, so a single roll may
 * use the full capacity.
 */
export const ROOM_DICE_CAPACITY = 30

/**
 * Shared error copy for a roll that would exceed {@link ROOM_DICE_CAPACITY}.
 * Used by the roll builder (inline validation) and by the saved-roll execution
 * guard so a legacy over-cap roll fails with this message instead of a raw
 * server `DICE_LIMIT` rejection.
 */
export const ROLL_DICE_CAPACITY_MESSAGE = `Rolls are limited to ${ROOM_DICE_CAPACITY} dice`
