/**
 * useOnlineStatus — reactive network reachability (issue #116).
 *
 * Solo play works fully offline (in-browser WASM room), but every multiplayer
 * entry point (create room, room browser) needs the network. This hook lets the
 * UI degrade those entry points with a clear message instead of letting a user
 * tap into a flow that can only time out.
 *
 * Backed by the browser's `navigator.onLine` plus the `online`/`offline`
 * events. `navigator.onLine` is a coarse signal (it reports link-layer
 * connectivity, not reachability of any given host), so treat it as "definitely
 * offline" vs "probably online" — good enough to gate an entry point.
 */

import { useSyncExternalStore } from 'react'

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

function getSnapshot(): boolean {
  // Default to online when the API is unavailable (non-browser / old engines).
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

function getServerSnapshot(): boolean {
  return true
}

/** Returns `true` when the browser reports a network connection. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
