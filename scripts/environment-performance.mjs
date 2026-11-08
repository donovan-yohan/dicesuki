import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { measureRenderedFrames } from './environment-performance-sampling.mjs'

// RAF measures delivered cadence, not GPU execution time. Pair it with draw work.
const url = process.env.PERF_URL ?? 'http://127.0.0.1:18192'
const output = process.env.PERF_OUT ?? '.artifacts/theme-workshop/experiments/woodland/performance/baseline.json'
const browser = process.env.PERF_CDP
  ? await chromium.connectOverCDP(process.env.PERF_CDP)
  : await chromium.launch({
      executablePath: process.env.PERF_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
    })
const results = []
const configurations = process.env.PERF_CDP
  ? [{ label: 'pixel', width: 0, height: 0, dpr: 0, tier: 'mid' }]
  : [
      { label: 'desktop', width: 1440, height: 1000, dpr: 1, tier: 'high' },
      { label: 'mobile-viewport', width: 390, height: 844, dpr: 2, tier: 'mid' },
    ]
for (const configuration of configurations) {
  const page = process.env.PERF_CDP
    ? await browser.contexts()[0].newPage()
    : await browser.newPage({ viewport: { width: configuration.width, height: configuration.height }, deviceScaleFactor: configuration.dpr })
  const errors = []
  await page.bringToFront()
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(theme => {
    localStorage.setItem('dicesuki-settings', JSON.stringify({ state: { themeId: theme }, version: 1 }))
  }, process.env.PERF_THEME ?? 'default')
  await page.addInitScript(() => {
    window.__renderWork = { calls: 0, triangles: 0 }
    for (const context of [WebGLRenderingContext, WebGL2RenderingContext]) {
      for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const original = context.prototype[name]
        if (!original || Object.hasOwn(original, '__measured')) continue
        const wrapped = function (...args) {
          window.__renderWork.calls++
          const count = name.startsWith('drawArrays') ? args[2] : args[1]
          const instances = name.endsWith('Instanced') ? args.at(-1) : 1
          if (args[0] === this.TRIANGLES) window.__renderWork.triangles += count / 3 * instances
          return original.apply(this, args)
        }
        wrapped.__measured = true
        context.prototype[name] = wrapped
      }
    }
  })
  await page.goto(`${url}/?lodTier=${configuration.tier}&lod=1`)
  await page.waitForFunction(() => document.querySelector('[data-testid="solo-room"]')?.getAttribute('data-table-revealed') === 'true', null, { timeout: 45000 })

  await page.getByRole('button', { name: 'Manage Dice', exact: true }).click()
  for (let i = 0; i < 20; i++) await page.getByRole('button', { name: 'Add D6 — your owned dice first, then unlimited basics', exact: true }).click()
  await page.getByRole('button', { name: 'Manage Dice', exact: true }).click()
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="solo-room"]')?.getAttribute('data-room-dice-count')) >= 20)
  await page.waitForTimeout(5000)
  const info = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const gl = canvas.getContext('webgl2')
    const extension = gl.getExtension('WEBGL_debug_renderer_info')
    const room = document.querySelector('[data-testid="solo-room"]')
    return { drawingBuffer: [canvas.width, canvas.height], viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, contextLost: gl.isContextLost(), renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), diceCount: room.getAttribute('data-room-dice-count'), basicDiceCount: room.getAttribute('data-room-basic-dice-count'), diceTypes: room.getAttribute('data-room-dice-types') }
  })
  if (info.contextLost || !info.renderer) throw new Error('No live WebGL renderer. Refusing to benchmark UI-only RAF cadence.')
  if (Number(info.diceCount) !== 21 || Number(info.basicDiceCount) !== 21) {
    throw new Error(`Expected twenty basic D6 plus one boot D20; use a clean guest context. Got ${JSON.stringify(info)}`)
  }
  for (const mode of ['idle', 'rolling']) {
    for (let run = 0; run < 3; run++) {
      if (mode === 'rolling') await page.getByRole('button', { name: 'Roll dice', exact: true }).click()
      const sample = await page.evaluate(measureRenderedFrames, { durationMs: 4000 })
      if (sample.callsPerFrame <= 0 || sample.trianglesPerFrame <= 0 || errors.length) {
        throw new Error(`Invalid render measurement: ${JSON.stringify({ sample, errors })}`)
      }
      results.push({ configuration, info, mode, run, ...sample, errors: [...errors] })
      console.log(JSON.stringify(results.at(-1)))
    }
  }
  const directory = path.dirname(output)
  fs.mkdirSync(directory, { recursive: true })
  await page.screenshot({ path: path.join(directory, `${configuration.label}-${process.env.PERF_THEME ?? 'default'}.png`) })
  fs.writeFileSync(output, JSON.stringify({ recordedAt: new Date().toISOString(), url, theme: process.env.PERF_THEME ?? 'default', methodology: '3 x 4-second RAF runs per idle/rolling mode; twenty basic D6 plus the automatically seeded basic D20, twenty-one dice total; basic count verified; actual WebGL draw calls instrumented including shadow passes; GPU time not measured; cadence may be display-refresh limited.', results }, null, 2))
  await page.close()
}
if (!process.env.PERF_CDP) await browser.close()
else process.exit()
