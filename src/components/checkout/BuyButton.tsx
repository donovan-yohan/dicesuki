/**
 * BuyButton — the sole flag-gated entry point to the sandbox buy flow (Packet C).
 *
 * Renders NOTHING when payments are disabled (default), so no payment UI and no
 * path to the Pay Station SDK exists in a stock build. When enabled, a click
 * runs {@link startPurchase}: create-checkout → persist pending order → open the
 * headless SDK. The SDK is only ever imported inside that flow, on demand.
 */

import { useCallback, useState } from 'react'
import { isPaymentsEnabled } from '../../lib/paymentsConfig'
import { startPurchase } from '../../lib/paymentsClient'

export interface BuyButtonProps {
  /** Catalog SKU to purchase. Price/validation is resolved server-side. */
  sku: string
  /** Button label; defaults to a generic "Buy". */
  children?: React.ReactNode
  className?: string
  /** Notified with the failure reason when a purchase cannot start. */
  onError?: (message: string) => void
}

export function BuyButton({ sku, children, className, onError }: BuyButtonProps) {
  const [busy, setBusy] = useState(false)

  const handleClick = useCallback(async () => {
    setBusy(true)
    try {
      const result = await startPurchase(sku)
      if (!result.ok) onError?.(result.message)
    } finally {
      setBusy(false)
    }
  }, [sku, onError])

  // Flag OFF ⇒ nothing payment-related renders (and startPurchase is unreachable).
  if (!isPaymentsEnabled()) return null

  return (
    <button
      type="button"
      data-testid="buy-button"
      disabled={busy}
      onClick={handleClick}
      className={
        className ??
        'inline-flex items-center rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 [background-color:var(--startup-splash-text)] [color:var(--startup-splash-bg)]'
      }
    >
      {children ?? (busy ? 'Opening checkout…' : 'Buy')}
    </button>
  )
}

export default BuyButton
