# Slice 2 — Banner→roll-type binding (standard path)

## Context
- Same worktree/branch as slice 1: `/home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets`, branch `feat/economy-roll-tickets`.
- Slice 1 (already present, uncommitted, reviewed, tests green): migration
  `supabase/migrations/0014_roll_ticket_ledger.sql` created `roll_ticket_balances`,
  `roll_ticket_ledger_entries`, and SECURITY DEFINER
  `record_roll_ticket_ledger_entry` (sole write path, user-scoped idempotency,
  no-negative). Read it — slice 2 consumes it.
- Design (monetization economy spec, delta #3, FREE part only): banners gain a
  class and an optional bound ticket type. STANDARD banners may debit
  `standard_roll` tickets instead of promotional Stars. The PREMIUM random path
  is legally gated (#154) and is NOT implemented here — only the columns/
  constraints that will later carry it.

## Task
Create `supabase/migrations/0015_banner_roll_type_binding.sql` + colocated
`0015_banner_roll_type_binding.test.ts`.

### Requirements
1. **Read first:** `supabase/migrations/0011_earned_pull_preparation.sql` in
   FULL (it owns `pull_banner_versions`, `pull_banner_tiers`,
   `pull_banner_offers`, and the 120s `prepare_pull` hold + commit/expire
   path), plus 0014 (ticket record function signature/semantics), plus the
   0011 and 0014 test files for assertion style.
2. **Schema additions to `pull_banner_versions`:**
   - `banner_class` text NOT NULL DEFAULT 'standard', constrained to
     `('standard','premium')`.
   - `roll_type` text NULL, constrained to `('standard_roll','premium_roll')`.
   - Pairing constraint: `banner_class = 'premium'` requires
     `roll_type = 'premium_roll'`; `banner_class = 'standard'` allows
     `roll_type IS NULL` (legacy promotional-Stars funding, TODAY'S behavior)
     or `'standard_roll'`.
   - Existing rows must backfill to `('standard', NULL)` — zero behavior
     change for all current data.
3. **Prepare/commit/expire branch:** via `CREATE OR REPLACE` in 0015 (NEVER
   edit the 0011 file), extend the pull preparation path: when the banner
   version's `roll_type` is non-NULL, the hold debits **1 ticket per pull**
   (N pulls = N tickets) of that type through
   `record_roll_ticket_ledger_entry` (negative delta) instead of debiting
   promotional Stars; expiry/cancel refunds through the same function
   (positive delta) with a distinct reason code and an idempotency key derived
   from the hold so replays are safe. `roll_type IS NULL` keeps the exact
   existing Stars-debit behavior — byte-for-byte semantics, only refactored as
   little as needed to add the branch.
   - Guard: if the banner is `premium` class, the prepare path must REJECT
     (fail closed with a clear error) — the premium random path is #154-gated
     and must not be reachable even with a hand-inserted premium row.
   - Mirror 0011's error-code and validation conventions.
4. **Tests** (static-assertion style like 0014's): pairing-constraint
   enforcement, backfill/defaults, ticket-debit branch presence + per-pull
   count, refund symmetry + distinct reason + hold-derived idempotency key,
   premium-class rejection in prepare, legacy NULL path preserved (promotional
   Stars debit text still present), and that 0015 does not redefine 0014
   objects.

## Boundaries
- Touch ONLY the two new 0015 files. Do not modify 0011/0014 or any existing
  file. No frontend, no server/, no docs, no commits.
- Premium random path: columns + fail-closed guard ONLY. No premium banner
  rows, no reveal logic.
- Offline only — no network, no hosted Supabase.

## Verification (must actually run)
- `npm test -- 0015_banner_roll_type_binding` — green.
- `npm test -- supabase/migrations` — whole migration set green.
- `npm test` — full suite. Known environmental caveat: in YOUR sandbox, 3
  history-guard test files fail with `spawnSync git EPERM`; that is
  sandbox-only (verified passing outside). Report them as such if seen; any
  OTHER failure is yours to fix.
- Include `git status --porcelain` + `git diff --stat` in the report.

## Final report (REQUIRED)
Write `SLICE-2-REPORT.md` at worktree root: summary; files changed with line
counts; exact test commands + exact result lines; deviations + why; blockers/
risks; provenance line `Authored by: Codex CLI 0.144.1 (codex exec), model: <model>`.
No success claims without pasted test output.
