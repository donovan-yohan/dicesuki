# Slice 2 FIX — switch ticket funding to reservation semantics

Adversarial review of your 0015 found 1 P0 + associated risks. Root cause:
0011's Stars model RESERVES at prepare (available = balance − sum of active
`held_amount`; expiry just stops counting; nothing is ever debited until a
future commit path lands). Your 0015 instead REALLY debits tickets at prepare
(`record_roll_ticket_ledger_entry(-pull_count)`) while the only refund
(`release_roll_ticket_pull_hold`) is unwired dead code — revoked from every
role, no caller, no trigger. Consequence: the moment any `standard_roll`
banner row exists, every expired ticket hold permanently burns `pull_count`
tickets (immutable ledger, no recovery), and repeated prepare→expire cycles
burn more each cycle.

## Required changes to `supabase/migrations/0015_banner_roll_type_binding.sql`

1. **Reservation, not debit (fixes the P0 at L196).** For non-NULL `roll_type`
   banners, prepare must NOT call `record_roll_ticket_ledger_entry`. Instead
   mirror the Stars guard exactly: available tickets =
   `roll_ticket_balances.current_quantity` for (user, roll_type) − sum of
   `held_amount` across ACTIVE ticket-funded sessions of that user+roll_type
   (join `pull_banner_versions` on `roll_type` to identify ticket sessions).
   Reject when `available < pull_count`. Expiry then costs nothing, same as
   Stars. The real ticket debit happens only in the future commit/reveal path
   (not in this slice) — leave a short comment marking that seam, noting the
   committer must debit tickets there (and must NOT double-count the hold).
2. **Delete `release_roll_ticket_pull_hold` entirely** (L538 area) — dead code
   including its unreachable premium branch (L569) and its revoke (L598).
   Reservation semantics make a refund path unnecessary.
3. **Fix the missed filter (L181).** The legacy NULL-branch active-holds sum
   must EXCLUDE ticket-funded sessions, exactly like the two sibling guards
   you already patched (trigger L616, `append_wallet_ledger_entry` L742 —
   `join pull_banner_versions ... roll_type is null`). Today a ticket banner
   reusing currency 'stars'/'promotional' spuriously blocks legacy Star pulls.
4. **Ticket-branch symmetry check:** conversely, the ticket-branch available
   sum must count ONLY ticket sessions of the same roll_type (not Stars
   sessions), so the two funding pools never cross-reserve.

## Required changes to `supabase/migrations/0015_banner_roll_type_binding.test.ts`

- Drop assertions for the deleted refund helper.
- Pin the new properties: no `record_roll_ticket_ledger_entry` call anywhere
  in the prepare path (assert absence within the prepare function body);
  ticket availability computed as balance minus active same-roll_type holds;
  the NULL-branch sum excludes ticket sessions (the L137 review gap — assert
  the `roll_type is null` filter in the NULL-branch active_holds sum
  specifically, not just in balanceGuard/walletAppend); premium fail-closed
  unchanged; legacy path byte-equivalence properties unchanged.
- Keep the existing static-assertion style. Do NOT build a live-Postgres
  harness (out of scope; noted separately as a repo-wide gap).

## Boundaries
Only the two 0015 files. No changes to 0011/0014 files or anything else. No
commits. Offline.

## Verification (run, paste exact result lines)
- `npm test -- 0015_banner_roll_type_binding`
- `npm test -- supabase/migrations`
- `npm test` (3 history-guard files fail `spawnSync git EPERM` in your
  sandbox only — report-as-environmental rule from SLICE-2-TASK.md stands)

## Report
Overwrite `SLICE-2-REPORT.md`: mark it "rev 2 (post-review fix)", keep the old
content under a "rev 1" heading, document what changed and why, pasted test
output, provenance line.
