/**
 * Trash drop-zone hit testing.
 *
 * The DiceToolbar renders a trash target (`TrashButton`) carrying this DOM id.
 * The drag hook (`useMultiplayerDrag`) queries whether a pointer release lands
 * over that element to decide between deleting the die and throwing it. Keeping
 * the id and the hit-test in one place stops the two call sites from drifting.
 */

/** DOM `id` of the trash drop target rendered by `DiceToolbar`'s `TrashButton`. */
export const TRASH_DROP_ZONE_ID = 'trash-drop-zone'

/**
 * True when the viewport point (`clientX`/`clientY`) falls within the trash drop
 * zone's bounds. Returns `false` when the zone is not mounted, so callers can use
 * it unconditionally.
 */
export function isOverTrashZone(clientX: number, clientY: number): boolean {
  const trashZone = document.getElementById(TRASH_DROP_ZONE_ID)
  if (!trashZone) return false

  const rect = trashZone.getBoundingClientRect()
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  )
}
