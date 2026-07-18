import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectMigrationHistory,
  migrationPathsAtRef,
  migrationPathsInWorktree,
} from './check-immutable-migration-history.js'

const temporaryDirectories: string[] = []

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function write(root: string, filePath: string, value: string) {
  const target = path.join(root, filePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, value)
}

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-migration-history-'))
  temporaryDirectories.push(root)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'Migration Guard Test')
  git(root, 'config', 'user.email', 'migration-guard@example.invalid')
  write(root, 'supabase/migrations/0001_profiles.sql', 'select 1;\n')
  write(root, 'supabase/migrations/0002_inventory.sql', 'select 2;\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'migration baseline')
  return { root, baseline: git(root, 'rev-parse', 'HEAD') }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('global immutable migration history guard', () => {
  it('freezes every migration present at the branch merge base', () => {
    const { root, baseline } = repository()
    git(root, 'checkout', '-qb', 'feature')
    write(root, 'supabase/migrations/0001_profiles.sql', 'select 99;\n')
    fs.unlinkSync(path.join(root, 'supabase/migrations/0002_inventory.sql'))

    expect(inspectMigrationHistory('main', root)).toEqual({
      mergeBase: baseline,
      frozenPaths: [
        'supabase/migrations/0001_profiles.sql',
        'supabase/migrations/0002_inventory.sql',
      ],
      appended: [],
      changed: [
        'supabase/migrations/0001_profiles.sql',
        'supabase/migrations/0002_inventory.sql',
      ],
    })
  })

  it('allows only the next contiguous, uniquely numbered append', () => {
    const { root } = repository()
    git(root, 'checkout', '-qb', 'feature')
    write(root, 'supabase/migrations/0003_rewards.sql', 'select 3;\n')

    expect(inspectMigrationHistory('main', root).appended).toEqual([
      'supabase/migrations/0003_rewards.sql',
    ])

    fs.unlinkSync(path.join(root, 'supabase/migrations/0003_rewards.sql'))
    write(root, 'supabase/migrations/0004_rewards.sql', 'select 4;\n')
    expect(() => migrationPathsInWorktree(root)).toThrow(
      /expected 0003 but found 0004/,
    )
  })

  it('rejects duplicate prefixes, renumbering, and invalid migration names', () => {
    const { root } = repository()
    git(root, 'checkout', '-qb', 'feature')
    write(root, 'supabase/migrations/0002_duplicate.sql', 'select 22;\n')
    expect(() => migrationPathsInWorktree(root)).toThrow(/reuses migration prefix 0002/)

    fs.unlinkSync(path.join(root, 'supabase/migrations/0002_duplicate.sql'))
    fs.renameSync(
      path.join(root, 'supabase/migrations/0002_inventory.sql'),
      path.join(root, 'supabase/migrations/0003_inventory.sql'),
    )
    expect(() => migrationPathsInWorktree(root)).toThrow(/expected 0002 but found 0003/)

    fs.renameSync(
      path.join(root, 'supabase/migrations/0003_inventory.sql'),
      path.join(root, 'supabase/migrations/rewards.sql'),
    )
    expect(() => migrationPathsInWorktree(root)).toThrow(/invalid migration name/)
  })

  it('uses the merge base when the target branch advances independently', () => {
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

    expect(inspectMigrationHistory('main', root).mergeBase).toBe(baseline)
  })

  it('rejects a non-contiguous historical baseline instead of blessing it', () => {
    const { root } = repository()
    git(root, 'checkout', '-qb', 'broken-history')
    fs.renameSync(
      path.join(root, 'supabase/migrations/0002_inventory.sql'),
      path.join(root, 'supabase/migrations/0003_inventory.sql'),
    )
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'break migration sequence')

    expect(() => migrationPathsAtRef('HEAD', root)).toThrow(
      /expected 0002 but found 0003/,
    )
  })
})
