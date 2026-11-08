import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkAuthoringBoundary } from '../imagegen-uv/check-authoring-boundary.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const assets = [
  'public/environments/cyberpunk/SpaceGrotesk.ttf',
  ...['bone', 'brick', 'iron', 'leather', 'moss', 'stone', 'wood'].flatMap(kind => ['albedo', 'normal'].map(slot => `public/environments/monster-dungeon/${kind}-${slot}.png`)),
  ...['bark-albedo', 'bark-normal', 'leaf-albedo'].map(name => `src/components/environment/textures/${name}.png`),
]

test('authoring boundary admits only the exact reviewed environment assets', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-binary-boundary-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: temporary })
    for (const asset of assets) {
      const target = path.join(temporary, asset)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(root, asset), target)
    }
    const accepted = checkAuthoringBoundary(temporary)
    assert.equal(accepted.valid, true, accepted.errors.join('\n'))
    const stray = path.join(temporary, 'public/environments/monster-dungeon/unreviewed.png')
    fs.copyFileSync(path.join(root, assets[1]), stray)
    assert.match(checkAuthoringBoundary(temporary).errors.join('\n'), /unreviewed.png is an unapproved binary/)
    fs.unlinkSync(stray)
    fs.appendFileSync(path.join(temporary, assets[1]), Buffer.from([0]))
    assert.match(checkAuthoringBoundary(temporary).errors.join('\n'), /approved digest/)
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
})
