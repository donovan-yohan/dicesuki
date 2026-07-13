/**
 * Engine config accessors (epic #111, Shared-ADR-007).
 *
 * The physics engine constants live **once** in `dicesuki-core`
 * (`server/core/src/physics.rs`). The browser obtains any engine value it needs
 * at runtime from the room it joined — the `room_state.config` payload the room
 * (native server OR in-browser wasm worker) sends on join — rather than from a
 * copied literal in `physicsConfig.ts`. This module is the client's single read
 * point for those values; it reads the config the room delivered into
 * `useMultiplayerStore`.
 *
 * Components render only once `connectionStatus === 'connected'`, by which point
 * `room_state` (and therefore `config`) has been applied, so the value is present
 * wherever the app actually consumes it. Accessors return `null` before a room
 * exists; callers guard accordingly (there is deliberately no hard-coded
 * fallback — a fallback literal would be exactly the drift this supersedes).
 */
import type { EngineConfig } from '../lib/multiplayerMessages'
import { useMultiplayerStore } from '../store/useMultiplayerStore'

export type { EngineConfig }

/** React hook: the engine config the current room delivered, or `null`. */
export function useEngineConfig(): EngineConfig | null {
  return useMultiplayerStore((s) => s.engineConfig)
}

/** Non-React read of the current room's engine config, or `null`. */
export function getEngineConfig(): EngineConfig | null {
  return useMultiplayerStore.getState().engineConfig
}
