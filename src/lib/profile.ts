import type { SupabaseClient, User } from '@supabase/supabase-js'
import { DEFAULT_PLAYER_COLOR } from '../store/usePlayerIdentityStore'

/**
 * Profile model + first-sign-in seeding (issue #81, ADR 006).
 *
 * A profile is durable, cross-device identity: display name, avatar, and a
 * default dice color. On first Discord sign-in we seed a `profiles` row from
 * the Discord identity; on later sign-ins we return the existing row so the
 * player's own edits are preserved.
 */

/** Client-side profile shape (camelCase), mapped from the `profiles` row. */
export interface Profile {
  id: string
  displayName: string
  avatarUrl: string | null
  color: string
}

/** Raw `profiles` row shape (snake_case) as returned by Supabase. */
interface ProfileRow {
  id: string
  display_name: string | null
  avatar_url: string | null
  color: string | null
}

function mapRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: (row.display_name ?? '').trim() || 'Player',
    avatarUrl: row.avatar_url ?? null,
    color: row.color ?? DEFAULT_PLAYER_COLOR,
  }
}

/**
 * Derive seed profile fields from a Supabase (Discord) user. Discord populates
 * `user_metadata` with some combination of `full_name` / `name` / `user_name`
 * and `avatar_url` / `picture`; we take the first non-empty of each.
 */
export function deriveProfileSeed(user: User): { displayName: string; avatarUrl: string | null } {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = meta[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return null
  }
  return {
    displayName: pick('full_name', 'name', 'user_name', 'preferred_username') ?? 'Player',
    avatarUrl: pick('avatar_url', 'picture'),
  }
}

/**
 * Fetch the player's profile, creating it from the Discord identity on first
 * sign-in. Existing rows are returned unchanged so user edits survive.
 *
 * Returns `null` if the lookup and insert both fail (e.g. transient network or
 * RLS misconfig) — callers keep the player signed in with a fallback identity
 * rather than blocking sign-in on a profile write.
 */
export async function fetchOrCreateProfile(
  client: SupabaseClient,
  user: User,
): Promise<Profile | null> {
  // 1. Existing row wins — preserve the player's own customizations.
  const { data: existing, error: selectError } = await client
    .from('profiles')
    .select('id, display_name, avatar_url, color')
    .eq('id', user.id)
    .maybeSingle()

  if (existing && !selectError) {
    return mapRow(existing as ProfileRow)
  }

  // 2. First sign-in — seed from Discord.
  const seed = deriveProfileSeed(user)
  const insertRow = {
    id: user.id,
    display_name: seed.displayName,
    avatar_url: seed.avatarUrl,
    color: DEFAULT_PLAYER_COLOR,
  }

  const { data: inserted, error: insertError } = await client
    .from('profiles')
    .upsert(insertRow, { onConflict: 'id' })
    .select('id, display_name, avatar_url, color')
    .maybeSingle()

  if (inserted && !insertError) {
    return mapRow(inserted as ProfileRow)
  }

  // 3. Both paths failed — fall back to the in-memory seed so the UI still
  //    has a name/avatar to show. No throw: sign-in stays successful.
  if (selectError || insertError) {
    return {
      id: user.id,
      displayName: seed.displayName,
      avatarUrl: seed.avatarUrl,
      color: DEFAULT_PLAYER_COLOR,
    }
  }

  return null
}
