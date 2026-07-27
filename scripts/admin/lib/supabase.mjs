// Connection plumbing for the support CLI.
//
// WHY @supabase/supabase-js RATHER THAN RAW POSTGREST FETCH
// ---------------------------------------------------------
// 1. It is already a runtime dependency of this repo (package.json), so the CLI
//    adds no new supply-chain surface for a tool that holds the service-role key.
// 2. It matches the only other service-role code path we ship,
//    supabase/functions/_shared/supabaseClient.ts:26-32, so operators and edge
//    functions fail the same way.
// 3. `.rpc()` surfaces the Postgres SQLSTATE in `error.code`, which the whole
//    error-mapping story in commands.mjs depends on (55000 pull hold, 22023
//    argument/idempotency drift, 22003 balance floor).
//
// The ONE exception is user lookup. `@supabase/auth-js` exposes
// `admin.listUsers({ page, perPage })` with no filter parameter, so an
// email search through the client library would mean paging the entire user
// table. GoTrue itself supports `GET /auth/v1/admin/users?filter=<q>`, so that
// single call is a plain fetch with the same credentials.

import { createClient } from '@supabase/supabase-js'

const URL_VARIABLES = ['SUPABASE_URL', 'VITE_SUPABASE_URL']
const KEY_VARIABLES = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY']

export class EnvironmentError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EnvironmentError'
  }
}

function firstPresent(env, names) {
  for (const name of names) {
    const value = env[name]
    if (typeof value === 'string' && value.trim() !== '') {
      return { name, value: value.trim() }
    }
  }
  return null
}

/**
 * Resolve the project URL and service-role key from a plain environment object.
 * Pure: takes the env instead of reading `process.env`, so it is unit-tested.
 *
 * The key is never echoed — only the NAME of the variable it came from.
 */
export function resolveEnvironment(env) {
  const url = firstPresent(env, URL_VARIABLES)
  if (!url) {
    throw new EnvironmentError(
      `Missing Supabase project URL. Set one of: ${URL_VARIABLES.join(', ')}`,
    )
  }
  let parsed
  try {
    parsed = new URL(url.value)
  } catch {
    throw new EnvironmentError(`${url.name} is not a valid URL`)
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new EnvironmentError(`${url.name} must be https (got ${parsed.protocol}//)`)
  }

  const key = firstPresent(env, KEY_VARIABLES)
  if (!key) {
    throw new EnvironmentError(
      'Missing Supabase service-role key. Set one of: ' +
        `${KEY_VARIABLES.join(', ')}. Copy it from the Supabase dashboard ` +
        '(Project Settings -> API Keys -> service_role). Never commit it.',
    )
  }
  if (key.value.length < 20) {
    throw new EnvironmentError(`${key.name} looks truncated`)
  }

  return Object.freeze({
    url: url.value.replace(/\/+$/, ''),
    urlSource: url.name,
    key: key.value,
    keySource: key.name,
  })
}

/**
 * Strip the service-role key out of any string before it reaches stdout,
 * stderr, or a log file. supabase-js puts the request URL in some errors and a
 * misconfigured proxy can echo headers, so this runs over EVERY message the CLI
 * prints.
 */
export function redactSecret(text, secret) {
  if (typeof text !== 'string' || typeof secret !== 'string' || secret.length < 8) {
    return text
  }
  return text.replaceAll(secret, '[REDACTED service-role key]')
}

export function createAdminClient(environment) {
  return createClient(environment.url, environment.key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'x-dicesuki-admin-cli': '1' } },
  })
}

/**
 * GoTrue admin user search. `filter` is an ILIKE-style match on email/phone.
 * Returns `[]` rather than throwing on an empty result.
 */
export async function findAuthUsers(environment, { filter = null, page = 1, perPage = 20 } = {}) {
  const endpoint = new URL('/auth/v1/admin/users', environment.url)
  endpoint.searchParams.set('page', String(page))
  endpoint.searchParams.set('per_page', String(perPage))
  if (filter) endpoint.searchParams.set('filter', filter)

  const response = await fetch(endpoint, {
    headers: {
      apikey: environment.key,
      Authorization: `Bearer ${environment.key}`,
    },
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `GoTrue admin lookup failed (${response.status} ${response.statusText}) ${body}`.trim(),
    )
  }
  const payload = await response.json()
  return Array.isArray(payload?.users) ? payload.users : []
}

/**
 * Build a PostgREST `ilike` pattern. Values are double-quoted so display names
 * containing PostgREST's reserved characters (`,` `.` `(` `)`) are not parsed as
 * operator syntax; `%` is left intact so operators can wildcard on purpose.
 */
export function likePattern(query) {
  return `"%${String(query).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}%"`
}
