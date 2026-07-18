// Deno absent in this environment (checked: `which deno` → not found; Supabase
// CLI 2.109.1 present but bundles no standalone deno). Per the exec plan these
// signature tests run under Vitest (`npm test`) instead. They import ONLY the
// pure `xsollaSignature` module, which uses the Web Crypto API — present in the
// Vitest jsdom env, in Node (v22), and in the Deno edge runtime — so passing
// here proves the Deno path too.

import { describe, it, expect } from 'vitest'
import {
  sha1Hex,
  computeXsollaSignature,
  extractSignature,
  timingSafeEqualHex,
  verifyXsollaSignature,
} from './xsollaSignature.ts'

const enc = (s: string) => new TextEncoder().encode(s)

describe('sha1Hex', () => {
  it('matches known SHA-1 vectors', async () => {
    expect(await sha1Hex(enc(''))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    expect(await sha1Hex(enc('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })
})

describe('computeXsollaSignature', () => {
  it('is sha1(raw_body ++ secret), lowercase hex — known answer', async () => {
    // sha1("hello" + "secret") = sha1("hellosecret")
    const sig = await computeXsollaSignature(enc('hello'), 'secret')
    expect(sig).toBe('13b27c4bd15a89b3e3cceea7a7844b140c0e29dc')
  })

  it('preserves raw-body fidelity: re-serialized JSON yields a different digest', async () => {
    // Body with insignificant whitespace — the exact bytes Xsolla signed.
    const raw = '{ "notification_type":  "payment" }'
    const reserialized = JSON.stringify(JSON.parse(raw)) // {"notification_type":"payment"}
    expect(reserialized).not.toBe(raw)
    const sigRaw = await computeXsollaSignature(enc(raw), 'secret')
    const sigReserialized = await computeXsollaSignature(enc(reserialized), 'secret')
    expect(sigRaw).not.toBe(sigReserialized)
  })
})

describe('extractSignature', () => {
  it('parses "Signature <hex>" case-insensitively and lowercases', () => {
    expect(extractSignature('Signature ABCDEF0123')).toBe('abcdef0123')
    expect(extractSignature('signature abcdef0123')).toBe('abcdef0123')
    expect(extractSignature('  SIGNATURE   deadBEEF  ')).toBe('deadbeef')
  })

  it('returns null for missing or malformed headers', () => {
    expect(extractSignature(null)).toBeNull()
    expect(extractSignature(undefined)).toBeNull()
    expect(extractSignature('')).toBeNull()
    expect(extractSignature('Bearer abc123')).toBeNull()
    expect(extractSignature('Signature not-hex-zz')).toBeNull()
    expect(extractSignature('abcdef')).toBeNull()
  })
})

describe('timingSafeEqualHex', () => {
  it('is true only for equal hex (case-insensitive)', () => {
    expect(timingSafeEqualHex('abcdef', 'abcdef')).toBe(true)
    expect(timingSafeEqualHex('ABCDEF', 'abcdef')).toBe(true)
    expect(timingSafeEqualHex('abcdef', 'abcde0')).toBe(false)
    expect(timingSafeEqualHex('abcdef', 'abcd')).toBe(false)
    expect(timingSafeEqualHex('', '')).toBe(true)
  })
})

describe('verifyXsollaSignature (fail closed)', () => {
  const raw = enc('{"notification_type":"payment","transaction":{"id":42}}')
  const secret = 'topsecret'

  it('accepts a correct signature', async () => {
    const sig = await computeXsollaSignature(raw, secret)
    expect(await verifyXsollaSignature(raw, secret, `Signature ${sig}`)).toBe(true)
  })

  it('rejects a forged signature (tampered body)', async () => {
    const sig = await computeXsollaSignature(raw, secret)
    const tampered = enc('{"notification_type":"payment","transaction":{"id":43}}')
    expect(await verifyXsollaSignature(tampered, secret, `Signature ${sig}`)).toBe(false)
  })

  it('rejects a signature computed with the wrong secret', async () => {
    const sig = await computeXsollaSignature(raw, 'wrong-secret')
    expect(await verifyXsollaSignature(raw, secret, `Signature ${sig}`)).toBe(false)
  })

  it('rejects a missing Authorization header', async () => {
    expect(await verifyXsollaSignature(raw, secret, null)).toBe(false)
  })

  it('rejects when the secret is unset (fails closed)', async () => {
    const sig = await computeXsollaSignature(raw, secret)
    expect(await verifyXsollaSignature(raw, '', `Signature ${sig}`)).toBe(false)
  })
})
