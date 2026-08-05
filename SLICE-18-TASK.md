# Slice 18 — Paid Stars bucket enablement (phase c, spec §6 delta 1, dormant)

## Context
Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/phase-c,
branch `econ/18-paid-bucket` (off main, migrations through 0026 merged).
This is the deepest #154 schema change: since 0009 the wallet has failed
closed on any `(stars, paid)` row by CONSTRUCTION. This slice widens that
boundary so the paid bucket CAN exist — while proving nothing can reach it
until the credit branch (slice 19) and the #154 gate.

Read FIRST: spec §1.2 + §6 delta 1 (the pair rule AND the ledger append
boundary must widen TOGETHER); 0009_earned_economy_ledger.sql in full (the
`wallet_balances_currency_bucket_pair` rule ~L70, `wallet_ledger_entries`
pair rule, `append_wallet_ledger_entry`/record_* SECURITY DEFINER path, and
every place the (currency, bucket) domain is validated); 0013 (bucket DOMAIN
already widened to include 'paid' — only the pair rules stayed closed);
0015/0017's canonical append_wallet_ledger_entry redefinition (the CURRENT
canonical version — your change must land on the canonical chain, not the
0009 original); 0016/0024 (paths that debit/credit stars and must remain
promotional-only); ADR-017 (#154 split).

## Task
`supabase/migrations/0027_paid_stars_bucket.sql` + colocated `.test.ts` +
behavioral `supabase/tests/0027_paid_stars_bucket.test.sql`.

1. Widen the `(stars, paid)` pair in BOTH places delta 1 names, together:
   the `wallet_balances` currency-bucket pair CHECK and the
   `wallet_ledger_entries` pair rule + any validation inside the canonical
   append path (CREATE OR REPLACE on the canonical chain; preserve every
   inherited guard byte-for-byte otherwise — the 0018-suite-style
   inherited-body proof pattern applies if feasible).
2. Spend policy unchanged: `debitPolicy promotional-before-paid` is the
   documented target (spec §1.3/draft banner) — but NO debit path may touch
   paid yet: 0016 conversion and 0024 faucets/grants are explicitly
   promotional-pinned (verify their WHERE/args and assert in the suite);
   pull-hold reservation sums count promotional only (0015) — confirm and
   document whether paid participation is deferred to activation (it is;
   comment it).
3. Gate discipline: paid credits become POSSIBLE for service_role through
   the canonical append only; there is deliberately NO caller. The suite
   proves: (a) service_role CAN append a (stars, paid) credit and the
   balance row materializes (the widened boundary works); (b) every
   EXISTING path cannot produce paid rows: conversion debits promotional
   only (attempt to convert with only paid balance fails insufficient),
   lunar claim credits promotional, pull holds ignore paid balance for
   availability, scrap/craft dust stays earned; (c) authenticated role
   cannot append paid anything (privilege probes); (d) (dust, paid) and
   other invalid pairs still rejected (the widening is EXACTLY one pair).
4. NULL-hole audit on every constraint you touch (0018/0019 discipline).
5. In-code #154 tag comments per 0013's gate idiom.

## Boundaries
Only the three new 0027 files. No edge functions, no client, no other
migrations. No commits, no docker — orchestrator runs the harness. Run:
`npm test -- 0027`, `npm test -- supabase/migrations` (paste exact lines).

## Report
`SLICE-18-REPORT.md`: summary, files+lines, the exact list of widened
validation points (file:line each), inherited-guard preservation evidence,
test output, risks, provenance (EXACT model id + effort).
