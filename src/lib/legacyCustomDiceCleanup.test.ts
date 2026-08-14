import { describe, expect, it, vi } from 'vitest'
import { purgeLegacyCustomDiceDatabase } from './legacyCustomDiceCleanup'

function makeStorage() {
  const values = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  }
}

function makeDatabaseFactory(outcome: 'success' | 'error' | 'blocked' = 'success') {
  const deleteDatabase = vi.fn(() => {
    const request = {
      error: outcome === 'error' ? new Error('delete failed') : null,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
    }
    queueMicrotask(() => request[`on${outcome}`]?.(new Event(outcome)))
    return request as unknown as IDBOpenDBRequest
  })
  return { deleteDatabase }
}

describe('purgeLegacyCustomDiceDatabase', () => {
  it('deletes the exact retired database once and records the versioned cleanup', async () => {
    const databaseFactory = makeDatabaseFactory()
    const storage = makeStorage()

    await purgeLegacyCustomDiceDatabase({ databaseFactory, storage })
    await purgeLegacyCustomDiceDatabase({ databaseFactory, storage })

    expect(databaseFactory.deleteDatabase).toHaveBeenCalledOnce()
    expect(databaseFactory.deleteDatabase).toHaveBeenCalledWith('DicesukiCustomDiceDB')
    expect(storage.setItem).toHaveBeenCalledWith(
      'dicesuki:legacy-custom-dice-db-purged:v1',
      '1',
    )
  })

  it.each(['error', 'blocked'] as const)('retries after a %s result', async (outcome) => {
    const databaseFactory = makeDatabaseFactory(outcome)
    const storage = makeStorage()

    await expect(purgeLegacyCustomDiceDatabase({ databaseFactory, storage })).rejects.toThrow()

    expect(databaseFactory.deleteDatabase).toHaveBeenCalledOnce()
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})

