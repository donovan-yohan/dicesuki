import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Per-user economy access flag (the monetization gate).
 *
 * Dicesuki ships as a utility-first tabletop dice roller: basic dice, saved
 * rolls, history, multiplayer, themes, favorites, and Discord sign-in with
 * cross-device sync, with ZERO economy chrome. Every shop / wallet / banner /
 * pass surface is hidden until an operator explicitly flags the account on
 * (`scripts/admin/dicesuki-admin.mjs set-economy-access`).
 *
 * Storage: `public.user_economy_access`
 * (`supabase/migrations/0034_economy_access_flag.sql`). It is deliberately NOT
 * a column on `profiles` — `profiles` grants table-wide `update` to
 * `authenticated` and is not `force row level security`, so a flag there would
 * be self-writable and a player could flag themselves on. The dedicated table
 * is own-row SELECT for `authenticated` with no DML grant to any API role.
 *
 * Enforcement is UI-only by design (PO decision, 2026-08-10): the economy RPCs
 * stay auth-gated exactly as they were, and the weekly roll-completion Star
 * rewards keep accruing server-side for un-flagged players. The wallet is
 * simply invisible until the flag is on.
 *
 * This module is fail-CLOSED: any error, any missing row, any unconfigured
 * Supabase project resolves to "no access". A transient network failure must
 * never leak the storefront to a player who is not supposed to see it.
 */

/** Client-side economy-access shape (camelCase), mapped from the row. */
export interface EconomyAccess {
  /** True only when the operator has explicitly enabled this account. */
  enabled: boolean
  /**
   * When the flag was FIRST enabled, or null if it never has been. Set once by
   * the admin RPC and never moved, because it is the New Collector Passport's
   * 12-week anchor (`private.passport_enrollment_anchor_period`).
   */
  grantedAt: string | null
}

/** The default for guests, signed-out users, unconfigured projects, and errors. */
export const NO_ECONOMY_ACCESS: EconomyAccess = Object.freeze({
  enabled: false,
  grantedAt: null,
})

/** Raw `user_economy_access` row shape (snake_case) as returned by Supabase. */
interface EconomyAccessRow {
  economy_access: boolean | null
  economy_access_granted_at: string | null
}

/**
 * Read the signed-in player's economy access flag.
 *
 * Absent row === off: the table is written only by the admin RPC, so a player
 * who has never been flagged has no row at all. That is the overwhelmingly
 * common case and is not an error.
 */
export async function fetchEconomyAccess(
  client: SupabaseClient,
  userId: string,
): Promise<EconomyAccess> {
  try {
    const { data, error } = await client
      .from('user_economy_access')
      .select('economy_access, economy_access_granted_at')
      .eq('user_id', userId)
      .maybeSingle()

    if (error || !data) return NO_ECONOMY_ACCESS

    const row = data as EconomyAccessRow
    return {
      enabled: row.economy_access === true,
      grantedAt: row.economy_access_granted_at ?? null,
    }
  } catch {
    // Fail closed. Never surface economy chrome because a fetch threw.
    return NO_ECONOMY_ACCESS
  }
}
