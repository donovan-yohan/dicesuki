// Xsolla webhook signature verification (invariant #3 — "forged webhook fails closed").
//
// Xsolla signs every webhook with:
//   Authorization: Signature <sha1( raw_request_body_bytes ++ project_secret_key )>
// where the digest is lowercase hex. The concatenation is over the RAW request
// body BYTES exactly as received — never a re-serialized JSON string. Even a
// whitespace or key-order difference would change the digest and (correctly)
// fail verification, which is why callers MUST pass the raw bytes read straight
// off the request, not `JSON.stringify(await req.json())`.
//
// This module is intentionally free of any Deno-specific globals or URL imports
// so it runs unchanged under the Supabase Edge (Deno) runtime AND under Vitest
// (Node). It uses the Web Crypto API (`crypto.subtle`), which both provide.

/** SHA-1 digest of `bytes`, returned as lowercase hex. */
export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  const view = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Compute the Xsolla signature for a webhook: `sha1(raw_body ++ secret)`.
 * Concatenation happens at the byte level so the raw body is never mutated.
 */
export async function computeXsollaSignature(
  rawBody: Uint8Array,
  secret: string,
): Promise<string> {
  const secretBytes = new TextEncoder().encode(secret)
  const combined = new Uint8Array(rawBody.length + secretBytes.length)
  combined.set(rawBody, 0)
  combined.set(secretBytes, rawBody.length)
  return await sha1Hex(combined)
}

/**
 * Extract the hex signature from an `Authorization: Signature <hex>` header.
 * The scheme keyword is matched case-insensitively; surrounding whitespace is
 * trimmed. Returns `null` when the header is missing or malformed.
 */
export function extractSignature(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null
  const trimmed = authHeader.trim()
  const match = /^signature\s+([0-9a-fA-F]+)$/i.exec(trimmed)
  if (!match) return null
  return match[1].toLowerCase()
}

/**
 * Constant-time comparison of two hex strings. Runs in time proportional to the
 * longer input and never short-circuits on the first differing character, so it
 * does not leak how much of a forged signature was correct.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const aLower = a.toLowerCase()
  const bLower = b.toLowerCase()
  // Length is not secret (SHA-1 hex is always 40 chars); folding it into the
  // accumulator keeps the compare branch-free while still rejecting mismatches.
  let diff = aLower.length ^ bLower.length
  const max = Math.max(aLower.length, bLower.length)
  for (let i = 0; i < max; i++) {
    const ca = i < aLower.length ? aLower.charCodeAt(i) : 0
    const cb = i < bLower.length ? bLower.charCodeAt(i) : 0
    diff |= ca ^ cb
  }
  return diff === 0
}

/**
 * Full verification: recompute the expected signature over the raw body and the
 * shared secret, then constant-time compare against the header. Returns `false`
 * (fail closed) on any missing/malformed input.
 */
export async function verifyXsollaSignature(
  rawBody: Uint8Array,
  secret: string,
  authHeader: string | null | undefined,
): Promise<boolean> {
  if (!secret) return false
  const provided = extractSignature(authHeader)
  if (!provided) return false
  const expected = await computeXsollaSignature(rawBody, secret)
  return timingSafeEqualHex(provided, expected)
}
