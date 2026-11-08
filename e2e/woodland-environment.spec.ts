import { expect, test, type Page } from '@playwright/test'
import type { RootState } from '@react-three/fiber'
import type { DirectionalLight, Mesh, ShaderMaterial } from 'three'

// Run with a locally installed Chrome when the Playwright browser is unavailable.
if (process.env.PLAYWRIGHT_CHROME) test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME } })
test.use({ deviceScaleFactor: 2 })

async function renderedScene(page: Page) {
  return page.evaluate(async () => {
    // Inspect the live dev renderer, not the DOM quality-policy marker. Importing
    // Vite's existing dependency shares the Canvas root; no production hook needed.
    const fiberUrl = '/node_modules/.vite/deps/@react-three_fiber.js'
    const { _roots } = await import(/* @vite-ignore */ fiberUrl) as {
      _roots: Map<HTMLCanvasElement, { store: { getState(): RootState } }>
    }
    const canvas = document.querySelector('canvas')
    const state = canvas && _roots.get(canvas)?.store.getState()
    if (!state) return null
    const light = state.scene.children.find(object => (object as DirectionalLight).isDirectionalLight) as DirectionalLight | undefined
    const target = light?.shadow.map
    const context = state.gl.getContext()
    // Three's depth renderbuffer is a real GPU allocation. Restore binding so
    // inspecting it cannot perturb the next render or Three's state cache.
    const depthBuffer = target && state.gl.properties.get(target).__webglDepthbuffer as WebGLRenderbuffer | undefined
    let gpuSize: number[] | null = null
    if (depthBuffer) {
      const previous = context.getParameter(context.RENDERBUFFER_BINDING)
      context.bindRenderbuffer(context.RENDERBUFFER, depthBuffer)
      gpuSize = [
        context.getRenderbufferParameter(context.RENDERBUFFER, context.RENDERBUFFER_WIDTH),
        context.getRenderbufferParameter(context.RENDERBUFFER, context.RENDERBUFFER_HEIGHT),
      ]
      context.bindRenderbuffer(context.RENDERBUFFER, previous)
    }
    const grass = state.scene.getObjectByName('woodland-grass') as Mesh | undefined
    const grassMaterial = grass?.material as ShaderMaterial | undefined
    return {
      lightId: light?.uuid,
      shadowEnabled: state.gl.shadowMap.enabled,
      requestedSize: light?.shadow.mapSize.toArray(),
      targetSize: target ? [target.width, target.height] : null,
      gpuSize,
      dpr: state.gl.getPixelRatio(),
      frame: state.gl.info.render.frame,
      shaderTime: grassMaterial?.uniforms.uTime.value as number | undefined,
    }
  })
}

async function expectShadow(page: Page, size: number, dpr: number) {
  await expect.poll(async () => {
    const actual = await renderedScene(page)
    return actual && {
      enabled: actual.shadowEnabled,
      requested: actual.requestedSize,
      target: actual.targetSize,
      gpu: actual.gpuSize,
      dpr: actual.dpr,
    }
  }).toEqual({ enabled: true, requested: [size, size], target: [size, size], gpu: [size, size], dpr })
  const actual = await renderedScene(page)
  console.log('Live shadow GPU evidence:', JSON.stringify(actual))
  return actual!
}

async function selectTheme(page: Page, name: RegExp) {
  await page.getByRole('button', { name: /Change Theme/ }).click()
  await page.getByRole('button').filter({ has: page.getByRole('heading', { name }) }).click()
}

