/// <reference types="node" />
import { expect, test, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'

const buildA = process.env.PWA_BUILD_A
const buildB = process.env.PWA_BUILD_B
if (!buildA || !buildB) throw new Error('Set PWA_BUILD_A and PWA_BUILD_B to immutable compiled dist directories. B must differ and enable the sandbox checkout route for its status-only test.')
let selected = resolve(buildA)
let server: Server
let origin: string
let consoleMessages: string[] = []
test.beforeEach(async ({ page }) => {
  consoleMessages = []
  page.on('console', message => consoleMessages.push(message.text()))
  page.on('pageerror', error => consoleMessages.push(String(error)))
})
test.afterEach(async ({ page }, info) => {
  await info.attach('console', { body: consoleMessages.join('\n'), contentType: 'text/plain' })
  await info.attach('runtime', { body: JSON.stringify(await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl')
    const debug = gl?.getExtension('WEBGL_debug_renderer_info')
    return { visibility: document.visibilityState, renderer: gl && debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null }
  }).catch(() => null)), contentType: 'application/json' })
})
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.hdr': 'application/octet-stream' }
test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url!, 'http://127.0.0.1').pathname)
    if (pathname.startsWith('/dice/pwa-cache-fixture/')) { response.setHeader('content-type', 'application/octet-stream'); response.end(Buffer.alloc(1024 * 1024, 7)); return }
    if (pathname === '/api/economy-fixture') { response.setHeader('content-type', 'application/json'); response.end('{"status":"network-only"}'); return }
    const root = selected
    let file = resolve(root, `.${pathname}`)
    if (!file.startsWith(root + sep) && file !== root) { response.writeHead(400).end(); return }
    if (!extname(pathname)) file = resolve(root, 'index.html')
    try {
      const body = await readFile(file)
      response.setHeader('content-type', mime[extname(file)] || 'application/octet-stream')
      response.setHeader('cache-control', 'no-store')
      response.end(body)
    } catch { response.writeHead(404).end() }
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No loopback listener')
  origin = `http://127.0.0.1:${address.port}`
})
test.afterAll(async () => { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())) })
async function ready(page: Page) {
  await expect(page.locator('[data-testid="solo-room"][data-connection-status="connected"][data-table-revealed="true"]')).toBeVisible({ timeout: 30_000 })
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
}
async function clearTable(page: Page) {
  await page.getByRole('button', { name: 'Manage Dice', exact: true }).click()
  await page.getByRole('button', { name: 'Clear all dice', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
}

test('real waiting worker refuses other tabs, preserves old caches, honors Later and updates once on explicit safe action', async ({ context, page }, info) => {
  selected = resolve(buildA!)
  await page.goto(origin)
  await ready(page)
  const before = await page.evaluate(async () => ({ scripts: [...document.scripts].map(script => script.src), caches: await caches.keys() }))
  const oldScript = before.scripts.find(url => url.endsWith('.js'))!
  const oldBytes = await page.evaluate(async url => (await fetch(url)).text(), oldScript)
  const peer = await context.newPage()
  await peer.goto(origin)
  await ready(peer)
  await peer.getByRole('button', { name: 'Manage Dice', exact: true }).click()
  await peer.getByTestId('dice-quick-slot-d6').click()
  const peerDocument = await peer.evaluate(() => performance.timeOrigin)
  const peerDice = await peer.getByTestId('solo-room').getAttribute('data-room-dice-count')
  await page.bringToFront()
  expect(await peer.evaluate(() => document.visibilityState)).toBe('hidden')
  await clearTable(page)
  selected = resolve(buildB!)
  await page.evaluate(() => { void navigator.serviceWorker.getRegistration().then(registration => registration!.update()) })
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state === 'installed')
  await expect(page.getByText('Update ready', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Update now', exact: true }).click()
  await expect(page.getByText('Close other Dicesuki tabs, then try updating again.')).toBeVisible()
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed')
  expect(await peer.evaluate(() => performance.timeOrigin)).toBe(peerDocument)
  await expect(peer.getByTestId('solo-room')).toHaveAttribute('data-room-dice-count', peerDice!)
  for (const cache of before.caches) expect(await page.evaluate(async () => caches.keys())).toContain(cache)
  await page.getByRole('button', { name: 'Later', exact: true }).click()
  await peer.close()
  // A real update check and visibility turn are a positive event boundary,
  // not a fake callback or a sleep that silently hopes the worker is waiting.
  await page.evaluate(async () => { document.dispatchEvent(new Event('visibilitychange')); await (await navigator.serviceWorker.getRegistration())!.update() })
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed')
  await page.screenshot({ path: info.outputPath('update-ready.png') })
  await page.getByRole('button', { name: 'Update now', exact: true }).click()
  await page.waitForFunction(async () => !(await navigator.serviceWorker.getRegistration())?.waiting)
  await info.attach('activation', { body: JSON.stringify(await page.evaluate(async () => ({ active: (await navigator.serviceWorker.getRegistration())?.active?.state, controller: navigator.serviceWorker.controller?.state }))), contentType: 'application/json' })
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0)
  await ready(page)
  const after = await page.evaluate(() => [...document.scripts].map(script => script.src))
  expect(after).not.toEqual(before.scripts)
  expect(await page.evaluate(async url => (await fetch(url)).text(), oldScript)).toBe(oldBytes)
  expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(false)
  await page.goto(origin + '/checkout/return?status=success')
  await expect(page.getByTestId('checkout-status')).toHaveAttribute('data-status', 'none')
  await expect(page.getByText(/browser or installed app where you started checkout/i)).toBeVisible()
  await page.screenshot({ path: info.outputPath('checkout-other-container.png') })
})

test('compiled guest cold-boots and rolls offline while API and checkout never acquire cached authority', async ({ context, page }, info) => {
  selected = resolve(buildA!)
  await page.goto(origin)
  await ready(page)
  expect(await page.evaluate(async () => (await fetch('/api/economy-fixture')).json())).toEqual({ status: 'network-only' })
  const keys = await page.evaluate(async () => {
    const urls = []
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(request.url)
    return urls
  })
  expect(keys.some(url => /\/(api|checkout|auth)\//.test(new URL(url).pathname))).toBe(false)
  await context.setOffline(true)
  await page.reload()
  await ready(page)
  await page.getByRole('button', { name: 'Manage Dice', exact: true }).click()
  await page.getByTestId('dice-quick-slot-d6').click()
  const room = page.getByTestId('solo-room')
  const before = await room.getAttribute('data-roll-started-sequence')
  await page.getByRole('button', { name: 'Roll dice', exact: true }).click()
  await expect(room).not.toHaveAttribute('data-roll-started-sequence', before!)
  await expect(page.getByTestId('roll-grand-total')).toHaveText(/^-?\d+$/, { timeout: 30_000 })
  expect(await page.evaluate(async () => { try { await fetch('/api/economy-fixture'); return 'cached' } catch { return 'network-unavailable' } })).toBe('network-unavailable')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'App', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCSS('transform', 'none')
  await page.screenshot({ path: info.outputPath('offline-settings.png') })
})

test('real runtime cache stores more than 64 assets but evicts at the byte budget and serves cached ranges', async ({ page }, info) => {
  selected = resolve(buildA!)
  await page.goto(origin)
  await ready(page)
  await page.evaluate(async () => {
    for (let i = 0; i < 197; i++) {
      const response = await fetch(`/dice/pwa-cache-fixture/${i}.bin`)
      if (!response.ok) throw new Error('Fixture download failed')
      await response.arrayBuffer()
    }
  })
  await page.waitForFunction(async () => {
    for (const name of await caches.keys()) if (name.startsWith('dicesuki-dice-assets-v2')) {
      if (await (await caches.open(name)).match('/dice/pwa-cache-fixture/196.bin')) return true
    }
    return false
  })
  const receipt = await page.evaluate(async () => {
    const name = (await caches.keys()).find(name => name.startsWith('dicesuki-dice-assets-v2'))!
    const cache = await caches.open(name)
    const keys = await cache.keys()
    let bytes = 0
    for (const request of keys) bytes += Number((await cache.match(request))!.headers.get('x-dicesuki-cached-bytes'))
    const range = await fetch('/dice/pwa-cache-fixture/196.bin', { headers: { Range: 'bytes=0-15' } })
    return { name, count: keys.length, bytes, oldest: Boolean(await cache.match('/dice/pwa-cache-fixture/0.bin')), rangeStatus: range.status, rangeBytes: (await range.arrayBuffer()).byteLength }
  })
  expect(receipt.count).toBeGreaterThan(64)
  expect(receipt.bytes).toBeLessThanOrEqual(192 * 1024 * 1024)
  expect(receipt.oldest).toBe(false)
  expect(receipt.rangeStatus).toBe(206)
  expect(receipt.rangeBytes).toBe(16)
  await info.attach('cache-budget', { body: JSON.stringify(receipt), contentType: 'application/json' })
})
