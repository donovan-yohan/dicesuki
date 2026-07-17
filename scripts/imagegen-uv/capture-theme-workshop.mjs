#!/usr/bin/env node
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.DICESUKI_BASE_URL ?? 'http://127.0.0.1:4173'
const captureScope = process.env.CAPTURE_SCOPE ?? 'all'
const captureTheme = process.env.CAPTURE_THEME
const captureDiceId = process.env.CAPTURE_DICE_ID
const captureFaceValues = process.env.CAPTURE_FACE_VALUES
  ?.split(',')
  .map((value) => Number(value.trim()))
  .filter(Number.isFinite)
const shouldRollEnvironment = process.env.ROLL_ENVIRONMENT !== 'false'
const environmentSettleMs = Number(process.env.ENVIRONMENT_SETTLE_MS ?? '6500')
const environmentSpawnWaitMs = Number(process.env.ENVIRONMENT_SPAWN_WAIT_MS ?? '500')
const environmentViewportWidth = Number(process.env.ENVIRONMENT_VIEWPORT_WIDTH ?? '1440')
const environmentViewportHeight = Number(process.env.ENVIRONMENT_VIEWPORT_HEIGHT ?? '900')
const environmentOutputSuffix = process.env.ENVIRONMENT_OUTPUT_SUFFIX
  ? `-${process.env.ENVIRONMENT_OUTPUT_SUFFIX}`
  : ''
const environmentDiceOverride = process.env.ENVIRONMENT_DICE_NAMES
  ?.split(',')
  .map((name) => name.trim())
  .filter(Boolean)
const outputDirectory = path.resolve('public/artist-resources/imagegen-uv/screenshots/theme-workshop')
const themes = [
  {
    id: 'cozy-forest',
    themeId: 'critter-forest',
    setId: 'cozy-forest-imagegen-set',
    dice: [
      ['mossheart-d4', 4],
      ['hearthwood-d6', 6],
      ['fernlight-d8', 8],
      ['acorn-compass-d10', 9],
      ['grovekeeper-d12', 12],
      ['elder-canopy-d20', 20],
    ],
    environmentDiceNames: ['Starter d4 #1', 'Starter d10 #1', 'Starter d12 #1'],
  },
  {
    id: 'dark-dungeon',
    themeId: 'dungeon-castle',
    setId: 'dark-dungeon-imagegen-set',
    dice: [
      ['cinder-spike-d4', 4],
      ['iron-vault-d6', 6],
      ['obsidian-fang-d8', 8],
      ['gaoler-key-d10', 9],
      ['crypt-seal-d12', 12],
      ['dread-gate-d20', 20],
    ],
    environmentDiceNames: ['Starter d4 #1', 'Starter d10 #1', 'Starter d12 #1'],
  },
  {
    id: 'cyberpunk-box',
    themeId: 'neon-cyber-city',
    setId: 'cyberpunk-imagegen-set',
    dice: [
      ['pulse-shard-d4', 4],
      ['neon-grid-d6', 6],
      ['volt-prism-d8', 8],
      ['cipher-core-d10', 9],
      ['chrome-relay-d12', 12],
      ['overdrive-d20', 20],
    ],
    environmentDiceNames: ['Starter d4 #1', 'Starter d10 #1', 'Starter d12 #1'],
  },
]

await mkdir(outputDirectory, { recursive: true })
const browser = await chromium.launch({ headless: true })