test('resizes live shadow GPU targets across compact, high-tier and classic/woodland switches', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?lodTier=high')
  const room = page.getByTestId('solo-room')
  await expect(room).toHaveAttribute('data-table-revealed', 'true', { timeout: 30_000 })
  await expect(room).toHaveAttribute('data-room-dice-count', '1')
  const initial = await expectShadow(page, 512, 2)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await selectTheme(page, /^Sunlit Glade · Cel$/)
  const environment = page.locator('[data-environment-kind="woodland"]')
  await expect(environment).toHaveAttribute('data-environment-tier', 'mid')
  expect((await expectShadow(page, 512, 1.5)).lightId).toBe(initial.lightId)

  await expect.poll(async () => (await renderedScene(page))?.shaderTime ?? 0).toBeGreaterThan(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(environment).toHaveAttribute('data-environment-motion', 'static')
  // Let the committed preference reach the frame loop, then prove actual shader
  // time stays frozen while renderer frames continue (not just a DOM marker).
  await page.waitForTimeout(100)
  const frozen = (await renderedScene(page))!
  await page.waitForTimeout(200)
  const still = (await renderedScene(page))!
  expect(still.shaderTime).toBe(frozen.shaderTime)
  expect(still.frame).toBeGreaterThan(frozen.frame)
  console.log('Live reduced-motion evidence:', JSON.stringify({
    shaderTimeBefore: frozen.shaderTime,
    shaderTimeAfter: still.shaderTime,
    frameBefore: frozen.frame,
    frameAfter: still.frame,
  }))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(environment).toHaveAttribute('data-environment-motion', 'animated')
  await expect.poll(async () => (await renderedScene(page))?.shaderTime ?? 0).toBeGreaterThan(frozen.shaderTime!)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(environment).toHaveAttribute('data-environment-tier', 'high')
  expect((await expectShadow(page, 2048, 2)).lightId).toBe(initial.lightId)
  await selectTheme(page, /Classic Dice/)
  await expect(page.locator('[data-environment-kind="classic"]')).toBeAttached()
  expect((await expectShadow(page, 2048, 2)).lightId).toBe(initial.lightId)
  await page.setViewportSize({ width: 390, height: 844 })
  expect((await expectShadow(page, 512, 2)).lightId).toBe(initial.lightId)
  await selectTheme(page, /^Sunlit Glade · Cel$/)
  expect((await expectShadow(page, 512, 1.5)).lightId).toBe(initial.lightId)
  await expect(room).toHaveAttribute('data-room-dice-count', '1')
  expect(errors).toEqual([])
})

test('reallocates desktop classic targets for low-tier woodland and back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?lodTier=low')
  await expect(page.getByTestId('solo-room')).toHaveAttribute('data-table-revealed', 'true', { timeout: 30_000 })
  const initial = await expectShadow(page, 2048, 2)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await selectTheme(page, /^Sunlit Glade · Cel$/)
  await expect(page.locator('[data-environment-kind="woodland"]')).toHaveAttribute('data-environment-tier', 'low')
  expect((await expectShadow(page, 512, 1)).lightId).toBe(initial.lightId)
  await selectTheme(page, /Classic Dice/)
  expect((await expectShadow(page, 2048, 2)).lightId).toBe(initial.lightId)
})

test('a real room roll presses nearby grass and clearing the table lets it recover', async ({ page }) => {
  test.setTimeout(45_000)
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.addInitScript(() => localStorage.setItem('dicesuki-settings', JSON.stringify({ state: { themeId: 'sunlit-glade' }, version: 1 })))
  await page.goto('/?lodTier=mid&woodlandDice=1')
  const room = page.getByTestId('solo-room')
  await expect(room).toHaveAttribute('data-table-revealed', 'true', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Manage Dice', exact: true }).click()
  await page.getByRole('button', { name: 'Clear all dice', exact: true }).click()
  await page.getByRole('button', { name: 'Add D6 to table', exact: true }).click()
  await page.getByRole('button', { name: 'Manage Dice', exact: true }).click()
  await page.getByRole('button', { name: 'Roll dice', exact: true }).click()
  await expect.poll(async () => Number(await room.getAttribute('data-roll-started-sequence'))).toBeGreaterThan(0)
  const pressure = () => page.evaluate(async () => {
    const fiberUrl = '/node_modules/.vite/deps/@react-three_fiber.js'
    const { _roots } = await import(/* @vite-ignore */ fiberUrl) as {
      _roots: Map<HTMLCanvasElement, { store: { getState(): RootState } }>
    }
    const state = _roots.get(document.querySelector('canvas')!)!.store.getState()
    const mesh = state.scene.getObjectByName('woodland-grass') as Mesh
    const texture = (mesh.material as ShaderMaterial).uniforms.uInteraction.value
    let sum = 0
    for (let i = 2; i < texture.image.data.length; i += 4) sum += texture.image.data[i]
    return sum
  })
  await expect.poll(pressure, { timeout: 10_000 }).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Manage Dice', exact: true }).click()
  // The toolbar's looping hover scale can keep a pointer target unstable.
  // Exercise its native keyboard action without bypassing the room UI handler.
  const clear = page.getByRole('button', { name: 'Clear all dice', exact: true })
  await clear.focus()
  await clear.press('Enter')
  await expect(room).toHaveAttribute('data-room-dice-count', '0')
  await expect.poll(pressure, { timeout: 8000 }).toBe(0)
})
