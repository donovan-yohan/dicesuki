import { chromium } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const sourcePath = path.join(root, 'public/brand/dicesuki-icon.svg')
const outputDir = path.join(root, 'public/icons')
const svg = await readFile(sourcePath)
const src = `data:image/svg+xml;base64,${svg.toString('base64')}`

const outputs = [
  { name: 'apple-touch-icon.png', size: 180, padding: 8 },
  { name: 'pwa-192x192.png', size: 192, padding: 8 },
  { name: 'pwa-512x512.png', size: 512, padding: 20 },
  { name: 'pwa-512x512-maskable.png', size: 512, padding: 64 },
]

await mkdir(outputDir, { recursive: true })
const browser = await chromium.launch({ headless: true })

try {
  for (const output of outputs) {
    const page = await browser.newPage({
      viewport: { width: output.size, height: output.size },
      deviceScaleFactor: 1,
    })
    await page.setContent(`<!doctype html>
      <style>
        html, body {
          width: 100%;
          height: 100%;
          margin: 0;
          overflow: hidden;
          background: #fff8f5;
        }
        body {
          display: grid;
          place-items: center;
        }
        img {
          display: block;
          width: calc(100% - ${output.padding * 2}px);
          height: calc(100% - ${output.padding * 2}px);
          object-fit: contain;
        }
      </style>
      <img src="${src}" alt="">`)
    await page.locator('img').evaluate((image) => image.decode())
    await page.screenshot({ path: path.join(outputDir, output.name) })
    await page.close()
    console.log(`generated public/icons/${output.name}`)
  }
} finally {
  await browser.close()
}
