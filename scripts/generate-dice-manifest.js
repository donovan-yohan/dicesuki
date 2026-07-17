#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_DICE_DIR = path.join(__dirname, '..', 'public', 'dice')
const DEFAULT_MANIFEST_PATH = path.join(DEFAULT_DICE_DIR, 'manifest.json')

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory()
  } catch {
    return false
  }
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Build the deployable index from stable filesystem facts only. */
export function buildDiceManifest(diceDir = DEFAULT_DICE_DIR) {
  if (!isDirectory(diceDir)) throw new Error(`Dice directory not found: ${diceDir}`)

  const sets = fs.readdirSync(diceDir)
    .filter(setId => !setId.startsWith('.') && isDirectory(path.join(diceDir, setId)))
    .sort(compareStrings)
    .flatMap(setId => {
      const setPath = path.join(diceDir, setId)
      if (!isFile(path.join(setPath, 'set.json'))) return []

      const dice = fs.readdirSync(setPath)
        .filter(diceId => !diceId.startsWith('.') && isDirectory(path.join(setPath, diceId)))
        .sort(compareStrings)
        .flatMap(diceId => {
          const dicePath = path.join(setPath, diceId)
          if (
            !isFile(path.join(dicePath, 'model.glb')) ||
            !isFile(path.join(dicePath, 'metadata.json'))
          ) return []
          return [{
            id: diceId,
            path: `${setId}/${diceId}`,
            hasThumbnail: isFile(path.join(dicePath, 'thumbnail.png')),
          }]
        })

      return dice.length > 0 ? [{ id: setId, path: setId, dice }] : []
    })

  return { version: '2.0', sets }
}

export function renderDiceManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function writeDiceManifest({
  diceDir = DEFAULT_DICE_DIR,
  manifestPath = DEFAULT_MANIFEST_PATH,
} = {}) {
  const rendered = renderDiceManifest(buildDiceManifest(diceDir))
  fs.writeFileSync(manifestPath, rendered)
  return rendered
}

export function checkDiceManifest({
  diceDir = DEFAULT_DICE_DIR,
  manifestPath = DEFAULT_MANIFEST_PATH,
} = {}) {
  const expected = renderDiceManifest(buildDiceManifest(diceDir))
  const actual = isFile(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : null
  if (actual !== expected) {
    throw new Error('public/dice/manifest.json is stale; run npm run generate-dice-manifest')
  }
  return expected
}

function main() {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && !['--check', '--write'].includes(args[0]))) {
    throw new Error('Usage: [--write | --check]')
  }
  const checkOnly = args[0] === '--check'
  const rendered = checkOnly ? checkDiceManifest() : writeDiceManifest()
  const manifest = JSON.parse(rendered)
  const diceCount = manifest.sets.reduce((sum, set) => sum + set.dice.length, 0)
  console.log(`${checkOnly ? 'Verified' : 'Generated'} dice manifest: ${manifest.sets.length} sets, ${diceCount} dice`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main()
