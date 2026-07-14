import { describe, it, expect } from 'vitest'
// Vite `?raw` hands us the exact source text of each side of the protocol so the
// guard inspects what ships (matches the physicsConfig drift-guard convention).
import tsSrc from './multiplayerMessages.ts?raw'
import rustSrc from '../../server/core/src/messages.rs?raw'

/**
 * Drift guard (Shared-ADR-002): the `spawn_dice` transform fields must stay
 * defined on BOTH the client wire type and the Rust core struct, kept in sync by
 * hand. Carrying a solo room's dice into a server room (Shared-ADR-005) relies on
 * the server honoring `position`/`rotation`; if either side drops a field the
 * carry silently degrades to a random drop instead of failing loudly.
 */
function block(source: string, pattern: RegExp): string {
  return source.match(pattern)?.[0] ?? ''
}

describe('spawn_dice transform schema (TS <-> Rust)', () => {
  const tsEntry = block(tsSrc, /export interface SpawnDiceEntry \{[\s\S]*?\n\}/)
  const rustEntry = block(rustSrc, /pub struct SpawnDiceEntry \{[\s\S]*?\n\}/)

  it('locates both SpawnDiceEntry definitions', () => {
    expect(tsEntry).not.toBe('')
    expect(rustEntry).not.toBe('')
  })

  it('carries optional position + rotation on the client wire type', () => {
    expect(tsEntry).toMatch(/position\?: \[number, number, number\]/)
    expect(tsEntry).toMatch(/rotation\?: \[number, number, number, number\]/)
  })

  it('carries optional position + rotation on the Rust core struct', () => {
    expect(rustEntry).toMatch(/pub position: Option<\[f32; 3\]>/)
    expect(rustEntry).toMatch(/pub rotation: Option<\[f32; 4\]>/)
  })
})