try {
  for (const theme of themes.filter((entry) => !captureTheme || entry.id === captureTheme)) {
    const screenshots = []
    const diceCases = captureDiceId
      ? (captureFaceValues ?? []).map((faceValue) => [captureDiceId, faceValue])
      : theme.dice
    if (captureDiceId && diceCases.length === 0) {
      throw new Error('CAPTURE_FACE_VALUES is required when CAPTURE_DICE_ID is set')
    }
    for (const [diceId, faceValue] of captureScope === 'environment' ? [] : diceCases) {
      const page = await browser.newPage({ viewport: { width: 720, height: 720 }, deviceScaleFactor: 1 })
      const pageErrors = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      const url = `${baseUrl}/test/production-dice-preview?set=${theme.setId}&dice=${diceId}&faceValue=${faceValue}`
      await page.goto(url, { waitUntil: 'networkidle' })
      await page.waitForFunction(() => {
        const requested = document.querySelector('[data-testid="requested-value"]')?.textContent
        const modelFace = document.querySelector('[data-testid="model-face-value"]')?.textContent
        const status = document.querySelector('[data-testid="validation-status"]')?.textContent
        return Boolean(requested && modelFace && requested === modelFace && status === 'validated')
      })
      if (pageErrors.length > 0) throw new Error(`${url}: ${pageErrors.join('; ')}`)

      const screenshotPath = path.join(outputDirectory, `${theme.id}-${diceId}-face-${faceValue}.png`)
      await page.screenshot({ path: screenshotPath, type: 'png' })
      screenshots.push(screenshotPath)
      await page.close()
    }
    if (screenshots.length > 0) {
      const contactSheetName = captureDiceId
        ? `${theme.id}-${captureDiceId}-selected-faces-engine.png`
        : `${theme.id}-complete-set-engine.png`
      await createContactSheet(browser, screenshots, path.join(outputDirectory, contactSheetName))
    }

    if (captureScope === 'dice') continue

    const environmentPage = await browser.newPage({
      viewport: { width: environmentViewportWidth, height: environmentViewportHeight },
      deviceScaleFactor: 1,
    })
    const environmentErrors = []
    environmentPage.on('pageerror', (error) => environmentErrors.push(error.message))
    await environmentPage.addInitScript(({ themeId }) => {
      localStorage.setItem('dicesuki-current-theme', themeId)
      localStorage.setItem('dicesuki-owned-themes', JSON.stringify([
        'default',
        'fantasy-earth',
        'critter-forest',
        'dungeon-castle',
        'neon-cyber-city',
      ]))
    }, { themeId: theme.themeId })
    await environmentPage.goto(baseUrl, { waitUntil: 'networkidle' })
    await environmentPage.locator('canvas').first().waitFor({ state: 'visible' })
    const environmentDiceNames = environmentDiceOverride ?? theme.environmentDiceNames
    await environmentPage.getByRole('button', { name: 'Open full dice inventory' }).click()
    for (const dieName of environmentDiceNames) {
      const search = environmentPage.getByPlaceholder('Search dice...')
      await search.fill(dieName)
      await environmentPage.getByRole('button', { name: `Add ${dieName} to table` }).click()
      await environmentPage.waitForTimeout(environmentSpawnWaitMs)
    }
    await environmentPage.getByRole('button', { name: 'Close panel' }).click()
    if (shouldRollEnvironment) {
      await environmentPage.getByRole('button', { name: 'Roll dice' }).click()
    }
    await environmentPage.waitForTimeout(environmentSettleMs)
    if (environmentErrors.length > 0) throw new Error(`${theme.themeId}: ${environmentErrors.join('; ')}`)
    await environmentPage.screenshot({
      path: path.join(outputDirectory, `${theme.id}-environment${environmentOutputSuffix}-engine.png`),
      type: 'png',
    })
    await environmentPage.close()
  }
} finally {
  await browser.close()
}

console.log(`Captured ${captureScope === 'dice' ? 'dice proofs' : 'environment proofs'} from ${baseUrl}`)

async function createContactSheet(browserInstance, imagePaths, outputPath) {
  const page = await browserInstance.newPage({ viewport: { width: 2160, height: 1440 }, deviceScaleFactor: 1 })
  const sources = await Promise.all(imagePaths.map(async (imagePath) => {
    const image = await readFile(imagePath)
    return `data:image/png;base64,${image.toString('base64')}`
  }))
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <style>
          html, body { margin: 0; width: 2160px; height: 1440px; overflow: hidden; background: #0f172a; }
          main { display: grid; grid-template-columns: repeat(3, 720px); grid-template-rows: repeat(2, 720px); }
          img { display: block; width: 720px; height: 720px; object-fit: cover; }
        </style>
      </head>
      <body><main>${sources.map((source) => `<img src="${source}" />`).join('')}</main></body>
    </html>`)
  await page.screenshot({ path: outputPath, type: 'png' })
  await page.close()
}
