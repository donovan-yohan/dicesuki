// Deno-only Supabase client factories for the edge functions.
//
// This module imports the Supabase JS client via an `npm:` specifier and reads
// `Deno.env`, so it runs ONLY inside the Supabase Edge (Deno) runtime. It is
// deliberately NOT imported by any Vitest test — the testable logic lives in the
// pure `_shared/*` modules and is exercised with injected fakes instead.
//
// `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are
// injected automatically into every Supabase Edge Function's environment.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

/** Read a required environment variable or throw a clear startup error. */
export function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

/**
 * Service-role client — bypasses RLS. Used for catalog validation and for the
 * SECURITY DEFINER fulfillment RPC. NEVER expose this key to the browser.
 */
export function createServiceRoleClient(): SupabaseClient {
  const url = requireEnv('SUPABASE_URL')
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * User-scoped client that verifies a caller's JWT. Built with the anon key plus
 * the caller's `Authorization` header; `auth.getUser()` validates the token
 * server-side and returns the authenticated user (or an error).
 */
export function createUserClient(authHeader: string): SupabaseClient {
  const url = requireEnv('SUPABASE_URL')
  const anonKey = requireEnv('SUPABASE_ANON_KEY')
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
