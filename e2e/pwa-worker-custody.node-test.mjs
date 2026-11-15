// Run with Node 22: PWA_BUILD_A=<dist> PWA_BUILD_B=<dist> node --test e2e/pwa-worker-custody.node-test.mjs
// Both inputs are real production builds with distinct versioned index shells.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { test } from 'node:test'
import { chromium } from '@playwright/test'

const buildA = process.env.PWA_BUILD_A
const buildB = process.env.PWA_BUILD_B
if (!buildA || !buildB) throw new Error('Set PWA_BUILD_A and PWA_BUILD_B to immutable compiled builds')
const fixturePath = '/dice/worker-custody-fixture.bin'
const modelPath = '/dice/fantasy-earth-imagegen-set/oathstone-d6/model.glb'
const bytesA = 'old-client-dice-bytes'
const bytesB = 'new-client-dice-bytes'
const probePath = '/api/worker-custody-probe'
const cachePrefix = 'dicesuki-dice-assets'

async function until(target, predicate, label) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await target.evaluate(predicate)) return
    await new Promise(done => setTimeout(done, 25))
  }
  throw new Error(`Deadline waiting for ${label}`)
}

async function withRuntime(body) {
  let selected = resolve(buildA)
  let browser
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname
    response.setHeader('Cache-Control', 'no-store')
    if (pathname === probePath) {
      response.setHeader('Content-Type', 'text/html')
      response.end('<title>Owned worker custody regression</title>')
      return
    }
    if (pathname === fixturePath) {
      response.setHeader('Content-Type', 'application/octet-stream')
      response.end(selected === resolve(buildA) ? bytesA : bytesB)
      return
    }
    const file = resolve(selected, `.${pathname}`)
    if (!file.startsWith(selected + sep)) { response.writeHead(400).end(); return }
    try {
      const bytes = await readFile(file)
      response.setHeader('Content-Type', { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.wasm': 'application/wasm' }[extname(file)] || 'application/octet-stream')
      response.end(bytes)
    } catch { response.writeHead(404).end() }
  })
  try {
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const origin = `http://127.0.0.1:${server.address().port}`
    browser = await chromium.launch({ channel: 'chromium', headless: true })
    const context = await browser.newContext({ serviceWorkers: 'allow' })
    // This test never needs an account, renderer/GPU or non-loopback service.
    await context.route(url => url.origin !== origin, route => route.abort())
    await body({ context, origin, selectB: () => { selected = resolve(buildB) } })
  } finally {
    await browser?.close()
    server.closeAllConnections()
    await new Promise((done, reject) => server.close(error => error ? reject(error) : done()))
    console.log(JSON.stringify({ cleanup: 'owned browser and loopback listener closed' }))
  }
}

async function installA(runtime) {
  const { context, origin } = runtime
  const page = await context.newPage()
  await page.goto(origin + probePath)
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
  })
  await until(page, () => Boolean(navigator.serviceWorker.controller), 'A controller')
  const workerA = context.serviceWorkers().at(-1)
  await workerA.evaluate(() => { self.__custodyIdentity = 'A' })
  assert.equal(await page.evaluate(async path => (await fetch(path)).text(), fixturePath), bytesA)
  const modelBytes = await readFile(resolve(buildA, `.${modelPath}`))
  const expectedModel = { bytes: modelBytes.length, sha256: createHash('sha256').update(modelBytes).digest('hex') }
  assert.deepEqual(await modelDigest(page), expectedModel)
  await until(page, async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('dicesuki-dice-assets') && await (await caches.open(name)).match('/dice/fantasy-earth-imagegen-set/oathstone-d6/model.glb')) return true
    }
    return false
  }, 'A fetch route durable cache put')
  const cachesA = await page.evaluate(() => caches.keys())
  runtime.selectB()
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update() })
  await until(page, async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state === 'installed', 'B waiting')
  const workerB = context.serviceWorkers().at(-1)
  assert.notEqual(workerB, workerA)
  await workerB.evaluate(() => { self.__custodyIdentity = 'B' })
  return { page, workerA, workerB, cachesA, expectedModel }
}

