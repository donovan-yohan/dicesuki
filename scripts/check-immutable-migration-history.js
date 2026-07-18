#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const migrationDirectory = 'supabase/migrations'
const migrationName = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/

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

function validateSequence(paths, label) {
  const entries = paths.map(filePath => {
    const fileName = path.posix.basename(filePath)
    const match = migrationName.exec(fileName)
    if (!match) {
      throw new Error(
        `${label} contains invalid migration name ${filePath}; expected NNNN_snake_case.sql`,
      )
    }
    return { filePath, prefix: Number(match[1]) }
  }).sort((left, right) => left.prefix - right.prefix || left.filePath.localeCompare(right.filePath))

  const seen = new Map()
  for (const entry of entries) {
    const existing = seen.get(entry.prefix)
    if (existing) {
      throw new Error(
        `${label} reuses migration prefix ${String(entry.prefix).padStart(4, '0')}: ${existing}, ${entry.filePath}`,
      )
    }
    seen.set(entry.prefix, entry.filePath)
  }

  entries.forEach((entry, index) => {
    const expected = index + 1
    if (entry.prefix !== expected) {
      throw new Error(
        `${label} migration prefixes must be contiguous from 0001; expected ${String(expected).padStart(4, '0')} but found ${String(entry.prefix).padStart(4, '0')} at ${entry.filePath}`,
      )
    }
  })

  return entries
}

export function migrationPathsAtRef(ref, cwd = process.cwd()) {
  git(['rev-parse', '--verify', `${ref}^{commit}`], cwd)
  const paths = lines(git([
    'ls-tree',
    '-r',
    '--name-only',
    ref,
    '--',
    migrationDirectory,
  ], cwd)).filter(filePath => filePath.endsWith('.sql'))
  validateSequence(paths, `Migration history at ${ref}`)
  return paths.sort()
}

export function migrationPathsInWorktree(cwd = process.cwd()) {
  const directory = path.join(cwd, migrationDirectory)
  const paths = fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.sql'))
    .map(entry => `${migrationDirectory}/${entry.name}`)
  validateSequence(paths, 'Working-tree migration history')
  return paths.sort()
}

export function mergeBaseForMigrationHistory(ref, cwd = process.cwd()) {
  git(['rev-parse', '--verify', `${ref}^{commit}`], cwd)
  return git(['merge-base', 'HEAD', ref], cwd)
}

export function inspectMigrationHistory(ref, cwd = process.cwd()) {
  const mergeBase = mergeBaseForMigrationHistory(ref, cwd)
  const frozenPaths = migrationPathsAtRef(mergeBase, cwd)
  const currentPaths = migrationPathsInWorktree(cwd)
  const changed = frozenPaths.length === 0
    ? []
    : lines(git([
        'diff',
        '--no-renames',
        '--name-only',
        mergeBase,
        '--',
        ...frozenPaths,
      ], cwd)).sort()
  const frozenSet = new Set(frozenPaths)
  const appended = currentPaths.filter(filePath => !frozenSet.has(filePath))

  return { mergeBase, frozenPaths, appended, changed }
}

function main() {
  const [ref] = process.argv.slice(2)
  if (!ref || process.argv.length !== 3) {
    throw new Error('Usage: check-immutable-migration-history.js <base-git-ref>')
  }

  const { mergeBase, appended, changed } = inspectMigrationHistory(ref)
  if (changed.length > 0) {
    throw new Error(
      `Published Supabase migrations are immutable; restore these merge-base files and append a new migration instead:\n${changed.join('\n')}`,
    )
  }
  console.log(
    `Verified immutable contiguous Supabase migrations against merge base ${mergeBase}; ${appended.length} appended`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main()
