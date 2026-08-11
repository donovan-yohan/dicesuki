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
 * This module is fail-CLOSED on a FIRST read: a missing row, an unconfigured
 * project, or a failed read all yield `enabled: false`, so a transient network
 * failure can never leak the storefront to a player who should not see it.
 *
 * A failed read is reported as `resolved: false` so callers can tell "the
 * database says off" from "we could not ask". Only the former is an answer.
 * See `useAuthStore.initialize` for why that matters on re-reads.
 */

/** Client-side economy-access shape (camelCase), mapped from the row. */
export interface EconomyAccess {
  /**
   * False whenever `resolved` is false — never read `enabled` as an answer
   * unless the read actually reached the database.
   */
  enabled: boolean
  /**
   * True when the database answered — including the common "no row, therefore
   * off" answer. False only when the read FAILED (PostgREST error, throw,
   * offline). The distinction matters on re-reads: `onAuthStateChange` fires on
   * every hourly token refresh, and treating a network blip as an authoritative
   * "off" would yank the storefront out from under a flagged player mid-session
   * (and hide the pending-purchase banner from someone who just paid).
   */
  resolved: boolean
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
  resolved: true,
  grantedAt: null,
})

/** The read failed. Callers keep whatever they already knew for this user. */
export const UNKNOWN_ECONOMY_ACCESS: EconomyAccess = Object.freeze({
  enabled: false,
  resolved: false,
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

    if (error) return UNKNOWN_ECONOMY_ACCESS
    // No row is a real answer, not a failure: the table is written only by the
    // admin RPC, so a player who was never flagged simply has no row.
    if (!data) return NO_ECONOMY_ACCESS

    const row = data as EconomyAccessRow
    return {
      enabled: row.economy_access === true,
      resolved: true,
      grantedAt: row.economy_access_granted_at ?? null,
    }
  } catch {
    return UNKNOWN_ECONOMY_ACCESS
  }
}