async function sendUpdate(page) {
  await page.evaluate(async () => {
    const channel = new MessageChannel()
    channel.port1.onmessage = event => { window.__custodyAnswer = event.data; channel.port1.close() }
    window.__controllerChanges = 0
    navigator.serviceWorker.addEventListener('controllerchange', () => window.__controllerChanges++)
    const registration = await navigator.serviceWorker.getRegistration()
    registration.waiting.postMessage({ type: 'PWA_ACTIVATE_IF_SINGLE_CLIENT' }, [channel.port2])
  })
}

async function offlineBytes(context, page) {
  await context.setOffline(true)
  try {
    return await page.evaluate(async path => {
      try { return await (await fetch(path)).text() } catch { return 'NETWORK_UNAVAILABLE' }
    }, fixturePath)
  } finally { await context.setOffline(false) }
}

async function modelDigest(page) {
  return page.evaluate(async path => {
    try {
      const response = await fetch(path)
      if (!response.ok) throw new Error('Model unavailable')
      const bytes = await response.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      return { bytes: bytes.byteLength, sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') }
    } catch { return 'NETWORK_UNAVAILABLE' }
  }, modelPath)
}

async function offlineModel(context, page) {
  await context.setOffline(true)
  try { return await modelDigest(page) } finally { await context.setOffline(false) }
}

async function controllerIdentity(context, page) {
  const session = await context.newCDPSession(page)
  try {
    await session.send('ServiceWorker.enable')
    // getRegistration.active alone is not proof of the page's controller.
    return await page.evaluate(async () => {
      const controller = navigator.serviceWorker.controller
      return { state: controller?.state, changes: window.__controllerChanges || 0 }
    })
  } finally { await session.detach() }
}

test('a native old-controlled peer admitted after the sole-client snapshot keeps its worker and offline dice until retirement', { timeout: 60_000 }, async () => {
  await withRuntime(async runtime => {
    const { context, origin } = runtime
    const { page, workerA, workerB, cachesA, expectedModel } = await installA(runtime)
    // Test-only scheduling gate around the genuine native snapshot result.
    // No fake clients, visibility overrides or synthetic Cache API responses.
    await workerB.evaluate(() => {
      const nativeMatchAll = self.clients.matchAll.bind(self.clients)
      let calls = 0
      self.clients.matchAll = async (...args) => {
        const windows = await nativeMatchAll(...args)
        if (++calls === 1) {
          self.__custodySnapshot = windows.map(window => window.id)
          await new Promise(done => { self.__releaseCustodySnapshot = done })
        } else self.__custodyActivationWindows = windows.length
        return windows
      }
    })
    await sendUpdate(page)
    await until(workerB, () => Boolean(self.__releaseCustodySnapshot), 'native one-client snapshot captured')
    const snapshot = await workerB.evaluate(() => self.__custodySnapshot)
    assert.equal(snapshot.length, 1)
    const peer = await context.newPage()
    await peer.goto(origin + probePath)
    assert.equal(await peer.evaluate(() => navigator.serviceWorker.controller?.state), 'activated')
    const aClients = await workerA.evaluate(async () => (await self.clients.matchAll({ type: 'window' })).map(window => window.id))
    assert.equal(aClients.length, 2, 'both native windows are actually controlled by A before release')
    const documentBefore = await peer.evaluate(() => performance.timeOrigin)
    await workerB.evaluate(() => self.__releaseCustodySnapshot())
    await until(page, () => Boolean(window.__custodyAnswer), 'worker admission reply')
    const answer = await page.evaluate(() => window.__custodyAnswer)
    if (answer.type === 'PWA_UPDATE_ACCEPTED') {
      await until(page, async () => !(await navigator.serviceWorker.getRegistration())?.waiting && (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', 'baseline forced activation')
    }
    const offline = await offlineBytes(context, peer)
    const offlineDiceModel = await offlineModel(context, peer)
    const after = await page.evaluate(() => caches.keys())
    const controller = await controllerIdentity(context, page)
    const activationWindows = await workerB.evaluate(() => self.__custodyActivationWindows ?? null)
    console.log(JSON.stringify({ case: 'concurrent native admission', snapshotCount: snapshot.length, oldControlledWindowsBeforeRelease: aClients.length, activationWindows, answer, cachesA, after, offline, expectedModel, offlineDiceModel, controller }))
    assert.deepEqual(offlineDiceModel, expectedModel, 'concurrently admitted old document must retain its actual warmed GLB bytes')
    assert.equal(offline, bytesA, 'concurrently admitted old document must retain its warmed offline dice')
    assert.deepEqual(answer, { type: 'PWA_UPDATE_BLOCKED', reason: 'restart-required' })
    assert.equal(controller.changes, 0)
    assert.equal(await peer.evaluate(() => performance.timeOrigin), documentBefore)
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state), 'installed')
    for (const name of cachesA) assert.ok(after.includes(name))
    await page.close()
    // This remaining old-controlled peer still prevents B's activation.
    assert.equal(await peer.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state), 'installed')
    assert.equal(await offlineBytes(context, peer), bytesA)
    assert.deepEqual(await offlineModel(context, peer), expectedModel)
    const activated = workerB.evaluate(() => new Promise(done => self.addEventListener('activate', event => event.waitUntil(Promise.resolve().then(done)), { once: true })))
    await peer.close()
    await activated
    const windowsAfterRetirement = await workerB.evaluate(async () => (await self.clients.matchAll({ type: 'window' })).length)
    assert.equal(windowsAfterRetirement, 0)
    // New B document: all old controlled documents have genuinely retired.
    const fresh = await context.newPage()
    await fresh.goto(origin + probePath)
    await until(fresh, async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated' && !(await navigator.serviceWorker.getRegistration())?.waiting, 'B natural activation settled')
    const remaining = await fresh.evaluate(() => caches.keys())
    for (const name of cachesA) assert.ok(!remaining.includes(name), `retired namespace ${name}`)
    assert.equal(await fresh.evaluate(async path => (await fetch(path)).text(), fixturePath), bytesB)
    await until(fresh, async () => {
      for (const name of await caches.keys()) if (name.startsWith('dicesuki-dice-assets') && await (await caches.open(name)).match('/dice/worker-custody-fixture.bin')) return true
      return false
    }, 'B real runtime put')
    assert.equal(await offlineBytes(context, fresh), bytesB)
    assert.equal((await fresh.evaluate(() => caches.keys())).filter(name => name.startsWith(cachePrefix)).length, 1)
    console.log(JSON.stringify({ case: 'natural retirement', windowsAfterRetirement, remaining, newOfflineBytes: bytesB }))
  })
})

test('a peer already present before admission blocks the update and retains A offline dice', { timeout: 60_000 }, async () => {
  await withRuntime(async runtime => {
    const { context, origin } = runtime
    const { page, workerA } = await installA(runtime)
    const peer = await context.newPage()
    await peer.goto(origin + probePath)
    assert.equal(await workerA.evaluate(async () => (await self.clients.matchAll({ type: 'window' })).length), 2)
    await sendUpdate(page)
    await until(page, () => Boolean(window.__custodyAnswer), 'already-present peer refusal')
    const answer = await page.evaluate(() => window.__custodyAnswer)
    const offline = await offlineBytes(context, peer)
    console.log(JSON.stringify({ case: 'already-present native peer', answer, offline }))
    assert.equal(answer.type, 'PWA_UPDATE_BLOCKED')
    assert.equal(offline, bytesA)
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state), 'installed')
    assert.equal((await controllerIdentity(context, page)).changes, 0)
  })
})
