/**
 * Source guard for the test policy in `docs/guides/testing.md`.
 *
 * That document says e2e specs must be reachable through an npm script, that
 * flakes are fixed or deleted rather than skipped, and that neither runner may
 * mask a flake with retries. Prose cannot fail a build; this can.
 *
 * Mirrors the `?raw`/`readFileSync` drift-guard convention used by
 * `config/roomCapacity.guard.test.ts` and `themes/contrast.source.guard.test.ts`:
 * inspect the shipped text, not a re-export.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const SELF = 'src/test/testPolicy.guard.test.ts'
const TEST_ROOTS = ['src', 'e2e', 'scripts', 'supabase']
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts|mjs)$/
const SKIP_DIRS = new Set(['node_modules', 'dist', '.worktrees', 'screenshots'])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (TEST_FILE.test(entry)) out.push(relative(root, full))
  }
  return out
}

const testFiles = TEST_ROOTS.flatMap((dir) => walk(join(root, dir)))

describe('test policy', () => {
  it('scans a non-trivial number of test files', () => {
    // A broken walker must fail loudly rather than vacuously pass the rest.
    expect(testFiles.length).toBeGreaterThan(100)
  })

  it('gives every e2e spec an npm script', () => {
    // A spec with no script runs in no documented workflow, so it rots unnoticed.
    const scripts = JSON.stringify(
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts,
    )
    const specs = testFiles.filter((file) => file.startsWith('e2e/'))

    expect(specs.length).toBeGreaterThan(0)
    expect(specs.filter((spec) => !scripts.includes(spec))).toEqual([])
  })

  it('has no skipped, focused, or todo tests', () => {
    // `.skip` is a TODO that reports success; `.only` silently drops the suite.
    const pattern = /\b(?:it|test|describe)\.(?:skip|only|todo|fails)\s*\(/
    const offenders = testFiles.filter(
      (file) => file !== SELF && pattern.test(readFileSync(join(root, file), 'utf8')),
    )

    expect(offenders).toEqual([])
  })

  it('declares no retries in either runner config', () => {
    // Retrying a flake hides it; the policy is fix deterministically or delete.
    for (const config of ['vite.config.ts', 'playwright.config.ts']) {
      const source = readFileSync(join(root, config), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')

      expect(source, `${config} must not configure retries`).not.toMatch(
        /\bretries\s*:/,
      )
      expect(source, `${config} must not configure retry`).not.toMatch(
        /\bretry\s*:/,
      )
    }
  })

  it('keeps the pull request evidence contract discoverable', () => {
    const template = readFileSync(join(root, '.github/pull_request_template.md'), 'utf8')

    for (const marker of [
      '## Outcome and impact',
      '## Intent and scope',
      'Context and architecture seams/invariants:',
      '## Verification evidence',
      'Exact tested head SHA:',
      '| Exact testing/harness command | Result |',
      'Runtime/device evidence (when applicable):',
      'Screenshots or recording (when UI changes):',
      '## Risk and delivery',
      'Migration/deploy notes (N/A allowed):',
      'new append-only migration',
      'rollout target/order, and live proof',
      'never rewrite a merged migration',
      '## Review closure',
      'Exact reviewed head SHA:',
      'Reviewer and evidence (review URL, comment, or artifact):',
      'Remaining caveats or follow-ups:',
    ]) {
      expect(template, `PR template must include ${marker}`).toContain(marker)
    }
  })
})
