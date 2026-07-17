import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  changedImmutableEconomyPaths,
  economyHistoryPathsAtRef,
  mergeBaseForEconomyHistory,
} from './check-immutable-economy-history.js'

const temporaryDirectories: string[] = []

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function write(root: string, filePath: string, value: string) {
  const target = path.join(root, filePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, value)
}

function contract(version: number, slug: string) {
  return `${JSON.stringify({
    contractVersion: version,
    slug,
    disclosureArtifact: `economy/disclosures/${String(version).padStart(4, '0')}-${slug}.json`,
  })}\n`
}

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-economy-history-'))
  temporaryDirectories.push(root)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'Economy Test')
  git(root, 'config', 'user.email', 'economy-test@example.invalid')
  write(
    root,
    'economy/contracts/editions/0001-broad-rarity-showcase.json',
    contract(1, 'broad-rarity-showcase'),
  )
  write(root, 'economy/disclosures/0001-broad-rarity-showcase.json', '{"version":1}\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'economy baseline')
  const baseline = git(root, 'rev-parse', 'HEAD')
  return { root, baseline }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('immutable economy history guard', () => {
  it('anchors each published contract and its generated disclosure', () => {
    const { root, baseline } = repository()
    expect(economyHistoryPathsAtRef(baseline, root)).toEqual([
      'economy/contracts/editions/0001-broad-rarity-showcase.json',
      'economy/disclosures/0001-broad-rarity-showcase.json',
    ])
  })

  it('allows a new contract version while rejecting any rewrite of prior history', () => {
    const { root, baseline } = repository()
    git(root, 'checkout', '-qb', 'feature')
    write(
      root,
      'economy/contracts/editions/0002-next-showcase.json',
      contract(2, 'next-showcase'),
    )
    write(root, 'economy/disclosures/0002-next-showcase.json', '{"version":2}\n')
    expect(changedImmutableEconomyPaths('main', root)).toEqual({
      mergeBase: baseline,
      changed: [],
    })

    write(
      root,
      'economy/contracts/editions/0001-broad-rarity-showcase.json',
      '{"rewritten":true}\n',
    )
    write(root, 'economy/disclosures/0001-broad-rarity-showcase.json', '{"rewritten":true}\n')
    expect(changedImmutableEconomyPaths('main', root)).toEqual({
      mergeBase: baseline,
      changed: [
        'economy/contracts/editions/0001-broad-rarity-showcase.json',
        'economy/disclosures/0001-broad-rarity-showcase.json',
      ],
    })
  })

  it('uses the branch merge base even when the target branch advances independently', () => {
    const { root, baseline } = repository()
    git(root, 'checkout', '-qb', 'feature')
    write(root, 'feature.txt', 'feature\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'feature work')

    git(root, 'checkout', 'main')
    write(root, 'main.txt', 'main\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'main work')
    git(root, 'checkout', 'feature')

    expect(mergeBaseForEconomyHistory('main', root)).toBe(baseline)
  })

  it('rejects disclosure anchors outside the immutable disclosure directory', () => {
    const { root } = repository()
    const current = JSON.parse(
      fs.readFileSync(
        path.join(root, 'economy/contracts/editions/0001-broad-rarity-showcase.json'),
        'utf8',
      ),
    )
    current.disclosureArtifact = 'src/generated/mutable-economy.json'
    write(
      root,
      'economy/contracts/editions/0001-broad-rarity-showcase.json',
      `${JSON.stringify(current)}\n`,
    )
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'bad anchor')
    expect(() => economyHistoryPathsAtRef('HEAD', root)).toThrow(/no valid immutable disclosure anchor/)
  })

  it('rejects a contract whose immutable disclosure anchor is missing', () => {
    const { root } = repository()
    fs.unlinkSync(path.join(root, 'economy/disclosures/0001-broad-rarity-showcase.json'))
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'remove disclosure')
    expect(() => economyHistoryPathsAtRef('HEAD', root)).toThrow(/references a missing disclosure/)
  })
})
