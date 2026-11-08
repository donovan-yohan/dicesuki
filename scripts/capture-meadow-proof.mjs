import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { execFileSync } from 'node:child_process'

const output = path.resolve(process.env.MEADOW_OUTPUT ?? '.artifacts/theme-workshop/experiments/woodland/meadow')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PERF_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const receipts = []
try {
  for (const config of [
    { name: 'desktop', width: 1280, height: 900, tier: 'high', dpr: 1 },
    { name: 'mobile', width: 390, height: 844, tier: 'mid', dpr: 2 },
    { name: 'low', width: 390, height: 844, tier: 'low', dpr: 2 },
  ]) {
    const page = await browser.newPage({ viewport: { width: config.width, height: config.height }, deviceScaleFactor: config.dpr })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.addInitScript(themeId => localStorage.setItem('dicesuki-settings', JSON.stringify({ state: { themeId }, version: 1 })), process.env.MEADOW_THEME ?? 'sunlit-glade')
    await page.goto(`${process.env.PERF_URL ?? 'http://127.0.0.1:18192'}/?lodTier=${config.tier}&woodlandDice=1`)
    await page.waitForFunction(() => document.querySelector('[data-testid="solo-room"]')?.getAttribute('data-table-revealed') === 'true')
    await page.getByRole('button', { name: 'Manage Dice', exact: true }).click()
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Add D6 — your owned dice first, then unlimited basics', exact: true }).click()
    await page.getByRole('button', { name: 'Manage Dice', exact: true }).click()
    await page.waitForTimeout(1800)
    await page.getByRole('button', { name: 'Hide UI', exact: true }).click()
    // Inspect the actual renderer and distribution, not quality markers.
    const receipt = await page.evaluate(async () => {
      const fiber = await import('/node_modules/.vite/deps/@react-three_fiber.js')
      const canvas = document.querySelector('canvas')
      const state = fiber._roots.get(canvas).store.getState()
      const { useMultiplayerStore } = await import('/src/store/useMultiplayerStore.ts')
      const bounds = useMultiplayerStore.getState().engineConfig
      const grass = state.scene.getObjectByName('woodland-grass')
      const roots = grass.geometry.getAttribute('aRoot')
      const bins = Array(16).fill(0)
      let center = 0
      const fineBins = Array(144).fill(0)
      const densityMap = Array(48 * 48).fill(0)
      for (let i = 0; i < roots.count; i++) {
        const x = roots.getX(i) / bounds.arenaHalfX
        const z = roots.getZ(i) / bounds.arenaHalfZ
        if (Math.abs(x) < .5 && Math.abs(z) < .5) center++
        bins[Math.min(3, Math.floor((z + 1) * 2)) * 4 + Math.min(3, Math.floor((x + 1) * 2))]++
        fineBins[Math.min(11, Math.floor((z + 1) * 6)) * 12 + Math.min(11, Math.floor((x + 1) * 6))]++
        densityMap[Math.min(47, Math.floor((z + 1) * 24)) * 48 + Math.min(47, Math.floor((x + 1) * 24))]++
      }
      const density = [...fineBins].sort((a, b) => a - b)
      return { blades: roots.count, centerFraction: center / roots.count, bins, densityMap, emptyFineCells: fineBins.filter(count => count === 0).length, sparseCellCount: density[36], denseCellCount: density[129], verticesPerBlade: grass.geometry.getAttribute('position').count, renderer: state.gl.getContext().getParameter(state.gl.getContext().RENDERER), contextLost: state.gl.getContext().isContextLost() }
    })
    if (receipt.contextLost || !receipt.renderer) throw new Error('No live meadow renderer')
    if (receipt.centerFraction <= 0 || receipt.bins.filter(count => count > 0).length < 12) throw new Error(`Growth is not distributed across the field: ${JSON.stringify(receipt)}`)
    if (receipt.emptyFineCells < 4 || receipt.denseCellCount <= receipt.sparseCellCount * 3) throw new Error(`Meadow lacks density contrast: ${JSON.stringify(receipt)}`)
    // A diagnostic root-density map is not an aesthetic score or a rendered frame.
    const maximum = Math.max(...receipt.densityMap)
    const densityPixels = Buffer.from(receipt.densityMap.map(count => Math.round(Math.sqrt(count / maximum) * 255)))
    await sharp(densityPixels, { raw: { width: 48, height: 48, channels: 1 } }).resize(480, 480, { kernel: 'nearest' }).png().toFile(path.join(output, `${config.name}-root-density.png`))
    await page.evaluate(async () => {
      const fiber = await import('/node_modules/.vite/deps/@react-three_fiber.js')
      const state = fiber._roots.get(document.querySelector('canvas')).store.getState()
      const { useMultiplayerStore } = await import('/src/store/useMultiplayerStore.ts')
      // Disposable wind-only scene: prevent worker commits from racing captures.
      useMultiplayerStore.getState().socket.onmessage = null
      state.setFrameloop('never')
      // Ambient particles cannot be mistaken for grass motion in the center proof.
      const motes = state.scene.getObjectByName('woodland-motes')
      if (motes) motes.visible = false
      state.scene.traverse(object => { if (object.userData.dicePresentation) object.visible = false })
      // Wind study excludes contact as well as actors. Reaction is a separate proof.
      const contact = state.scene.getObjectByName('woodland-grass').material.uniforms.uInteraction.value
      for (let i = 0; i < contact.image.data.length; i += 4) {
        contact.image.data[i] = 128
        contact.image.data[i + 1] = 128
        contact.image.data[i + 2] = 0
      }
      contact.needsUpdate = true
      const forest = state.scene.getObjectByName('woodland-forest')
      window.__meadowForest = forest
      window.__meadowCanopy = state.scene.getObjectByName('woodland-canopy')
      window.__meadowCloud = state.scene.getObjectByName('woodland-grass').material.uniforms.uCloudStrength
      window.__meadowCloudStrength = window.__meadowCloud?.value
      window.__meadowProof = time => {
        state.scene.getObjectByName('woodland-grass').material.uniforms.uTime.value = time
        state.gl.render(state.scene, state.camera)
        return state.gl.domElement.toDataURL('image/png').split(',')[1]
      }
    })
    const composed = Buffer.from(await page.evaluate(() => window.__meadowProof(0)), 'base64')
    // Test grass motion without flowers or moving border leaves contributing.
    await page.evaluate(() => {
      if (window.__meadowForest) window.__meadowForest.visible = false
      if (window.__meadowCanopy) window.__meadowCanopy.visible = false
      if (window.__meadowCloud) window.__meadowCloud.value = 0
    })
    const images = []
    for (const time of [0, 1]) {
      const rendered = await page.evaluate(time => window.__meadowProof(time), time)
      images.push(Buffer.from(rendered, 'base64'))
    }
    const metadata = await sharp(images[0]).metadata()
    const region = { left: Math.floor(metadata.width * .3), top: Math.floor(metadata.height * .3), width: Math.floor(metadata.width * .4), height: Math.floor(metadata.height * .4) }
    const first = await sharp(images[0]).extract(region).removeAlpha().raw().toBuffer()
    const second = await sharp(images[1]).extract(region).removeAlpha().raw().toBuffer()
    let changed = 0
    for (let i = 0; i < first.length; i += 3) if (Math.abs(first[i] - second[i]) + Math.abs(first[i + 1] - second[i + 1]) + Math.abs(first[i + 2] - second[i + 2]) > 20) changed++
    receipt.centralMotionPixels = changed
    receipt.motionIsolation = 'Grass only: forest/canopy decoration, cloud shade, actors, motes and contact pressure excluded.'
    if (changed < 300) throw new Error(`Grass does not visibly move in center: ${JSON.stringify(receipt)}`)
    await fs.writeFile(path.join(output, `${config.name}.png`), composed)
    await page.evaluate(() => {
      if (window.__meadowForest) window.__meadowForest.visible = true
      if (window.__meadowCanopy) window.__meadowCanopy.visible = true
      if (window.__meadowCloud) window.__meadowCloud.value = window.__meadowCloudStrength
    })
    if (config.name === 'desktop' && process.env.MEADOW_VIDEO === '1') {
      const frames = path.join(output, 'frames')
      await fs.mkdir(frames, { recursive: true })
      for (let frame = 0; frame < 120; frame++) {
        const rendered = await page.evaluate(time => window.__meadowProof(time), frame / 30)
        await fs.writeFile(path.join(frames, `${String(frame).padStart(4, '0')}.png`), Buffer.from(rendered, 'base64'))
      }
      execFileSync('ffmpeg', ['-y', '-framerate', '30', '-i', path.join(frames, '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', path.join(output, 'meadow-wind.mp4')], { stdio: 'ignore' })
    }
    if (errors.length) throw new Error(errors.join('\n'))
    receipts.push({ config, ...receipt, errors })
    await fs.writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipts, null, 2))
    console.log(JSON.stringify(receipts.at(-1)))
    await page.close()
  }
} finally { await browser.close() }
