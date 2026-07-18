#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
const database = 'dicesuki_supabase_test'
const image = process.env.DICESUKI_POSTGRES_TEST_IMAGE ??
  'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'
const container = `dicesuki-supabase-postgres-${process.pid}`
const psqlArgs = [
  'exec',
  '-i',
  container,
  'psql',
  '-X',
  '-q',
  '-v',
  'ON_ERROR_STOP=1',
  '-U',
  'postgres',
  '-d',
  database,
  '-At',
]
let containerStarted = false
let cleanupPromise = null

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `docker ${args[0]} failed (${result.status})\n${result.stdout}${result.stderr}`,
    )
  }
  return result
}

function psql(sql, label) {
  const result = docker(psqlArgs, { input: sql, allowFailure: true })
  if (result.status !== 0) {
    throw new Error(`${label} failed\n${result.stdout}${result.stderr}`)
  }
  return result.stdout.trim()
}

function psqlAsync(sql) {
  return new Promise(resolve => {
    const child = spawn('docker', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('close', status => resolve({
      status,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }))
    child.stdin.end(sql)
  })
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function stopContainer() {
  if (cleanupPromise) return cleanupPromise
  if (!containerStarted) return Promise.resolve()

  cleanupPromise = new Promise(resolve => {
    const child = spawn(
      'docker',
      ['stop', '--time', '0', container],
      { stdio: 'ignore' },
    )
    child.once('error', resolve)
    child.once('close', resolve)
  }).finally(() => {
    containerStarted = false
  })
  return cleanupPromise
}

function installSignalCleanup() {
  const handlers = new Map()
  for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const handler = () => {
      void (async () => {
        await stopContainer()
        process.exit(exitCode)
      })()
    }
    handlers.set(signal, handler)
    process.once(signal, handler)
  }
  return () => {
    for (const [signal, handler] of handlers) {
      process.removeListener(signal, handler)
    }
  }
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = docker(
      [
        'exec',
        container,
        'psql',
        '-X',
        '-q',
        '-U',
        'postgres',
        '-d',
        database,
        '-c',
        'select 1',
      ],
      { allowFailure: true },
    )
    if (result.status === 0) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Local Postgres test container did not become ready')
}

function sortedMigrationFiles() {
  const migrationFiles = fs.readdirSync(path.join(root, 'supabase/migrations'))
    .filter(fileName => /^\d{4}_[a-z0-9_]+\.sql$/.test(fileName))
    .sort()
  migrationFiles.forEach((fileName, index) => {
    const expectedPrefix = String(index + 1).padStart(4, '0')
    if (!fileName.startsWith(`${expectedPrefix}_`)) {
      throw new Error(
        `Supabase migration suite is not contiguous: expected ${expectedPrefix}, found ${fileName}`,
      )
    }
  })
  return migrationFiles
}

function sortedTestSuites() {
  return fs.readdirSync(path.join(root, 'supabase/tests'))
    .filter(fileName => /^\d{4}_[a-z0-9_]+\.test\.(?:sql|mjs)$/.test(fileName))
    .sort((left, right) => {
      const prefixOrder = left.slice(0, 4).localeCompare(right.slice(0, 4))
      if (prefixOrder !== 0) return prefixOrder
      const leftKind = left.endsWith('.sql') ? 0 : 1
      const rightKind = right.endsWith('.sql') ? 0 : 1
      return leftKind - rightKind || left.localeCompare(right)
    })
}

export async function main() {
  docker(['version'])
  containerStarted = false
  cleanupPromise = null
  const removeSignalCleanup = installSignalCleanup()
  try {
    docker([
      'run',
      '--detach',
      '--rm',
      '--name',
      container,
      '--env',
      'POSTGRES_PASSWORD=postgres',
      '--env',
      `POSTGRES_DB=${database}`,
      image,
    ])
    containerStarted = true
    await waitUntilReady()

    psql(
      read('supabase/tests/support/local_supabase_fixture.sql'),
      'local Supabase role/auth fixture',
    )

    const migrationFiles = sortedMigrationFiles()
    for (const migrationFile of migrationFiles) {
      psql(read(`supabase/migrations/${migrationFile}`), migrationFile)
    }

    const testSuites = sortedTestSuites()
    const context = Object.freeze({ psql, psqlAsync, read, root })
    for (const testSuite of testSuites) {
      if (testSuite.endsWith('.sql')) {
        psql(read(`supabase/tests/${testSuite}`), testSuite)
      } else {
        const moduleUrl = pathToFileURL(path.join(root, 'supabase/tests', testSuite))
        const suite = await import(moduleUrl.href)
        if (typeof suite.run !== 'function') {
          throw new Error(`${testSuite} must export async function run(context)`)
        }
        await suite.run(context)
      }
    }

    console.log(
      `Supabase Postgres harness passed ${migrationFiles.length} sorted migrations and ${testSuites.length} sorted test suites`,
    )
  } finally {
    await stopContainer()
    removeSignalCleanup()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main()
}
