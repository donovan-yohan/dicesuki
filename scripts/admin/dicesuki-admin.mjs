#!/usr/bin/env node
// Dicesuki operator/support CLI.
//
//   node scripts/admin/dicesuki-admin.mjs <command> [options]
//   npm run admin -- <command> [options]
//
// Connects to the production Supabase project with the service-role key from
// the environment. Every mutation goes through a trusted SECURITY DEFINER RPC
// (see scripts/admin/lib/plans.mjs) — this tool never writes a table directly,
// because no API role is granted DML on the economy tables.
//
// See scripts/admin/README.md for setup and the support runbook.

import process from 'node:process'
import path from 'node:path'
import readline from 'node:readline/promises'

import { UsageError, parseArgs, usageText } from './lib/args.mjs'
import { OperationError, runCommand } from './lib/commands.mjs'
import { EnvironmentError, createAdminClient, resolveEnvironment, redactSecret } from './lib/supabase.mjs'

const EXIT_OK = 0
const EXIT_FAILURE = 1
const EXIT_USAGE = 2

/**
 * stdout/stderr writers that strip the service-role key from every byte they
 * emit, so a stray error string or a copy-pasted transcript can never leak it.
 */
function createIo({ json, secret }) {
  const write = (stream, text) => {
    stream.write(`${redactSecret(String(text), secret)}\n`)
  }
  return {
    json,
    say(text) {
      if (!json) write(process.stdout, text)
    },
    warn(text) {
      write(process.stderr, text)
    },
    result(payload) {
      if (json) process.stdout.write(`${redactSecret(JSON.stringify(payload, null, 2), secret)}\n`)
    },
    async confirm(question) {
      if (!process.stdin.isTTY) {
        throw new OperationError(
          'Refusing to mutate without confirmation on a non-interactive stdin. Pass --yes.',
        )
      }
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
      try {
        const answer = await rl.question(`${question} Type "yes" to continue: `)
        return answer.trim().toLowerCase() === 'yes'
      } finally {
        rl.close()
      }
    },
  }
}

export async function main(argv, env = process.env) {
  let request
  try {
    request = parseArgs(argv)
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${usageText()}\n`)
      return EXIT_USAGE
    }
    throw error
  }

  if (request.command === 'help') {
    process.stdout.write(`${usageText(request.helpTopic)}\n`)
    return EXIT_OK
  }

  let environment
  try {
    environment = resolveEnvironment(env)
  } catch (error) {
    if (error instanceof EnvironmentError) {
      process.stderr.write(`${error.message}\n`)
      return EXIT_USAGE
    }
    throw error
  }

  const io = createIo({ json: request.json, secret: environment.key })
  io.say(
    `# ${environment.url} (key from ${environment.keySource}, url from ${environment.urlSource})`,
  )

  try {
    const data = await runCommand(request, {
      client: createAdminClient(environment),
      environment,
      io,
    })
    io.result({ command: request.command, ok: true, ...data })
    return EXIT_OK
  } catch (error) {
    if (error instanceof UsageError) {
      io.warn(error.message)
      return EXIT_USAGE
    }
    const message = error instanceof OperationError ? error.message : `${error?.stack ?? error}`
    io.warn(message)
    io.result({
      command: request.command,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: error?.code ?? null,
    })
    return EXIT_FAILURE
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)

if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2))
}
