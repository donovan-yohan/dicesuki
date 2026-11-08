import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { execFileSync } from 'node:child_process'

const output = path.resolve(process.env.MEADOW_OUTPUT ?? '.artifacts/theme-workshop/experiments/woodland/reaction')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PERF_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.addInitScript(themeId => localStorage.setItem('dicesuki-settings', JSON.stringify({ state: { themeId }, version: 1 })), process.env.MEADOW_THEME ?? 'sunlit-glade')
  await page.goto(`${process.env.PERF_URL ?? 'http://127.0.0.1:18192'}/?lodTier=high&woodlandDice=1`)
  await page.waitForFunction(() => document.querySelector('[data-testid="solo-room"]')?.getAttribute('data-table-revealed') === 'true')
  await page.getByRole('button', { name: 'Manage Dice', exact: true }).click()
  await page.getByRole('button', { name: 'Clear all dice', exact: true }).click()
  await page.getByRole('button', { name: 'Add D6 — your owned dice first, then unlimited basics', exact: true }).click()
  await page.getByRole('button', { name: 'Manage Dice', exact: true }).click()
  await page.waitForTimeout(1800)
  await page.getByRole('button', { name: 'Hide UI', exact: true }).click()
  await page.evaluate(async () => {
    const fiber = await import('/node_modules/.vite/deps/@react-three_fiber.js')
    const { useMultiplayerStore } = await import('/src/store/useMultiplayerStore.ts')
    const state = fiber._roots.get(document.querySelector('canvas')).store.getState()
    const grass = state.scene.getObjectByName('woodland-grass')
    if (!grass.material.uniforms.uInteraction) throw new Error('No live dice-to-grass interaction texture')
    state.setFrameloop('never')
    const motes = state.scene.getObjectByName('woodland-motes')
    if (motes) motes.visible = false
    const die = [...useMultiplayerStore.getState().dice.values()][0]
    // This isolated controlled-snapshot proof must not race incoming worker ticks.
    useMultiplayerStore.getState().socket.onmessage = null
    const visualGroups = []
    state.scene.traverse(object => { if (object.userData.dicePresentation) visualGroups.push(object) })
    // Hide dice during pixel comparisons, so only the reactive grass can change.
    for (const group of visualGroups) group.visible = false
    window.__reactiveProbe = { state, useMultiplayerStore, die, visualGroups, grass }
    window.__stepReaction = async ({ x, y = 0.55, z, frames = 1, remove = false, visible = false }) => {
      const { state, useMultiplayerStore, die, grass } = window.__reactiveProbe
      const current = useMultiplayerStore.getState()
      const position = [x, remove ? 100 : y, z]
      useMultiplayerStore.setState({ dice: new Map([[die.id, { ...die, prevPosition: position, targetPosition: position, prevRotation: [0, 0, 0, 1], targetRotation: [0, 0, 0, 1] }]]), lastSnapshotTime: performance.now() - current.snapshotInterval })
      await new Promise(resolve => setTimeout(resolve, 0))
      state.scene.traverse(object => { if (object.userData.dicePresentation) object.visible = visible })
      for (let i = 0; i < frames; i++) {
        for (const subscription of state.internal.subscribers) subscription.ref.current(state, 1 / 30)
        grass.material.uniforms.uTime.value = 0
        state.gl.render(state.scene, state.camera)
      }
      const image = state.gl.domElement.toDataURL('image/png').split(',')[1]
      const data = grass.material.uniforms.uInteraction.value.image.data
      let pressure = 0
      for (let i = 2; i < data.length; i += 4) pressure += data[i]
      return { pressure, textureVersion: grass.material.uniforms.uInteraction.value.version, windTime: grass.material.uniforms.uTime.value, image }
    }
  })
  const initial = await page.evaluate(() => window.__stepReaction({ x: 0, z: 0, remove: true, frames: 180 }))
  const baseline = Buffer.from(initial.image, 'base64')
  const pressed = await page.evaluate(() => window.__stepReaction({ x: 0, z: 0, frames: 15 }))
  const contact = Buffer.from(pressed.image, 'base64')
  if (pressed.pressure <= 0) throw new Error('Actual room D6 did not stamp grass pressure')
  const difference = async (a, b) => {
    const first = await sharp(a).removeAlpha().raw().toBuffer()
    const second = await sharp(b).removeAlpha().raw().toBuffer()
    let pixels = 0
    for (let i = 0; i < first.length; i += 3) if (Math.abs(first[i] - second[i]) + Math.abs(first[i + 1] - second[i + 1]) + Math.abs(first[i + 2] - second[i + 2]) > 20) pixels++
    return pixels
  }
  const changed = await difference(baseline, contact)
  if (changed < 100) throw new Error(`Dice response not visible in pixels: ${changed}`)
  const recovering = await page.evaluate(() => window.__stepReaction({ x: 0, z: 0, remove: true, frames: 180 }))
  const recovered = Buffer.from(recovering.image, 'base64')
  const remaining = await difference(baseline, recovered)
  for (const [name, bytes] of [['baseline', baseline], ['pressed', contact], ['recovered', recovered]]) await fs.writeFile(path.join(output, `${name}.png`), bytes)
  delete pressed.image
  delete recovering.image
  console.log(JSON.stringify({ changed, remaining, pressed, recovering }))
  if (remaining > changed * .2) throw new Error(`Grass did not recover: ${remaining}/${changed}`)
  if (process.env.MEADOW_VIDEO === '1') {
    const frames = path.join(output, 'frames')
    await fs.mkdir(frames, { recursive: true })
    for (let frame = 0; frame < 150; frame++) {
      const active = frame < 90
      const rendered = await page.evaluate(({ frame, active }) => window.__stepReaction({ x: -4 + Math.min(frame, 89) / 89 * 8, z: Math.sin(frame / 23) * .7, frames: 1, remove: !active, visible: active }), { frame, active })
      await fs.writeFile(path.join(frames, `${String(frame).padStart(4, '0')}.png`), Buffer.from(rendered.image, 'base64'))
    }
    execFileSync('ffmpeg', ['-y', '-framerate', '30', '-i', path.join(frames, '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', path.join(output, 'dice-grass-response.mp4')], { stdio: 'ignore' })
  }
  if (errors.length) throw new Error(errors.join('\n'))
  const receipt = { changedGrassPixels: changed, remainingAfterRecovery: remaining, pressed, recovering, errors, proof: 'Actual production frame subscribers with controlled room snapshot data and incoming worker messages paused; stationary hidden D6 isolates grass pixels. Manually stepped motion study is not a real physics roll or real-time performance evidence.' }
  await fs.writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify(receipt))
} finally { await browser.close() }
