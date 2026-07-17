#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  catalogPaths,
  generateCatalogArtifacts,
} from './generate-collectible-catalog.js'

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

function pathExistsAtRef(ref, filePath, cwd) {
  try {
    execFileSync('git', ['cat-file', '-e', `${ref}:${filePath}`], {
      cwd,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

export function immutableCatalogPathsAtRef(ref, cwd = process.cwd()) {
  git(['rev-parse', '--verify', `${ref}^{commit}`], cwd)

  const editionPaths = lines(git([
    'ls-tree',
    '-r',
    '--name-only',
    ref,
    '--',
    'supabase/catalog/editions',
  ], cwd)).filter(filePath => filePath.endsWith('.json'))

  const immutablePaths = new Set(editionPaths)
  const baselineSql = 'supabase/catalog/collectible_catalog_v1.sql'
  if (pathExistsAtRef(ref, baselineSql, cwd)) immutablePaths.add(baselineSql)

  for (const editionPath of editionPaths) {
    const edition = JSON.parse(git(['show', `${ref}:${editionPath}`], cwd))
    if (typeof edition.migration !== 'string' || !edition.migration.endsWith('.sql')) {
      throw new Error(`${editionPath} has no valid migration anchor at ${ref}`)
    }
    immutablePaths.add(`supabase/migrations/${edition.migration}`)
  }

  return [...immutablePaths].sort()
}

export function changedImmutableCatalogPaths(ref, cwd = process.cwd()) {
  const immutablePaths = immutableCatalogPathsAtRef(ref, cwd)
  if (immutablePaths.length === 0) return []
  return lines(git(['diff', '--name-only', ref, '--', ...immutablePaths], cwd))
}

export function validateCurrentCatalogAnchors(cwd = process.cwd()) {
  const paths = catalogPaths(cwd)
  const editionFileNames = fs.readdirSync(paths.editionsDir)
    .filter(fileName => fileName.endsWith('.json'))
    .sort()
  if (editionFileNames.length === 0) throw new Error('No catalog edition manifests found')

  const referencedMigrations = new Set()
  editionFileNames.forEach((fileName, index) => {
    if (!/^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(fileName)) {
      throw new Error(`Invalid catalog edition filename ${fileName}`)
    }
    const edition = JSON.parse(fs.readFileSync(path.join(paths.editionsDir, fileName), 'utf8'))
    const expectedEdition = index + 1
    const expectedFileName = `${String(expectedEdition).padStart(4, '0')}-${edition.slug}.json`
    if (edition.edition !== expectedEdition || fileName !== expectedFileName) {
      throw new Error('Catalog edition manifests must be contiguous and match their filenames')
    }
    if (
      typeof edition.migration !== 'string' ||
      path.basename(edition.migration) !== edition.migration ||
      !edition.migration.endsWith('.sql')
    ) {
      throw new Error(`Catalog edition ${fileName} has an invalid migration anchor`)
    }
    if (referencedMigrations.has(edition.migration)) {
      throw new Error(`Catalog migration ${edition.migration} is referenced more than once`)
    }
    referencedMigrations.add(edition.migration)
    if (!fs.existsSync(path.join(paths.migrationsDir, edition.migration))) {
      throw new Error(`Catalog edition ${fileName} references a missing migration`)
    }
  })

  const orphanedMigrations = fs.readdirSync(paths.migrationsDir)
    .filter(fileName => /^\d{4}_catalog_[a-z0-9_]+\.sql$/.test(fileName))
    .filter(fileName => !referencedMigrations.has(fileName))
  if (orphanedMigrations.length > 0) {
    throw new Error(`Catalog migrations lack edition manifests: ${orphanedMigrations.join(', ')}`)
  }

  const unanchoredCatalogDml = fs.readdirSync(paths.migrationsDir)
    .filter(fileName => fileName.endsWith('.sql') && !referencedMigrations.has(fileName))
    .filter(fileName => {
      const sql = fs.readFileSync(path.join(paths.migrationsDir, fileName), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/--.*$/gm, '')
        .replaceAll('"', '')
        .replace(/\s+/g, ' ')
      const catalogMutation = /\b(insert\s+into|update|delete\s+from|merge\s+into|copy|truncate(?:\s+table)?)\s+(?:only\s+)?(?:public\s*\.\s*)?(catalog_items|catalog_asset_versions)\b/i
      return /BEGIN GENERATED COLLECTIBLE CATALOG/i.test(sql) ||
        catalogMutation.test(sql)
    })
  if (unanchoredCatalogDml.length > 0) {
    throw new Error(
      `Catalog DML must be anchored to edition manifests: ${unanchoredCatalogDml.join(', ')}`,
    )
  }
}

function main() {
  const [ref] = process.argv.slice(2)
  if (!ref || process.argv.length !== 3) {
    throw new Error('Usage: check-immutable-catalog-history.js <base-git-ref>')
  }

  validateCurrentCatalogAnchors()
  generateCatalogArtifacts()
  const changed = changedImmutableCatalogPaths(ref)
  if (changed.length > 0) {
    throw new Error(
      `Published catalog history is immutable; append a new edition instead:\n${changed.join('\n')}`,
    )
  }
  console.log(`Verified immutable catalog history against ${ref}`)
}

if (process.argv[1]?.endsWith('check-immutable-catalog-history.js')) main()
