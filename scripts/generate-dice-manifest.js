#!/usr/bin/env node

/**
 * Generate Dice Manifest
 *
 * Scans the public/dice folder structure and generates a manifest.json
 * that lists all available sets and dice for the production dice loader.
 *
 * Usage: node scripts/generate-dice-manifest.js
 * Or: npm run generate-dice-manifest
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DICE_DIR = path.join(__dirname, '..', 'public', 'dice')
const MANIFEST_PATH = path.join(DICE_DIR, 'manifest.json')

/**
 * Check if a path is a directory
 */
function isDirectory(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

/**
 * Check if a file exists
 */
function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

/**
 * Scan for dice sets
 */
function scanSets() {
  const sets = []

  // Get all directories in the dice folder
  const entries = fs.readdirSync(DICE_DIR)

  for (const entry of entries) {
    const setPath = path.join(DICE_DIR, entry)

    // Skip non-directories and special files
    if (!isDirectory(setPath)) continue
    if (entry.startsWith('.')) continue

    // Check if set.json exists
    const setJsonPath = path.join(setPath, 'set.json')
    if (!fileExists(setJsonPath)) {
      console.warn(`⚠️  Skipping ${entry}: no set.json found`)
      continue
    }

    // Scan for dice in this set
    const dice = scanDice(entry, setPath)

    if (dice.length === 0) {
      console.warn(`⚠️  Skipping ${entry}: no valid dice found`)
      continue
    }

    sets.push({
      id: entry,
      path: entry,
      dice,
    })

    console.log(`✓ Found set: ${entry} (${dice.length} dice)`)
  }

  return sets
}

/**
 * Scan for dice in a set
 */
function scanDice(setId, setPath) {
  const dice = []

  const entries = fs.readdirSync(setPath)

  for (const entry of entries) {
    const dicePath = path.join(setPath, entry)

    // Skip non-directories and special files
    if (!isDirectory(dicePath)) continue
    if (entry.startsWith('.')) continue

    // Check if model.glb exists
    const modelPath = path.join(dicePath, 'model.glb')
    if (!fileExists(modelPath)) {
      console.warn(`  ⚠️  Skipping ${setId}/${entry}: no model.glb found`)
      continue
    }

    // Check if metadata.json exists
    const metadataPath = path.join(dicePath, 'metadata.json')
    if (!fileExists(metadataPath)) {
      console.warn(`  ⚠️  Skipping ${setId}/${entry}: no metadata.json found`)
      continue
    }

    // Check for thumbnail
    const thumbnailPath = path.join(dicePath, 'thumbnail.png')
    const hasThumbnail = fileExists(thumbnailPath)

    dice.push({
      id: entry,
      path: `${setId}/${entry}`,
      hasThumbnail,
    })

    console.log(`  ✓ Found dice: ${entry}${hasThumbnail ? ' (with thumbnail)' : ''}`)
  }

  return dice
}

/**
 * Main function
 */
function main() {
  console.log('🎲 Generating dice manifest...\n')

  // Check if dice directory exists
  if (!isDirectory(DICE_DIR)) {
    console.error(`❌ Dice directory not found: ${DICE_DIR}`)
    process.exit(1)
  }

  // Scan for sets
  const sets = scanSets()

  if (sets.length === 0) {
    console.log('\n⚠️  No valid sets found. Creating empty manifest.')
  }

  // Generate manifest
  const manifest = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    sets,
  }

  // Count total dice
  const totalDice = sets.reduce((sum, set) => sum + set.dice.length, 0)

  // Write manifest
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2))

  console.log(`\n✅ Manifest generated: ${MANIFEST_PATH}`)
  console.log(`   Sets: ${sets.length}`)
  console.log(`   Dice: ${totalDice}`)
}

main()
