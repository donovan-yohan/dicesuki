import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase client bootstrap with graceful degradation (issue #81, ADR 006).
 *
 * The app MUST run identically to guest-only mode when Supabase is not
 * configured: no client is created, every auth code path becomes a no-op, and
 * nothing is logged. Configuration is feature-detected via
 * {@link isSupabaseConfigured} rather than assumed, so a fresh checkout with no
 * `.env.local` never crashes and never spams the console.
 *
 * The anon key is public-safe (protected by Row-Level Security), so it may live
 * in client env configuration. The service-role key / JWT secret MUST NOT.
 */

type SupabasePublicEnvKey =
  | 'VITE_SUPABASE_URL'
  | 'VITE_SUPABASE_PUBLISHABLE_KEY'
  | 'VITE_SUPABASE_ANON_KEY'

function readEnv(key: SupabasePublicEnvKey): string | undefined {
  try {
    const value = import.meta.env?.[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  } catch {
    return undefined
  }
}

/** The configured Supabase URL, or `undefined` when unset. */
export function getSupabaseUrl(): string | undefined {
  return readEnv('VITE_SUPABASE_URL')
}

/** The configured public API key, preferring the current publishable-key format. */
export function getSupabasePublishableKey(): string | undefined {
  return readEnv('VITE_SUPABASE_PUBLISHABLE_KEY') ?? readEnv('VITE_SUPABASE_ANON_KEY')
}

/**
 * True only when BOTH the Supabase URL and anon key are present. All auth /
 * profile features gate on this; when false the app stays in guest mode.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabasePublishableKey())
}

let cachedClient: SupabaseClient | null = null

/**
 * Return the memoized Supabase client, or `null` when Supabase is not
 * configured. Callers MUST treat `null` as "guest mode" and degrade gracefully.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient

  const url = getSupabaseUrl()
  const publishableKey = getSupabasePublishableKey()
  if (!url || !publishableKey) return null

  cachedClient = createClient(url, publishableKey, {
    auth: {
      // supabase-js owns token storage/refresh; we never duplicate it.
      persistSession: true,
      autoRefreshToken: true,
      // Complete the OAuth redirect by parsing the callback URL hash.
      detectSessionInUrl: true,
    },
  })
  return cachedClient
}

/** Test-only: drop the memoized client so env changes take effect. */
export function resetSupabaseClientForTests(): void {
  cachedClient = null
}
