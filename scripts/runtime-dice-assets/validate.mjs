#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { validateRuntimeAssetManifest } from './runtime-asset-contract.mjs'

const manifestPath = path.resolve(
  process.cwd(),
  'public/dice/cozy-forest-imagegen-set/runtime-assets.json',
)
const result = await validateRuntimeAssetManifest(manifestPath)
if (!result.valid) {
  console.error(`Runtime dice asset validation failed:\n${result.errors.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(
    `Runtime dice assets passed: ${result.manifest.assets.length} dice, ${result.completeSetBytes} bytes`,
  )
}
