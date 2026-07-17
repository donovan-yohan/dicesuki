#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import {
  runtimeAssetManifestPaths,
  validateRuntimeAssetManifest,
} from './runtime-asset-contract.mjs'

const repoRoot = path.resolve(process.cwd())
const manifestPaths = runtimeAssetManifestPaths(repoRoot)
if (manifestPaths.length === 0) throw new Error('No runtime asset manifests found')

for (const manifestPath of manifestPaths) {
  const result = await validateRuntimeAssetManifest(manifestPath, repoRoot)
  if (!result.valid) {
    console.error(
      `Runtime dice asset validation failed (${path.relative(repoRoot, manifestPath)}):\n` +
      result.errors.join('\n'),
    )
    process.exitCode = 1
  } else {
    console.log(
      `Runtime dice assets passed (${result.manifest.setId}): ` +
      `${result.manifest.assets.length} dice, ${result.completeSetBytes} bytes`,
    )
  }
}
