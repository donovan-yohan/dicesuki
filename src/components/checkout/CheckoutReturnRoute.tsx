/**
 * CheckoutReturnRoute — flag gate for the `/checkout/return` route (Packet C).
 *
 * Default export so `App.tsx` can `React.lazy()` it: when payments are disabled
 * the route is never registered, so this module (and everything it pulls in) is
 * never even imported. When enabled, it renders the status-only return screen.
 * The extra flag check here is defense-in-depth for any direct navigation.
 */

import { isPaymentsEnabled } from '../../lib/paymentsConfig'
import { CheckoutReturn } from './CheckoutReturn'

export function CheckoutReturnRoute() {
  if (!isPaymentsEnabled()) return null
  return <CheckoutReturn />
}

export default CheckoutReturnRoute
