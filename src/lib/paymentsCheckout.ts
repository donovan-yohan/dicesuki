/**
 * Pay Station SDK boundary (Packet C, issue #153).
 *
 * This is the ONLY module that references `@xsolla/pay-station-sdk`, and it does
 * so through a dynamic `import()`. Consequences, both required by the packet:
 *
 *  - Flag OFF ⇒ the buy flow ({@link file://./paymentsClient.ts}) never calls
 *    {@link openHeadlessCheckout}, so the SDK is never code-loaded.
 *  - The SDK (~795 KB) is split by Rollup into its own async chunk; nothing in
 *    the eager app graph statically imports it, so it stays out of the main
 *    bundle even when the flag is on.
 *
 * The SDK is fully headless: card-field web components must be mounted to
 * complete a real payment. That form UI is deliberately out of this
 * sandbox-groundwork slice — here we initialize the SDK in the correct mode and
 * hand it the server-minted access token, which is the integration seam the rest
 * of Packet C depends on.
 */

export interface OpenCheckoutOptions {
  /** Xsolla Pay Station access token returned by the `create-checkout` fn. */
  token: string
  /** Run against Xsolla's sandbox. Sandbox-only in this slice. */
  sandbox?: boolean
}

/**
 * Dynamically load the Pay Station SDK, initialize it in (sandbox) mode, and
 * bind the payment token. Kept intentionally tiny so it is trivially mockable in
 * tests without ever importing the real SDK into jsdom.
 */
export async function openHeadlessCheckout(
  options: OpenCheckoutOptions,
): Promise<void> {
  const { token, sandbox = true } = options
  const { headlessCheckout } = await import('@xsolla/pay-station-sdk')
  await headlessCheckout.init({ sandbox })
  await headlessCheckout.setToken(token)
}
