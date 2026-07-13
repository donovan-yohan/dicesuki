# Auth & Profiles (Supabase + Discord OAuth)

Implements issue #81 per ADR 006 (Supabase Hybrid Backend). Supabase owns
identity and durable profile data; the app degrades to guest mode when Supabase
is not configured.

## Pieces

| File | Role |
|------|------|
| `src/lib/supabaseClient.ts` | Client bootstrap + `isSupabaseConfigured()` feature-detect. Returns `null` when unconfigured. |
| `src/lib/profile.ts` | `Profile` type, `deriveProfileSeed`, `fetchOrCreateProfile` (first-sign-in seeding). |
| `src/store/useAuthStore.ts` | Auth domain store (Frontend-ADR-002): session/profile state, `initialize`, `signInWithDiscord`, `signOut`. Not persisted — supabase-js manages tokens. |
| `src/components/panels/AccountSection.tsx` | Settings UI: Discord sign-in button / signed-in card. Renders `null` when unconfigured. |
| `supabase/migrations/0001_profiles.sql` | `profiles` table + RLS. |
| `src/App.tsx` | Calls `useAuthStore.getState().initialize()` once at startup. |

## Graceful degradation (guest mode)

With no `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`:
- `isSupabaseConfigured()` is `false`, `getSupabaseClient()` returns `null`.
- The auth store starts and stays in `guest` status; all actions are no-ops.
- `AccountSection` renders nothing, so Settings looks exactly as before.
- No network calls, no console output. The build passes without any env set.

## Profile → identity precedence

A signed-in profile feeds the multiplayer join identity
(`usePlayerIdentityStore`, #77/#78). On sign-in the store pushes the profile's
`displayName` + `color` into the identity store via `setIdentity`, seeding /
overriding the remembered guest identity. The join form's own precedence still
applies on top, so the effective order is:

1. Explicit `?name=` deep-link query param (highest — honors link intent)
2. Solo-room default (`Solo Player`)
3. **Signed-in profile** (seeded into the identity store on sign-in)
4. Remembered guest identity (last-used name/color)
5. `DEFAULT_PLAYER_COLOR` fallback

Because the profile is seeded *into* the identity store, it naturally becomes
"the remembered identity" while signed in — no special-casing in the join form.
Existing profile rows are never overwritten from Discord on later sign-ins, so a
player's own edits to their profile survive.

## Data sync (inventory, saved rolls, settings) — issue #82

Durable user data syncs per-account on top of the local Zustand stores, which
remain the single source of truth for the running app. Guest / offline /
Supabase-unconfigured behavior is byte-identical to before: every sync path is
gated behind `isSupabaseConfigured()` + an authenticated session.

| File | Role |
|------|------|
| `src/lib/dataSync.ts` | Sync engine: per-domain hydrate on sign-in, debounced push on change, first-sign-in migration, LWW conflict resolution. `initDataSync()` wires it to `useAuthStore`. |
| `src/store/useSettingsStore.ts` | Durable settings domain store (currently `themeId`). Split out of `useUIStore` (ADR-002) so settings can sync independently of device-ergonomic prefs. |
| `supabase/migrations/0002_user_data.sql` | `inventory`, `saved_rolls`, `settings` tables (one JSONB blob per user), own-row RLS. |

### What syncs (inclusion list)

- **Inventory** (`useInventoryStore`): `dice`, `currency`, `assignments` (the persisted `partialize` shape).
- **Saved rolls** (`useSavedRollsStore`): `savedRolls` (the editing draft `currentlyEditing` is ephemeral, not synced).
- **Settings** (`useSettingsStore`): `themeId` (selected theme).

**Not synced** (device-local / ephemeral, by design): custom-dice binary models
(IndexedDB blobs — metadata syncs, the model file stays device-local), haptic /
motion / UI-visibility prefs (`useUIStore`, device-ergonomic), owned themes
(`dicesuki-owned-themes` — a dev grants-all placeholder), and live connection
state.

### How it works

- **Storage shape:** one JSONB blob per user per domain, keyed by `user_id`.
  This mirrors how each store already serializes to one versioned localStorage
  blob; the client's `version`/`migrate` logic (ADR-002) stays authoritative and
  the server never needs to query individual dice/rolls. See the migration
  header for the full rationale.
- **Hydrate on sign-in:** each domain is fetched; the remote row is applied
  locally when it is newer-or-equal to this device's last sync.
- **Push on change:** local store changes are pushed back, debounced ~1s,
  deduped by payload equality (so transient fields never trigger a write).
- **Conflict policy — last-write-wins by `updated_at`:** every sync timestamp is
  server-sourced (`dicesuki-sync-meta` in localStorage tracks the last-synced
  time per domain), so cross-device comparisons are consistent. A device with
  newer offline edits pushes up; otherwise it pulls.
- **First sign-in migration (`localStorage` → account):** when no remote row
  exists, the existing local data is pushed up. Idempotent — it upserts on
  `user_id`, and any later run simply re-applies the now-present remote row, so
  there is no loss or duplication.

## Owner setup

See the checklist on issue #81 / the PR body. Summary: create a Discord app
(redirect `https://htsgornelumjyjwknwby.supabase.co/auth/v1/callback`), enable
the Discord provider in Supabase Auth, apply `0001_profiles.sql`, and set the
two `VITE_SUPABASE_*` values in `.env.local` and Vercel.

**Issue #82 adds one setup step:** after `0001_profiles.sql`, apply
`supabase/migrations/0002_user_data.sql` (`supabase db push`, or paste into the
Supabase SQL editor) to create the `inventory` / `saved_rolls` / `settings`
tables with own-row RLS. No new env vars — sync reuses the existing
`VITE_SUPABASE_*` config and degrades to guest mode when unset.
