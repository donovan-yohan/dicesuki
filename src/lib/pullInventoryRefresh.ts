import type { SupabaseClient } from '@supabase/supabase-js'
import { useInventoryStore } from '../store/useInventoryStore'
import { useWalletStore } from '../store/useWalletStore'
import { fetchCatalogSnapshot } from './collectibleCatalog'
import { fetchMyDiceCopies } from './diceCopies'
import {
  createPullInventorySnapshot,
  type PullInventorySnapshot,
} from './pullFlow'

/**
 * One-shot post-commit reconciliation for copy identity/count, playable
 * inventory, ticket/Dust balances, and reveal assembly.
 */
export async function refreshPullInventory(
  client: SupabaseClient,
): Promise<PullInventorySnapshot> {
  const [copies, catalog] = await Promise.all([
    fetchMyDiceCopies(client),
    fetchCatalogSnapshot(client),
  ])
  if (!catalog) throw new Error('Pull inventory refresh could not read the catalog')
  const snapshot = createPullInventorySnapshot(copies, catalog)
  if (!snapshot) throw new Error('Pull inventory refresh could not assemble playable copies')
  if (!useInventoryStore.getState().syncServerCopies(copies, catalog)) {
    throw new Error('Pull inventory refresh could not update the playable inventory')
  }
  // The atomic commit receipt is success truth. Wallet reconciliation remains
  // best-effort so a Realtime/read outage cannot turn a won die into a failure.
  void useWalletStore.getState().refresh(client).catch(() => {})
  return snapshot
}
