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

/**
 * The same guard for the `basic` marker (Shared-ADR-005 Amendment 1).
 *
 * A basic die is identified ONLY by this flag — never by its colours, since a
 * player may own a white die with black numbers. If the Rust side loses the
 * field, serde drops it on the way through the room and every basic die comes
 * back to the other clients unmarked: it would render in the owner's player
 * colour instead of white, and `isBasicDiePresentation` would report it as an
 * owned die. The prose invariant comments on both files cannot fail a build;
 * this can.
 */
describe('basic-die presentation marker (TS <-> Rust)', () => {
  const tsPresentation = block(
    tsSrc, /export interface DicePresentationMetadata \{[\s\S]*?\n\}/,
  )
  const rustPresentation = block(
    rustSrc, /pub struct DicePresentationMetadata \{[\s\S]*?\n\}/,
  )

  it('locates both DicePresentationMetadata definitions', () => {
    expect(tsPresentation).not.toBe('')
    expect(rustPresentation).not.toBe('')
  })

  it('declares `basic` on both sides of the wire', () => {
    expect(tsPresentation).toMatch(/\bbasic\?: boolean/)
    expect(rustPresentation).toMatch(/pub basic: Option<bool>/)
  })

  it('omits an unset `basic` from the Rust payload', () => {
    // Without `skip_serializing_if` the room would echo `"basic":null` on every
    // ordinary die, which is noise on every spawn and settle message.
    expect(rustPresentation).toMatch(
      /#\[serde\(skip_serializing_if = "Option::is_none"\)\]\s*\n\s*pub basic: Option<bool>/,
    )
  })
})
