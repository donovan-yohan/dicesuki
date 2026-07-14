/**
 * Shared-arena shape presets for the host resize control (Shared-ADR-009).
 *
 * Every preset is an aspect ratio (width / height). The server derives
 * area-preserving bounds via `ArenaBounds::from_aspect`, so 16:9 is the transpose
 * of 9:16 and 1:1 is square — all keeping the same playfield area. The arena
 * bounds ratio (`arenaHalfX / arenaHalfZ`) equals the aspect, so the active preset
 * can be recovered from the room's current bounds.
 */
export type ArenaPresetId = '9:16' | '1:1' | '16:9'

export interface ArenaPreset {
  id: ArenaPresetId
  label: string
  aspect: number
}

export const ARENA_PRESETS: ArenaPreset[] = [
  { id: '9:16', label: 'Portrait', aspect: 9 / 16 },
  { id: '1:1', label: 'Square', aspect: 1 },
  { id: '16:9', label: 'Landscape', aspect: 16 / 9 },
]

/**
 * Aspect (width / height) of the current browser window, for the host "Fit my
 * window" preset and solo "Auto". Falls back to portrait 9:16 in non-DOM or
 * degenerate (zero-height) cases.
 */
export function windowAspect(): number {
  if (typeof window === 'undefined' || window.innerHeight === 0) return 9 / 16
  return window.innerWidth / window.innerHeight
}

/**
 * The preset whose aspect matches the room's current arena bounds, or `null` for
 * a custom aspect (e.g. a fitted window shape). Used to highlight the active
 * preset button.
 */
export function activeArenaPreset(arenaHalfX: number, arenaHalfZ: number): ArenaPresetId | null {
  if (arenaHalfZ <= 0) return null
  const aspect = arenaHalfX / arenaHalfZ
  const match = ARENA_PRESETS.find((preset) => Math.abs(preset.aspect - aspect) < 0.02)
  return match ? match.id : null
}
