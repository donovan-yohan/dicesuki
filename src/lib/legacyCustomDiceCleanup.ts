const LEGACY_DATABASE_NAME = 'DicesukiCustomDiceDB'
const LEGACY_DATABASE_PURGE_MARKER = 'dicesuki:legacy-custom-dice-db-purged:v1'

type LegacyCleanupDependencies = {
  databaseFactory?: Pick<IDBFactory, 'deleteDatabase'>
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

/**
 * Delete the retired customer-dice database once per browser profile.
 *
 * This is intentionally the only remaining IndexedDB code: inventory v6
 * removes all references to customer-authored models, while this versioned
 * cleanup releases the orphaned model bytes. A failed or blocked deletion is
 * left unmarked so a later startup retries it.
 */
export async function purgeLegacyCustomDiceDatabase(
  dependencies: LegacyCleanupDependencies = {},
): Promise<void> {
  const databaseFactory = dependencies.databaseFactory ?? globalThis.indexedDB
  const storage = dependencies.storage ?? globalThis.localStorage
  if (!databaseFactory || !storage || storage.getItem(LEGACY_DATABASE_PURGE_MARKER) === '1') {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const request = databaseFactory.deleteDatabase(LEGACY_DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Legacy custom-dice database deletion failed'))
    request.onblocked = () => reject(new Error('Legacy custom-dice database deletion was blocked'))
  })

  storage.setItem(LEGACY_DATABASE_PURGE_MARKER, '1')
}

