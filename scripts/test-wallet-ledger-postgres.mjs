#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const database = 'dicesuki_wallet_test'
const image = process.env.DICESUKI_POSTGRES_TEST_IMAGE ??
  'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'
const container = `dicesuki-wallet-postgres-${process.pid}`
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
    child.on('close', status => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }))
    child.stdin.end(sql)
  })
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
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

function appendSql(userId, delta, idempotencyKey) {
  return `
    set role service_role;
    select (public.append_wallet_ledger_entry(
      '${userId}',
      'stars',
      'promotional',
      ${delta},
      'test.concurrent',
      '${idempotencyKey}',
      'earned-collection@1',
      '{"harness":"concurrency"}'::jsonb
    )).id;
  `
}

async function main() {
  docker(['version'])
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
    await waitUntilReady()

    psql(
      read('supabase/tests/support/local_supabase_fixture.sql'),
      'local Supabase role/auth fixture',
    )

    const migrationFiles = fs.readdirSync(path.join(root, 'supabase/migrations'))
      .filter(fileName => /^\d{4}_[a-z0-9_]+\.sql$/.test(fileName))
      .sort()
    for (const migrationFile of migrationFiles) {
      psql(read(`supabase/migrations/${migrationFile}`), migrationFile)
    }

    psql(
      read('supabase/tests/0009_earned_economy_ledger.test.sql'),
      'wallet migration/RLS/immutability/idempotency assertions',
    )

    const replayUser = '33333333-3333-4333-8333-333333333333'
    const overspendUser = '44444444-4444-4444-8444-444444444444'
    psql(
      `insert into auth.users (id) values ('${replayUser}'), ('${overspendUser}');`,
      'concurrency users',
    )

    const identical = await Promise.all([
      psqlAsync(appendSql(replayUser, 160, 'concurrent:replay:0001')),
      psqlAsync(appendSql(replayUser, 160, 'concurrent:replay:0001')),
    ])
    if (identical.some(result => result.status !== 0)) {
      throw new Error(`Concurrent identical replay failed: ${JSON.stringify(identical)}`)
    }
    if (new Set(identical.map(result => result.stdout)).size !== 1) {
      throw new Error(`Concurrent identical replay returned different rows: ${JSON.stringify(identical)}`)
    }
    const replayState = psql(`
      select current_balance || ':' || (
        select count(*) from public.wallet_ledger_entries where user_id = '${replayUser}'
      )
      from public.wallet_balances where user_id = '${replayUser}';
    `, 'concurrent replay reconciliation')
    if (replayState !== '160:1') {
      throw new Error(`Concurrent replay changed balance more than once: ${replayState}`)
    }

    psql(appendSql(overspendUser, 160, 'concurrent:credit:0001'), 'overspend seed credit')
    const debits = await Promise.all([
      psqlAsync(appendSql(overspendUser, -120, 'concurrent:debit:a')),
      psqlAsync(appendSql(overspendUser, -120, 'concurrent:debit:b')),
    ])
    if (debits.filter(result => result.status === 0).length !== 1) {
      throw new Error(`Exactly one concurrent debit should succeed: ${JSON.stringify(debits)}`)
    }
    if (!debits.find(result => result.status !== 0)?.stderr.includes('Insufficient stars/promotional balance')) {
      throw new Error(`Rejected concurrent debit did not fail for insufficient balance: ${JSON.stringify(debits)}`)
    }
    const debitState = psql(`
      select balances.current_balance || ':' || count(entries.id) || ':' || sum(entries.delta_amount)
      from public.wallet_balances as balances
      join public.wallet_ledger_entries as entries
        on entries.account_id = balances.account_id
       and entries.currency_id = balances.currency_id
       and entries.balance_bucket = balances.balance_bucket
      where balances.user_id = '${overspendUser}'
      group by balances.current_balance;
    `, 'concurrent debit reconciliation')
    if (debitState !== '40:2:40') {
      throw new Error(`Concurrent debit broke ledger reconciliation: ${debitState}`)
    }

    console.log(
      `Postgres wallet harness passed ${migrationFiles.length} migrations, RLS/immutability/idempotency checks, concurrent replay, and concurrent overspend`,
    )
  } finally {
    docker(['stop', '--time', '0', container], { allowFailure: true })
  }
}

await main()
