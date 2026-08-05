# Slice 8 — Copy-grant rework of the pull path (spec §6.1 delta 11)

## Context
Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets,
branch `econ/08-copy-grant-rework` (off main; 0020 dice-copy inventory merged
as PR #186: `record_dice_copy_grant` service path, live-copy counts,
ever-owned `is_first_copy` latch, self-only scrap wrapper).

Read FIRST: spec docs/exec-plans/active/2026-07-22-monetization-economy-spec.md
§1.6 IN FULL (copy semantics, latch, seal-predicate impact, re-chase/steering
flags, scrap-then-refund open rule) + §6.1 delta 11; ADR-017; merged
migrations 0017 (commit engine, ownership snapshot guard), 0018 (canonical
prepare body), 0020 (copy primitives); behavioral suites
supabase/tests/0017_pull_commit_reveal.test.sql and 0020.

## Task
`supabase/migrations/0021_pull_copy_grant_rework.sql` + colocated static
`.test.ts` + updates to the behavioral suite(s). The spec wins over this
summary on any conflict.

### Required changes
1. **Commit grant rework** (CREATE OR REPLACE the 0017 commit engine): every
   sealed result grants a dice COPY via 0020's `record_dice_copy_grant`
   (idempotency keys derived from session+result, distinct prefix); a
   duplicate result ADDITIONALLY credits its sealed `duplicate_dust_amount`
   (keep the existing aggregated earned-bucket Dust append). Pull grants no
   longer write `user_entitlements` (entitlements remain the direct-purchase
   rail per ADR-017). The reveal receipt gains per-result `is_first_copy`
   (the 0020 latch signal, for the first-copy UI treatment) — replay must
   return the identical receipt.
2. **Seal predicate rework** (CREATE OR REPLACE the 0018-canonical prepare
   body, changing ONLY the ownership predicate): `is_duplicate` and the
   selected-featured-unowned selection resolve against LIVE COPY COUNT from
   `dice_copies` (unowned = zero live copies), replacing the
   `user_entitlements` exists-check. Preserve everything else byte-identical
   (the 0018 suite proves inherited-body preservation — keep that provable).
3. **Seal-invalidation guard (new hazard, must close):** a scrap that drops a
   copy count to zero while the user has a LIVE non-terminal pull session
   would invalidate that session's sealed `is_duplicate`/selection. Block it:
   extend the 0020 scrap path (CREATE OR REPLACE) with the same
   active-hold-blocks pattern 0017 uses for entitlements
   (`preserve_pull_ownership_snapshot`, 55000) — scrap rejected while any
   unexpired non-terminal session exists for the account. Mirror the existing
   guard's account-wide scope + multi-family comment.
4. **Zero-unowned-featured-target (spec-flagged undefined case):** implement
   the conservative default — when every featured id has ≥1 live copy, the
   selected-featured guarantee DOES NOT ARM (no selected target; document
   in-code citing spec §1.6). Hard-guarantee draws then resolve as epic-or-
   better per existing order.
5. **Ownership snapshot guard rework:** `preserve_pull_ownership_snapshot`
   currently watches `user_entitlements`; sealed predicates now depend on
   `dice_copies`. Move/extend the guard to dice_copies grants (service grants
   during a live hold blocked the same way) — direct-purchase entitlement
   grants during a hold may keep their existing guard; state what you chose.
6. **Behavioral suites:** update supabase/tests/0017 suite where it asserts
   dupe→Dust-only and entitlement grants (assert copies now; keep commitment
   verification + replay cardinality snapshots intact — extend them with copy
   counts); extend 0020 suite (or add supabase/tests/0021 suite) for: dupe →
   copy+Dust; non-dupe first-ever → is_first_copy true in receipt; re-pull
   after scrap-all → non-duplicate, copy granted, latch NOT re-fired; scrap
   blocked during live hold (55000) and allowed after commit/cancel; featured
   fully-owned → guarantee does not arm (assert via seal reasons/projection);
   replay receipt identical including is_first_copy.

## Boundaries
New 0021 files + behavioral suite edits ONLY (suites are tests — editable;
merged MIGRATIONS are immutable). No frontend/server/CI/harness edits. No
commits. No docker — orchestrator runs the harness and returns failures.
Run what you can: `npm test -- 0021`, `npm test -- supabase/migrations`,
`npm test -- 0018_soft_pity_ramp` (inherited-body test must still pass or be
legitimately updated to the new canonical chain — explain which).

## Report
`SLICE-8-REPORT.md`: summary, files+lines, spec-citation per design decision
(esp. items 3-5), test output, risks, provenance with EXACT model id + effort
verified from runtime config.
