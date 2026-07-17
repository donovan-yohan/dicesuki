#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { selectCanonicalReferencePath } from './canonical-validation.mjs'

const FIXTURE_DIRECTORY = 'scripts/imagegen-uv/fixtures'
const RUNTIME_SOURCE_LOCK_DIRECTORY = 'scripts/runtime-dice-assets/sources'
const RUNTIME_DICE_DIRECTORY = 'public/dice'

export function immutableReferencePathsAtRef(ref, repoRoot = process.cwd()) {
  git(['rev-parse', '--verify', `${ref}^{commit}`], repoRoot)
  return lines(git([
    'ls-tree',
    '-r',
    '--name-only',
    ref,
    '--',
    FIXTURE_DIRECTORY,
    RUNTIME_SOURCE_LOCK_DIRECTORY,
    RUNTIME_DICE_DIRECTORY,
  ], repoRoot)).filter((file) => (
    /canonical-contract-v\d+\.json$/.test(file) ||
    (file.startsWith(`${RUNTIME_SOURCE_LOCK_DIRECTORY}/`) && file.endsWith('.lock.json')) ||
    /^public\/dice\/[^/]+\/runtime-assets\.json$/.test(file)
  )).sort()
}

export function changedCanonicalReferencePaths(ref, repoRoot = process.cwd()) {
  const immutablePaths = immutableReferencePathsAtRef(ref, repoRoot)
  if (immutablePaths.length === 0) return []
  return lines(git(['diff', '--name-only', ref, '--', ...immutablePaths], repoRoot))
}

export function validateCurrentReferenceHistory(repoRoot = process.cwd()) {
  const directory = path.join(repoRoot, FIXTURE_DIRECTORY)
  const files = readdirSync(directory)
    .filter((file) => /^canonical-contract-v\d+\.json$/.test(file))
    .sort((first, second) => referenceVersion(first) - referenceVersion(second))
  if (files.length === 0) throw new Error('No canonical ImageGen reference fixtures found')

  files.forEach((file, index) => {
    const version = index + 1
    if (referenceVersion(file) !== version) {
      throw new Error('Canonical ImageGen reference versions must be contiguous')
    }
    const value = JSON.parse(readFileSync(path.join(directory, file), 'utf8'))
    if (value.referenceVersion !== version) {
      throw new Error(`${file} must declare referenceVersion ${version}`)
    }
  })

  const newest = files.at(-1)
  const selected = path.basename(selectCanonicalReferencePath(directory))
  if (selected !== newest) {
    throw new Error(`canonical-validation.mjs must select newest reference ${newest}`)
  }

  return { files, newest, selected }
}

function referenceVersion(file) {
  return Number(file.match(/-v(\d+)\.json$/)?.[1])
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function lines(value) {
  return value ? value.split('\n').filter(Boolean) : []
}

function main() {
  const [ref] = process.argv.slice(2)
  if (!ref || process.argv.length !== 3) {
    throw new Error('Usage: check-canonical-history.mjs <base-git-ref>')
  }
  validateCurrentReferenceHistory()
  const changed = changedCanonicalReferencePaths(ref)
  if (changed.length > 0) {
    throw new Error(
      `Published ImageGen references, runtime source locks, and runtime manifests are immutable; append a version, supplement, or set instead:\n${changed.join('\n')}`,
    )
  }
  console.log(`Verified immutable ImageGen history against ${ref}`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
