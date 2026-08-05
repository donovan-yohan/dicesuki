# Slice 3 — Stars→standard_roll conversion RPC

## Context
- Same worktree/branch. Slices 1+2 present, uncommitted, reviewed ship-ready:
  0014 (roll ticket ledger: `record_roll_ticket_ledger_entry` is the sole
  ticket write path) and 0015 (banner binding; prepare RESERVES tickets —
  never debits; `append_wallet_ledger_entry` was redefined in 0015 with a
  roll_type-aware active-holds guard — 0015's version is now canonical).
- Design (spec delta #4, FREE part): players convert promotional Stars into
  `standard_roll` tickets at 160 Stars = 1 roll. The premium conversion
  (any-bucket Stars → premium_roll) is #154-gated and NOT built here.

## Task
Create `supabase/migrations/0016_stars_to_standard_roll_conversion.sql` +
colocated `0016_stars_to_standard_roll_conversion.test.ts`.

### Requirements
1. **Read first:** 0009 (wallet ledger + `append_wallet_ledger_entry`
   original), 0015 (its CANONICAL redefinition of `append_wallet_ledger_entry`
   and the active-holds guards; its `wallet_accounts`-first lock convention),
   0014 (ticket record function signature, idempotency semantics), plus the
   0014/0015 test files for style.
2. **Conversion function** (private engine + public wrapper, mirroring the
   repo's existing public/private RPC split):
   - Signature: user + `p_roll_count` (integer ≥ 1, sane upper bound — pick
     one and justify in a comment) + client idempotency key.
   - Rate: `160` Stars per roll, defined ONCE as a named constant/comment
     citing the spec ("160 Stars ≡ 1 roll; matches singlePullCost").
   - Atomically, in one transaction, taking `wallet_accounts` lock FIRST
     (same order as 0014/0015 — no new lock edges):
     a. Debit `160 × p_roll_count` promotional Stars through the canonical
        `append_wallet_ledger_entry` path (0015 version) so the
        available-balance guard (balance − active Star holds) applies. Fail
        closed on shortfall with the existing insufficient-funds convention.
     b. Credit `p_roll_count` standard_roll tickets via
        `record_roll_ticket_ledger_entry`.
   - Idempotency: replay of the same client key returns the original outcome
     without re-debiting or re-crediting either side; derive the two inner
     idempotency keys deterministically from the conversion key (distinct
     prefixes). Payload mismatch on replay fails closed (22023 convention).
   - PROMOTIONAL bucket only. No paid bucket, no premium_roll anywhere —
     add an explicit comment that premium conversion is #154-gated.
   - SECURITY DEFINER hygiene identical to 0014/0015: `search_path = ''`,
     revoke PUBLIC, public wrapper for `authenticated` restricted to self.
3. **Crash-consistency note:** both inner writes are idempotent ledger
   appends; document (comment) why replay after a mid-transaction crash is
   safe (single transaction = atomic; retry with same conversion key
   reconstructs both inner keys).
4. **Tests** (static-assertion style): rate constant 160 single-source;
   promotional-bucket-only; both inner idempotency keys derived + distinct
   prefixes; wallet_accounts lock before both writes; canonical append (not a
   bypass write to wallet tables); self-only wrapper; definer/search_path/
   revoke hygiene; roll_count bounds; no premium_roll/paid references.

## Boundaries
Only the two new 0016 files. Do not modify 0009/0011/0014/0015 or anything
else. No commits. Offline. No frontend/server.

## Verification (run, paste exact lines)
- `npm test -- 0016_stars_to_standard_roll_conversion`
- `npm test -- supabase/migrations`
- `npm test` (3 history-guard files fail `spawnSync git EPERM` sandbox-only;
  report as environmental; any other failure is yours)

## Report
`SLICE-3-REPORT.md` at worktree root: summary; files + line counts; exact
test output; deviations; blockers/risks; provenance line
`Authored by: Codex CLI 0.144.1 (codex exec), model: <model>`.
