import { describe, it, expect } from 'vitest'
// Vite `?raw` gives the exact source text of each side of the protocol.
import tsSrc from './multiplayerMessages.ts?raw'
import rustSrc from '../../server/core/src/messages.rs?raw'

/**
 * Drift guard (Shared-ADR-002 / ADR-009): the arena-resize messages must stay
 * defined on BOTH the client wire types and the Rust core enums, kept in sync by
 * hand. If either side drops `set_arena` / `arena_changed`, host resize silently
 * breaks instead of failing loudly.
 */
describe('arena resize protocol (TS <-> Rust)', () => {
  it('the client declares set_arena (out) and arena_changed (in)', () => {
    expect(tsSrc).toMatch(/interface SetArenaMessage \{[\s\S]*?type: 'set_arena'[\s\S]*?aspect: number/)
    expect(tsSrc).toMatch(/interface ArenaChangedMessage \{[\s\S]*?type: 'arena_changed'[\s\S]*?config: EngineConfig/)
    // Registered in the unions.
    expect(tsSrc).toMatch(/\|\s*SetArenaMessage/)
    expect(tsSrc).toMatch(/\|\s*ArenaChangedMessage/)
  })

  it('the Rust core declares SetArena (client) and ArenaChanged (server)', () => {
    expect(rustSrc).toMatch(/SetArena \{\s*aspect: f32/)
    expect(rustSrc).toMatch(/ArenaChanged \{\s*config: crate::config::EngineConfig/)
  })
})
