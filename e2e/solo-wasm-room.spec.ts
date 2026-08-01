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

for (const colorScheme of ['light', 'dark'] as const) {
  test(`shows the branded ${colorScheme} first-paint shell before React starts`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme })
    const page = await context.newPage()

    await page.goto('/')

    const shell = page.locator('.startup-splash-shell')
    await expect(shell).toBeVisible()
    await expect(shell.getByRole('img', { name: 'Dicesuki' })).toBeVisible()
    await expect(shell).toContainText('Loading Dicesuki…')
    await expect(shell).toHaveCSS(
      'background-color',
      colorScheme === 'light' ? 'rgb(243, 235, 226)' : 'rgb(26, 16, 29)',
    )

    await context.close()
  })
}

test('renders the d and e wordmark counters as transparent pixels', async ({ page }) => {
  await page.goto('/')

  const counterPixels = await page.evaluate(async () => {
    const image = new Image()
    image.src = '/brand/dicesuki-wordmark.svg'
    await image.decode()

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context is unavailable')
    context.drawImage(image, 0, 0)

    return [
      [...context.getImageData(169, 295, 1, 1).data],
      [...context.getImageData(829, 262, 1, 1).data],
    ]
  })

  expect(counterPixels).toEqual([
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ])
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

  await expect(page.getByTestId('solo-room-loading')).toHaveCount(0)

  // The loader stays through the first rendered canvas frame, then leaves.
  //
  // Wait on the gate's own handover edge rather than polling for the splash to
  // disappear. Connecting to the worker room is milliseconds; cold-starting the
  // renderer behind it is seconds of main-thread work (module graph, shader
  // compile, first draw — on CI, through a software GL backend), so the 5s
  // Playwright applies to a bare `toHaveCount` was never a budget anyone chose
  // for that step, and this test spent it racing the boot (issue #210). The
  // absence assertion below is still the load-bearing one; it just runs after a
  // signal that says the work is finished instead of guessing when it should be.
  await expect(room).toHaveAttribute('data-table-revealed', 'true', { timeout: 30_000 })
  await expect(page.getByTestId('startup-splash')).toHaveCount(0)

  // No network WebSocket to any room server was opened — solo is served entirely
  // by the worker over postMessage.
  expect(roomSockets.urls).toEqual([])
})

/**
 * Regression guard for issue #210 (the startup-splash flake).
 *
 * `<Canvas>` puts every child in ONE Suspense boundary, so any scene asset that
 * loads with `useLoader` suspends the whole scene — including the first-frame
 * signal that tells the splash to leave. The HDR environment map is the one
 * runtime asset the table pulls from a third-party CDN, so a request that never
 * lands (offline PWA, firewall, ad blocker, or just a slow CDN) used to pin the
 * splash at `phase="rendering"` forever, and a request that *failed* took the
 * whole app down with it.
 *
 * These two cases are deterministic, not timing-based: the routes below hang or
 * fail the request outright, so the assertions fail closed the moment the
 * splash is coupled to a scene asset again. `intercepted` must be non-empty so
 * the guard can never pass vacuously if drei changes where the map comes from.
 */
for (const mode of ['never arrives', 'fails outright'] as const) {
  test(`boots the table when the HDR environment map ${mode}`, async ({ page }) => {
    test.setTimeout(60_000)

    const intercepted: string[] = []
    await page.route(/\.(hdr|exr)(\?|$)/, async (route) => {
      intercepted.push(route.request().url())
      if (mode === 'fails outright') return route.abort('failed')
      await new Promise(() => {}) // hangs for the lifetime of the page
    })

    await page.goto('/')

    const room = page.getByTestId('solo-room')
    await expect(room).toHaveAttribute('data-connection-status', 'connected', { timeout: 30_000 })

    // The table renders and the splash leaves on the first painted frame. The
    // map is decorative and must never gate either one — losing it dims
    // metallic dice by roughly a third and changes nothing else, which is a
    // table you can still play on.
    await expect(room).toHaveAttribute('data-table-revealed', 'true', { timeout: 30_000 })
    await expect(page.getByTestId('startup-splash')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Roll dice' })).toBeVisible()
    await expect(room).toHaveAttribute('data-room-dice-count', '1')

    expect(intercepted.length).toBeGreaterThan(0)
  })
}

test('executes a saved roll through the wasm room backend', async ({ page }) => {
  test.setTimeout(60_000)

  await page.goto('/')
  const room = page.getByTestId('solo-room')
  await expect(room).toHaveAttribute('data-connection-status', 'connected', { timeout: 30_000 })
  await expect(room).toHaveAttribute('data-room-dice-count', '1')
  await expect(room).toHaveAttribute('data-room-dice-types', 'd20')

  await page.getByRole('button', { name: 'My Dice Rolls' }).click()
  await page.getByRole('button', { name: /create new roll/i }).click()
  // Locate by label, not placeholder: #212 changed the placeholder copy to
  // 'e.g. Greatsword Attack' and this manual-run spec was not updated with it.
  await page.getByLabel('Roll name').fill('WASM saved roll')
  await page.getByRole('button', { name: 'Add 4 D6 dice' }).click()
  await page.getByText('Bonus per die:').locator('..').getByRole('spinbutton').fill('2')
  await page.getByRole('button', { name: 'Save Roll' }).click()
  await page.getByRole('button', { name: 'Roll WASM saved roll' }).click()

  // The seeded d20 is gone, the requested anonymous dice are the only table
  // entries, and roll_started advanced — proving clear → spawn ×4 → roll all
  // traversed the real worker/WASM room protocol.
  await expect(room).toHaveAttribute('data-room-dice-count', '4')
  await expect(room).toHaveAttribute('data-room-dice-types', 'd6,d6,d6,d6')
  await expect(room).toHaveAttribute('data-roll-started-sequence', '1')
  await expect(page.getByText('WASM saved roll', { exact: true })).toBeVisible()
  await expect(page.getByText('+2', { exact: true })).toHaveCount(4)
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
