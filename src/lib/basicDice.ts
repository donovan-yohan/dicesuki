/**
 * Basic dice — the infinite floor of every player's collection.
 *
 * A basic die is the most bare-minimum die the game can put on a table: a white
 * body with plain black numerals and no set, rarity, material feel or custom
 * mesh. Every player has an unlimited supply, they never appear in the
 * inventory, and they are what the game reaches for whenever a roll wants more
 * dice of a type than the player actually owns.
 *
 * ## Why they carry a presentation block
 *
 * A die spawned with NO `presentation` renders in its OWNER'S PLAYER COLOUR
 * (`MultiplayerDie.tsx`, `presentation?.baseColor ?? color`). That fallback is
 * fine for a die belonging to some other client we know nothing about, but it is
 * the wrong look for a die this client deliberately chose to spawn: the player
 * asked for a plain die, not a purple one. So every basic die spawns with the
 * explicit block below, and the owner-colour fallback survives only for dice
 * originated elsewhere.
 *
 * Nothing in the block identifies an owned die — no `inventoryDieId`, no
 * `setId`, no `rarity` — so basics stay invisible to the toolbar's
 * owned-and-available count, set completion, selling and stats, all of which key
 * on `inventoryDieId`.
 *
 * ## Wire contract
 *
 * `basic` is mirrored on `DicePresentationMetadata` in
 * `server/core/src/messages.rs` (Shared-ADR-002 manual sync). The room never
 * interprets it; like the rest of `presentation` it is opaque display metadata
 * echoed back on `dice_spawned` and `roll_complete`, which is what lets a
 * reconnecting client — and every other player in the room — see a basic die as
 * a basic die.
 */

import type { DicePresentationMetadata } from './multiplayerMessages'
import type { DiceShape } from './geometries'
import { formatDiceShapeLabel } from './percentileRolls'

/** Body colour of a basic die: plain white. */
export const BASIC_DIE_BASE_COLOR = '#ffffff'

/** Numeral colour of a basic die: plain black. Mirrors `BASIC_GLYPH_STYLE`. */
export const BASIC_DIE_ACCENT_COLOR = '#000000'

/**
 * Physics/PBR material of a basic die. `plastic` is the tuned default on both
 * sides of the wire (`server/core/src/dice.rs::material_physics`, `MATERIAL_PBR`
 * in `diceMaterial.ts`), so a basic die rolls and shades like an ordinary die
 * and differs only in its ink.
 */
export const BASIC_DIE_MATERIAL = 'plastic'

/**
 * Human-readable name for a basic die, e.g. `Basic D20`. Shown wherever an owned
 * die would show its nickname (roll tray, history, result chips), so a basic die
 * reads as a deliberate stand-in rather than an unnamed mystery.
 */
export function basicDieDisplayName(shape: DiceShape): string {
  return `Basic ${formatDiceShapeLabel(shape)}`
}

/**
 * The presentation block every basic die spawns with.
 *
 * Returns a fresh object each call: presentation blocks are merged into
 * (`mergePresentation` in `useMultiplayerDiceBackend`) and shipped over the
 * wire, so a shared frozen instance would be a mutation hazard for no gain.
 */
export function createBasicDicePresentation(shape: DiceShape): DicePresentationMetadata {
  return {
    basic: true,
    displayName: basicDieDisplayName(shape),
    baseColor: BASIC_DIE_BASE_COLOR,
    accentColor: BASIC_DIE_ACCENT_COLOR,
    material: BASIC_DIE_MATERIAL,
  }
}

/**
 * Is this die a basic die?
 *
 * Keyed on the explicit `basic` flag, never on the colours: a player may
 * legitimately own a white die with black numbers, and it must keep its own
 * material, mesh and set flair.
 */
export function isBasicDiePresentation(
  presentation?: DicePresentationMetadata,
): boolean {
  return presentation?.basic === true
}
