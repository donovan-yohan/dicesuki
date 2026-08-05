# Slice 1 — Roll-ticket item schema (`standard_roll` / `premium_roll`)

## Context
- Repository worktree: `/home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets`
- Branch: `feat/economy-roll-tickets` (off `origin/main`, head 9ffab35). Work ONLY in this worktree.
- This implements schema delta #2 from the monetization economy spec
  (`docs/exec-plans/active/2026-07-22-monetization-economy-spec.md` on the
  `draft/monetization-economy-spec` branch — NOT present in this worktree; the
  relevant content is summarized below, do not go looking for it).
- Design summary: the game is adding two pull-ticket item types. `standard_roll`
  is consumed by STANDARD banners (permanent pool, given away generously);
  `premium_roll` is consumed by PREMIUM banners (rotating/featured, scarce,
  monetization path). Conversion rate is 160 Stars = 1 roll. This slice creates
  ONLY the durable ticket ledger/balance schema — no banner binding, no
  conversion RPCs, no pull-path changes (those are later slices).

## Task
Create migration `supabase/migrations/0014_roll_ticket_ledger.sql` plus its
colocated test `supabase/migrations/0014_roll_ticket_ledger.test.ts`, giving
each user a durable per-roll-type ticket balance with the same integrity
guarantees the Stars/Dust wallet has.

### Requirements
1. **Read first, then mirror.** Read `supabase/migrations/0009_earned_economy_ledger.sql`
   in full — it is the pattern source for balances + append-only ledger +
   no-negative + SECURITY DEFINER record path + RLS. Also skim
   `0013_paid_checkout_foundation.sql` (recent conventions) and
   `0011_earned_pull_preparation.sql` (the pull path that will later consume
   these tickets — do NOT modify it). Mirror 0009's mechanisms and naming
   conventions exactly (same trigger/function/constraint style, same
   commenting style, same RLS shape), adapted to roll tickets.
2. **Schema (adapt names to repo conventions if 0009 suggests better ones):**
   - `roll_ticket_balances`: one row per (user_id, roll_type); `roll_type`
     constrained to `'standard_roll' | 'premium_roll'`; quantity integer,
     hard `>= 0` constraint.
   - `roll_ticket_ledger_entries`: append-only ledger (delta, reason,
     idempotency key with a uniqueness guarantee, created_at, FK to user);
     no UPDATE/DELETE possible (enforce the same way 0009 enforces it —
     trigger/rule/privilege, whatever 0009 does).
   - Balance maintenance identical in mechanism to how 0009 keeps
     `wallet_balances` consistent with `wallet_ledger_entries`.
   - A SECURITY DEFINER record function (mirror 0009's `record_*` naming) that
     appends a ledger entry and updates the balance atomically, rejecting
     negative results; it is the ONLY write path.
   - RLS: users can read their own rows; no direct client writes.
3. **Tests:** `0014_roll_ticket_ledger.test.ts` colocated, following the exact
   style of `0009_earned_economy_ledger.test.ts` and
   `0013_paid_checkout_foundation.test.ts` (read both first). Cover at minimum:
   roll_type domain enforcement, no-negative rejection, append-only
   enforcement, idempotency-key uniqueness, RLS presence, record-function
   existence/security-definer property — in whatever form those existing tests
   assert equivalent properties (they may be static SQL-content assertions;
   mirror that approach, do not invent a live-Postgres harness if one is not
   already the pattern).
4. If the repo has a migration index/registry file or test that enumerates
   migrations (search for references to `0013` outside its own files), update
   it the same way 0013's PR did.

## Boundaries
- Touch ONLY: the two new 0014 files + any registry/index file that 0013's
  addition also touched. Nothing else. No frontend, no server/, no docs.
- Do NOT modify existing migrations.
- Do NOT commit. Leave all changes uncommitted in the working tree.
- No secrets, no network calls to Supabase — this is offline schema + tests.
- Do not touch `SLICE-1-TASK.md` or write anything outside this worktree.

## Verification (must actually run)
- `npm test -- 0014_roll_ticket_ledger` (or the correct vitest filter syntax
  for this repo) — new tests green.
- `npm test` — full suite; baseline expectation 666 passing, 0 failing. If the
  full run is impractically slow, run at minimum the whole
  `supabase/migrations` test set and say exactly what you ran.
- `git status --porcelain` and `git diff --stat` output included in report.

## Final report (REQUIRED)
Write `SLICE-1-REPORT.md` at the worktree root containing: summary; files
changed with line counts; exact test commands run and their exact result
lines (pass/fail counts); any deviations from this packet and why; unresolved
blockers/risks; provenance line: `Authored by: Codex CLI 0.144.1 (codex exec), model: <the model you are>`.
Do not claim success unless the tests were actually run — paste their output.
