#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { registerThemeAtlas } from './register-theme-atlases.mjs'

const ROOT = path.resolve('public/artist-resources/imagegen-uv/theme-sets')
const THEMES = ['cozy-forest', 'dark-dungeon', 'cyberpunk-box']
const manifest = JSON.parse(await readFile(path.join(ROOT, 'templates/d20/d20-mesh-uv-manifest.json'), 'utf8'))
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

try {
  for (const theme of THEMES) {
    const source = await readFile(path.join(ROOT, theme, 'd20', `${theme}-d20-imagegen-atlas-raw.png`))
    const result = await registerThemeAtlas(page, source, manifest)
    assert.equal(result.buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${theme} registration must return PNG data`)
    assert.equal(result.report.length, 20, `${theme} must register all 20 D20 islands`)
    for (const face of result.report) {
      assert.equal(face.mode, 'triangle-affine', `${theme} face ${face.faceValue} must use oriented triangle registration`)
      assert.equal(face.sourcePoints.length, 3, `${theme} face ${face.faceValue} must detect three source vertices`)
      assert.ok(face.sourceComponentPixels >= 64, `${theme} face ${face.faceValue} must isolate a foreground component`)
      assert.equal(face.coverage.samples.filter((sample) => sample.label.startsWith('uv-vertex-')).length, 3, `${theme} face ${face.faceValue} must sample all mesh UV vertices`)
      assert.equal(face.coverage.samples.filter((sample) => sample.label.endsWith('-outside')).length, 3, `${theme} face ${face.faceValue} must sample beyond every triangle edge`)
      assert.ok(face.coverage.samples.every((sample) => sample.covered), `${theme} face ${face.faceValue} must cover mesh UV and bleed samples`)
    }
  }
} finally {
  await page.close()
  await browser.close()
}

console.log(`D20 affine atlas registration and pixel coverage passed for ${THEMES.join(', ')}`)
