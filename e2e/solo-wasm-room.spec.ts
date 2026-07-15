import { expect, test, type Page } from '@playwright/test'

/**
 * Solo WASM room smoke (issue #114).
 *
 * The default `/` route opens a one-player room hosted by the in-browser WASM
 * room worker — the SAME `dicesuki-core` engine as multiplayer, reached over the
 * worker `postMessage` channel instead of a network socket. This smoke replaces
 * the retired native-loopback smoke: it proves the route reaches a live,
 * connected solo room with NO Rust server running and NO network WebSocket to a
 * room server (the whole join → room_state round-trip runs in the worker).
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

test('shows the branded first-paint shell before React starts', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  await page.goto('/')

  const shell = page.locator('.startup-splash-shell')
  await expect(shell).toBeVisible()
  await expect(shell.getByRole('img', { name: 'Dicesuki' })).toBeVisible()
  await expect(shell).toContainText('Loading Dicesuki…')

  await context.close()
})

test('loads a connected solo room on / with no native server and no network room socket', async ({
  page,
}) => {
  test.setTimeout(60_000)

  const roomSockets = observeRoomWebSockets(page)

  await page.goto('/')

  // The worker instantiates the wasm room, joins as the sole player, and the
  // room replies with room_state — all locally. Once connected the solo scene
  // mounts. Allow generous time for the wasm module to load on a cold cache.
  const room = page.getByTestId('solo-room')
  await expect(room).toHaveAttribute('data-connection-status', 'connected', { timeout: 30_000 })
  await expect(room).toHaveAttribute('data-local-player-ready', 'true')
  await expect(room).toHaveAttribute('data-engine-ready', 'true')

  // The loader stays through the first rendered canvas frame, then leaves.
  await expect(page.getByTestId('solo-room-loading')).toHaveCount(0)
  await expect(page.getByTestId('startup-splash')).toHaveCount(0)

  // No network WebSocket to any room server was opened — solo is served entirely
  // by the worker over postMessage.
  expect(roomSockets.urls).toEqual([])
})

function observeRoomWebSockets(page: Page) {
  const state = { urls: [] as string[] }
  page.on('websocket', (webSocket) => {
    const url = webSocket.url()
    // A room-server socket looks like `ws(s)://host/ws/<roomId>`. Ignore Vite's
    // HMR/dev sockets, which are the only other sockets in dev.
    if (/\/ws\//.test(url)) state.urls.push(url)
  })
  return state
}
