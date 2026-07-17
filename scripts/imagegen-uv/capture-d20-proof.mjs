#!/usr/bin/env node
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.DICESUKI_PREVIEW_BASE_URL ?? 'http://127.0.0.1:38173'
const outputDir = path.resolve('public/artist-resources/imagegen-uv/screenshots')
const faceValues = [1, 8, 20]

await mkdir(outputDir, { recursive: true })
const browser = await chromium.launch({ headless: true })

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 920 }, deviceScaleFactor: 1 })

  for (const faceValue of faceValues) {
    const url = new URL('/test/production-dice-preview', baseUrl)
    url.searchParams.set('set', 'fantasy-set')
    url.searchParams.set('dice', 'aurelian-imagegen-d20')
    url.searchParams.set('faceValue', String(faceValue))

    await page.goto(url.toString(), { waitUntil: 'networkidle' })
    await page.locator('canvas').waitFor()
    await page.waitForTimeout(1200)

    const requested = await page.locator('[data-testid="requested-value"]').textContent()
    const modelFace = await page.locator('[data-testid="model-face-value"]').textContent()
    const status = await page.locator('[data-testid="validation-status"]').textContent()
    const canonicalUv = await page.locator('[data-testid="canonical-uv-status"]').textContent()
    if (requested !== String(faceValue) || modelFace !== String(faceValue) || status !== 'validated' || canonicalUv !== 'matched') {
      throw new Error(`Face ${faceValue} mismatch: requested=${requested}, modelFace=${modelFace}, status=${status}, canonicalUv=${canonicalUv}`)
    }

    const outputPath = path.join(outputDir, `aurelian-imagegen-d20-face${faceValue}.png`)
    await page.screenshot({ path: outputPath })
    console.log(`Captured face ${faceValue}: requested=${requested} modelFace=${modelFace} -> ${path.relative(process.cwd(), outputPath)}`)
  }
} finally {
  await browser.close()
}
