import { expect, it } from 'vitest'
import { cacheAssetWithinBudget } from './pwaAssetCache'

function memoryCache() {
  const entries = new Map<string, Response>()
  return {
    entries,
    cache: {
      keys: async () => [...entries.keys()].map(url => new Request(url)),
      match: async (key: Request) => entries.get(key.url)?.clone(),
      delete: async (key: Request) => entries.delete(key.url),
      put: async (key: Request, value: Response) => { entries.set(key.url, value.clone()) },
    } as unknown as Cache,
  }
}
it('bounds bytes independently from entry count and evicts oldest assets', async () => {
  const { cache, entries } = memoryCache()
  const budget = { maxBytes: 10, maxEntryBytes: 8, maxEntries: 100 }
  await cacheAssetWithinBudget(cache, new Request('https://game.test/dice/a.glb'), new Response('123456'), budget)
  await cacheAssetWithinBudget(cache, new Request('https://game.test/dice/b.glb'), new Response('123456'), budget)
  expect([...entries.keys()]).toEqual(['https://game.test/dice/b.glb'])
  await cacheAssetWithinBudget(cache, new Request('https://game.test/dice/huge.glb'), new Response('123456789'), budget)
  expect(entries.size).toBe(1)
})
it('does not cache partial, opaque or failed responses', async () => {
  const { cache, entries } = memoryCache()
  for (const status of [206, 404, 500]) await cacheAssetWithinBudget(cache, new Request('https://game.test/dice/a.glb'), new Response('bytes', { status }))
  expect(entries.size).toBe(0)
})
it('an interrupted put leaves no separate accounting record or poisoned cache hit', async () => {
  const { cache, entries } = memoryCache()
  cache.put = async () => { throw new Error('quota') }
  await expect(cacheAssetWithinBudget(cache, new Request('https://game.test/dice/a.glb'), new Response('bytes'))).resolves.toBe(false)
  expect(entries.size).toBe(0)
})
