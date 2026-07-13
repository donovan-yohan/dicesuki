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

## Owner setup

See the checklist on issue #81 / the PR body. Summary: create a Discord app
(redirect `https://htsgornelumjyjwknwby.supabase.co/auth/v1/callback`), enable
the Discord provider in Supabase Auth, apply `0001_profiles.sql`, and set the
two `VITE_SUPABASE_*` values in `.env.local` and Vercel.
