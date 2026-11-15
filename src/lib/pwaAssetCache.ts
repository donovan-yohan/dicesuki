export const ASSET_CACHE_NAME = 'dicesuki-dice-assets-v2'
export const ASSET_CACHE_BUDGET = { maxBytes: 192 * 1024 * 1024, maxEntryBytes: 24 * 1024 * 1024, maxEntries: 256 }
type AssetBudget = typeof ASSET_CACHE_BUDGET
const BYTE_HEADER = 'x-dicesuki-cached-bytes'
/** Caller serializes writes. Cache entry and byte receipt are one atomic put. */
export async function cacheAssetWithinBudget(cache: Cache, request: Request, response: Response, budget: AssetBudget = ASSET_CACHE_BUDGET): Promise<boolean> {
  if (response.status !== 200 || response.type === 'opaque' || !response.body) return false
  const reader = response.clone().body!.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    let part = await reader.read()
    while (!part.done) {
      const value = part.value
      bytes += value.byteLength
      if (bytes > budget.maxEntryBytes || bytes > budget.maxBytes) {
        void reader.cancel().catch(() => {})
        return false
      }
      chunks.push(value)
      part = await reader.read()
    }
    const keys = await cache.keys()
    let total = bytes
    const sizes = await Promise.all(keys.map(async key => {
      const size = Number((await cache.match(key))?.headers.get(BYTE_HEADER))
      return Number.isSafeInteger(size) && size > 0 ? size : Infinity
    }))
    // Replacement is not charged twice. Unknown/legacy sizes fail closed.
    for (let i = 0; i < keys.length; i++) if (keys[i].url !== request.url) total += sizes[i]
    let count = keys.filter(key => key.url !== request.url).length + 1
    for (let i = 0; i < keys.length && (total > budget.maxBytes || count > budget.maxEntries); i++) {
      if (keys[i].url === request.url) continue
      await cache.delete(keys[i])
      count--
      total = bytes
      for (let j = i + 1; j < keys.length; j++) if (keys[j].url !== request.url) total += sizes[j]
    }
    const headers = new Headers(response.headers)
    headers.set(BYTE_HEADER, String(bytes))
    const body = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
    await cache.put(request, new Response(body, { status: 200, headers }))
    return true
  } catch { return false }
}
