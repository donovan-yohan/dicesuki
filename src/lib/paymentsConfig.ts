/**
 * Payments feature flag (Xsolla sandbox checkout — Packet C, issue #153).
 *
 * The entire client payments surface is gated behind {@link isPaymentsEnabled}.
 * The flag defaults to OFF: with `VITE_PAYMENTS_ENABLED` absent, NOTHING
 * payment-related renders and the Pay Station SDK is never code-loaded (the SDK
 * lives behind a dynamic import that only the buy flow reaches — see
 * {@link file://./paymentsCheckout.ts}).
 *
 * Go-live is a single build-time env switch, not a code change: real payments
 * remain blocked on the Xsolla merchant agreement, so this ships dark.
 *
 * The flag is read defensively (mirroring {@link file://./supabaseClient.ts}) so
 * a fresh checkout with no `.env.local` never throws and never logs.
 */

/** Truthy string values that turn the payments surface ON. */
const ENABLED_VALUES: ReadonlySet<string> = new Set(['true', '1', 'on', 'yes'])

function readFlag(): string | undefined {
  try {
    // Cast: `VITE_PAYMENTS_ENABLED` is intentionally undeclared in
    // `vite-env.d.ts` (that file is out of this packet's ownership); the
    // vite/client index signature keeps it typed as `any`, but we narrow here.
    const env = import.meta.env as unknown as Record<string, unknown> | undefined
    const value = env?.VITE_PAYMENTS_ENABLED
    return typeof value === 'string' ? value.trim().toLowerCase() : undefined
  } catch {
    return undefined
  }
}

/**
 * True only when `VITE_PAYMENTS_ENABLED` is explicitly enabled. Every payment
 * component and the buy-flow entry point gate on this; when false the app is
 * byte-identical to a build with no payments code path exercised.
 */
export function isPaymentsEnabled(): boolean {
  const value = readFlag()
  return value !== undefined && ENABLED_VALUES.has(value)
}

/**
 * Whether checkout runs against Xsolla's sandbox. This slice is sandbox-only by
 * design (real payments blocked on the merchant agreement); go-live flips this
 * server-side (`XSOLLA_SANDBOX`) and, if ever exposed, a dedicated client flag —
 * never by trusting the client. Kept as a function for a single source of truth.
 */
export function isPaymentsSandbox(): boolean {
  return true
}
