import { useSyncExternalStore } from 'react'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useAuthStore } from '../../store/useAuthStore'
import { useInventoryStore } from '../../store/useInventoryStore'
import { getInventoryHydration, startSync, subscribeInventoryHydration } from '../../lib/dataSync'

/** A display receipt, never an offline ownership grant or persisted copy list. */
export function AccountOfflineNotice() {
  const online = useOnlineStatus()
  const userId = useAuthStore(state => state.user?.id ?? null)
  const status = useAuthStore(state => state.status)
  const hasSnapshot = useInventoryStore(state => state.serverCopiesActive)
  const hydration = useSyncExternalStore(subscribeInventoryHydration, getInventoryHydration)
  const signedIn = status === 'authenticated' && userId !== null
  if (!online) return <div role="status" className="mb-3 space-y-1 text-sm">
    <p>{signedIn ? 'Offline · Account changes are paused.' : 'You’re offline. You can still roll solo.'}</p>
    {signedIn && <p>{hasSnapshot ? 'Showing your last synced collection. Reconnect to make account changes.' : 'Reconnect to load your collection.'}</p>}
  </div>
  if (!signedIn || (hydration.userId === userId && hydration.status === 'ready')) return null
  return <div className="mb-3 text-sm">
    <p role="status">{hydration.status === 'pending' ? 'Refreshing your collection…' : 'Couldn’t refresh your collection. Try again.'}</p>
    {hydration.status !== 'pending' && <button type="button" className="min-h-11 underline" onClick={() => { void startSync(userId, { refresh: true }).catch(() => {}) }}>Try again</button>}
  </div>
}
