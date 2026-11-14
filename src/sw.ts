/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { setCacheNameDetails, cacheNames } from 'workbox-core'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { createPartialResponse } from 'workbox-range-requests'
import { ASSET_CACHE_NAME, cacheAssetWithinBudget } from './lib/pwaAssetCache'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }
const manifest = self.__WB_MANIFEST as Array<{ url: string; revision: string | null }>
const shell = manifest.find(entry => entry.url === 'index.html')
if (!shell?.revision) throw new Error('Missing versioned app shell')
// Separate versions before activation. Installing B must not rewrite A's
// precache, and an old lazy chunk remains available until A's clients retire.
setCacheNameDetails({ suffix: `dicesuki-${shell.revision}` })
precacheAndRoute(manifest)
registerRoute(({ url }) => url.origin === self.location.origin && /^\/assets\/.+-[\w-]+\.(js|css|wasm)$/.test(url.pathname),
  async ({ request }) => (await caches.match(request)) ?? fetch(request))
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
  denylist: [/^\/room(?:\/|$)/, /^\/rooms(?:\/|$)/, /^\/checkout(?:\/|$)/, /^\/api(?:\/|$)/, /^\/auth(?:\/|$)/],
}))
const assetCacheName = `${ASSET_CACHE_NAME}-${shell.revision}`
let writes: Promise<unknown> = Promise.resolve()
registerRoute(({ request, url }) => request.method === 'GET' && url.origin === self.location.origin &&
  !request.headers.has('authorization') && !url.search && url.pathname.startsWith('/dice/') && /\.(glb|bin|png|jpe?g|webp|ktx2|avif)$/i.test(url.pathname), async ({ request, event }) => {
  const cache = await caches.open(assetCacheName)
  const fullRequest = new Request(request.url)
  const cached = await cache.match(fullRequest)
  if (cached) return request.headers.has('range') ? createPartialResponse(request, cached) : cached
  const response = await fetch(request)
  const copy = response.clone()
  writes = writes.catch(() => {}).then(() => cacheAssetWithinBudget(cache, fullRequest, copy))
  event.waitUntil(writes)
  return response
})
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Activation is allowed only after no old peer can still depend on these
    // runtime caches. Never touch account/pull/payment storage.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const key of await caches.keys()) {
      if (key.startsWith('dicesuki-dice-assets') && key !== assetCacheName) await caches.delete(key)
      // Old core caches are retired only at a no-window activation boundary.
      // Keep them for a sole explicitly updating tab until its document exits.
      if (windows.length === 0 && key.startsWith('workbox-precache-') && key !== cacheNames.precache) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})
self.addEventListener('message', event => {
  if (event.data?.type !== 'PWA_ACTIVATE_IF_SINGLE_CLIENT') return
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const sourceId = event.source && 'id' in event.source ? event.source.id : null
    // A sleeping/legacy tab is not a safe vote. Conservatively require every
    // other Dicesuki window to close. A later explicit action can retry.
    if (windows.length !== 1 || windows[0].id !== sourceId) {
      event.ports[0]?.postMessage({ type: 'PWA_UPDATE_BLOCKED' })
      return
    }
    event.ports[0]?.postMessage({ type: 'PWA_UPDATE_ACCEPTED' })
    await self.skipWaiting()
  })())
})
