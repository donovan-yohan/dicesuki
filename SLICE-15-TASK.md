# Slice 15 — Pity-read surface (micro-slice, [free])

Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets,
branch `econ/15-pity-read` (off main, through 0024 + client slices).

Purpose: the pull-screen pity meter needs SERVER-owned pity state
(client-accumulated pity is a fairness-dispute vector — DESIGN-PULL-SCREEN.md
§12). `public.pull_guarantee_states` (0011:152-170: account_id,
banner_family_id, total_pulls, rare_misses, epic_misses, selected_misses) is
service-role-only (0011:1587); account_id indirects through wallet_accounts.

## Task
`supabase/migrations/0025_pity_read.sql` + colocated `.test.ts` + behavioral
`supabase/tests/0025_pity_read.test.sql` + a small client reader.

1. RPC `get_my_pull_pity(p_banner_family_id text)` — authenticated self-only
   wrapper + private engine (family hygiene: definer, search_path='',
   revoke/grant discipline): resolves the caller's wallet account, returns
   the guarantee counters for that banner family PLUS the banner's
   thresholds (rare/epic/selected hard guarantee pulls and, when set, the
   0018 soft-pity columns) joined from the ACTIVE pull_banner_versions row
   of that family — one round trip for the whole meter. No row → zeros with
   thresholds (never an error for a valid family; unknown family fails
   closed 22023). Read-only (stable), no locks.
2. Client: src/lib/pullPity.ts reader (typed, injected client, strict
   validator, typed errors per house pattern) + colocated test. NO store, NO
   UI (the pull screen consumes it later).
3. Behavioral suite: zero-state (no pulls yet) returns zeros+thresholds;
   after seeded prepare/commit lifecycle the counters reflect the projection
   (reuse 0017/0021 suite seeding idioms); cross-user isolation (A cannot
   read B's counters — self-only, no user param); unknown family 22023;
   anon rejected; soft-pity columns surface when configured, null when not.

Boundaries: the three new files + src/lib/pullPity.ts (+test). Nothing else.
No commits, no docker. Run: `npm test -- 0025`, `npm test -- pullPity`,
`npm test -- supabase/migrations`, `npm run build` (paste exact lines).
Report: SLICE-15-REPORT.md, provenance with exact model id + effort.
