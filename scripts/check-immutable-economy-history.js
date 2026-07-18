#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateEconomyDisclosures } from './generate-economy-disclosures.js'
import { generateEconomySimulationReports } from './economy-simulator.js'
import { validateProductionEconomy } from './validate-production-economy.js'

const __filename = fileURLToPath(import.meta.url)

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

export function economyHistoryPathsAtRef(ref, cwd = process.cwd()) {
  git(['rev-parse', '--verify', `${ref}^{commit}`], cwd)
  const contractPaths = lines(git([
    'ls-tree',
    '-r',
    '--name-only',
    ref,
    '--',
    'economy/contracts/editions',
  ], cwd)).filter(filePath => filePath.endsWith('.json'))
  const immutablePaths = new Set(contractPaths)

  for (const contractPath of contractPaths) {
    const contract = JSON.parse(git(['show', `${ref}:${contractPath}`], cwd))
    if (
      typeof contract.disclosureArtifact !== 'string' ||
      !/^economy\/disclosures\/\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(
        contract.disclosureArtifact,
      )
    ) {
      throw new Error(`${contractPath} has no valid immutable disclosure anchor at ${ref}`)
    }
    if (!pathExistsAtRef(ref, contract.disclosureArtifact, cwd)) {
      throw new Error(`${contractPath} references a missing disclosure at ${ref}`)
    }
    immutablePaths.add(contract.disclosureArtifact)
  }

  const scenarioPaths = lines(git([
    'ls-tree',
    '-r',
    '--name-only',
    ref,
    '--',
    'economy/simulations/scenarios',
  ], cwd)).filter(filePath => filePath.endsWith('.json'))
  for (const scenarioPath of scenarioPaths) {
    const scenario = JSON.parse(git(['show', `${ref}:${scenarioPath}`], cwd))
    if (
      typeof scenario.reportArtifact !== 'string' ||
      !/^economy\/simulations\/reports\/\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(
        scenario.reportArtifact,
      )
    ) {
      throw new Error(`${scenarioPath} has no valid immutable report anchor at ${ref}`)
    }
    if (!pathExistsAtRef(ref, scenario.reportArtifact, cwd)) {
      throw new Error(`${scenarioPath} references a missing report at ${ref}`)
    }
    immutablePaths.add(scenarioPath)
    immutablePaths.add(scenario.reportArtifact)
  }

  const productionEditionPaths = lines(git([
    'ls-tree',
    '-r',
    '--name-only',
    ref,
    '--',
    'economy/production/editions',
  ], cwd)).filter(filePath => filePath.endsWith('.json'))
  for (const editionPath of productionEditionPaths) {
    const edition = JSON.parse(git(['show', `${ref}:${editionPath}`], cwd))
    if (
      typeof edition.migration !== 'string' ||
      !/^\d{4}_earned_economy_[a-z0-9_]+\.sql$/.test(edition.migration)
    ) {
      throw new Error(`${editionPath} has no valid immutable production migration anchor at ${ref}`)
    }
    const migrationPath = `supabase/migrations/${edition.migration}`
    if (!pathExistsAtRef(ref, migrationPath, cwd)) {
      throw new Error(`${editionPath} references a missing production migration at ${ref}`)
    }
    immutablePaths.add(editionPath)
    immutablePaths.add(migrationPath)
  }
  return [...immutablePaths].sort()
}

export function mergeBaseForEconomyHistory(ref, cwd = process.cwd()) {
  git(['rev-parse', '--verify', `${ref}^{commit}`], cwd)
  return git(['merge-base', 'HEAD', ref], cwd)
}

export function changedImmutableEconomyPaths(ref, cwd = process.cwd()) {
  const mergeBase = mergeBaseForEconomyHistory(ref, cwd)
  const immutablePaths = economyHistoryPathsAtRef(mergeBase, cwd)
  if (immutablePaths.length === 0) return { mergeBase, changed: [] }
  const changed = lines(git(['diff', '--name-only', mergeBase, '--', ...immutablePaths], cwd))
  return { mergeBase, changed }
}

function main() {
  const [ref] = process.argv.slice(2)
  if (!ref || process.argv.length !== 3) {
    throw new Error('Usage: check-immutable-economy-history.js <base-git-ref>')
  }

  generateEconomyDisclosures()
  generateEconomySimulationReports()
  validateProductionEconomy()
  const { mergeBase, changed } = changedImmutableEconomyPaths(ref)
  if (changed.length > 0) {
    throw new Error(
      `Published economy history is immutable; append a new contract version instead:\n${changed.join('\n')}`,
    )
  }
  console.log(`Verified immutable economy history against merge base ${mergeBase}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main()
