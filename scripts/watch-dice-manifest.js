#!/usr/bin/env node

/**
 * Watch Dice Manifest
 *
 * Watches the public/dice folder for changes and regenerates the manifest.
 * Used during development to automatically update the manifest when artists
 * add or modify dice assets.
 *
 * Usage: node scripts/watch-dice-manifest.js
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DICE_DIR = path.join(__dirname, '..', 'public', 'dice')
const GENERATE_SCRIPT = path.join(__dirname, 'generate-dice-manifest.js')

// Debounce timer to avoid multiple regenerations for batch changes
let debounceTimer = null
const DEBOUNCE_MS = 500

/**
 * Run the manifest generator
 */
function generateManifest() {
  console.log('\n🔄 Detected changes in public/dice, regenerating manifest...\n')

  const child = spawn('node', [GENERATE_SCRIPT], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  })

  child.on('error', (err) => {
    console.error('❌ Failed to run manifest generator:', err)
  })
}

/**
 * Debounced manifest generation
 */
function debouncedGenerate() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(generateManifest, DEBOUNCE_MS)
}

/**
 * Watch the dice directory recursively
 */
function watchDiceDirectory() {
  console.log('👀 Watching public/dice for changes...\n')

  // Generate manifest on startup
  generateManifest()

  // Watch for changes
  fs.watch(DICE_DIR, { recursive: true }, (eventType, filename) => {
    // Ignore manifest.json changes to prevent infinite loops
    if (filename === 'manifest.json') return

    // Only care about relevant files
    const ext = path.extname(filename || '')
    if (['.json', '.glb', '.gltf', '.png', '.jpg'].includes(ext) || !ext) {
      console.log(`📁 ${eventType}: ${filename}`)
      debouncedGenerate()
    }
  })
}

// Check if dice directory exists
if (!fs.existsSync(DICE_DIR)) {
  console.error(`❌ Dice directory not found: ${DICE_DIR}`)
  console.log('Creating dice directory...')
  fs.mkdirSync(DICE_DIR, { recursive: true })
}

watchDiceDirectory()
