import { createStore } from 'zustand/vanilla'

// Domain lifetimes publish synchronously, before an asynchronous request starts.
// The update UI reads these holds; it never owns a pull or purchase.
const activity = createStore(() => ({ holds: new Set<symbol>(), activating: false }))
export const getPwaActivity = activity.getState
export const subscribePwaActivity = activity.subscribe
export function holdPwaActivity(): () => void {
  const token = Symbol()
  activity.setState(state => ({ holds: new Set([...state.holds, token]) }))
  return () => activity.setState(state => ({ holds: new Set([...state.holds].filter(value => value !== token)) }))
}
export function setPwaActivating(activating: boolean): void { activity.setState({ activating }) }
export function assertAccountMutationAvailable(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('You’re offline. Reconnect to make account changes.')
  }
  if (activity.getState().activating) throw new Error('An app update is in progress. Try again after reloading.')
}
