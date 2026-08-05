# Slice 4 — Pull commit/reveal terminal boundary

## Context
Same worktree/branch. Slices 1–3 present (0014 ticket ledger, 0015 banner
binding + reservation semantics, 0016 Stars→standard_roll conversion), all
reviewed ship-ready, uncommitted. FULL suite green (1042).

Structural facts (verified by read-only investigation — trust these, then
confirm as you read):
- `prepare_pull_for_user` (0011:924-1090, canonically redefined in 0015)
  already resolves EVERYTHING at prepare: seeded tier+item draws
  (`gen_random_bytes(32)` seed, HMAC-SHA256 `pull_seeded_uint32_below`,
  0011:553-607), hard-pity due-checks (0011:944-962), duplicate detection +
  Dust amounts (0011:1016-1026), sealed immutably into `sealed_pull_results`
  (0011:253-294) with per-result nonce+commitment and a session
  `commitment_root` (scheme 'sha256-result-v1+sha256-root-v1', 0011:204,234).
- Pity advancement is DEFERRED: `pull_guarantee_states` (0011:152-170) is
  read-only at prepare; projected values live on `pull_sessions`
  (`*_misses_projected`, 0011:112-116,1138-1143) and per-result
  `*_misses_before/after`.
- `pull_sessions` has NO status/terminal column (append-only, immutability
  triggers); holds self-expire via time-window (`prepared_at <= now <
  expires_at`, 0011:902-903). Funding is RESERVED, never debited: Stars via
  active-hold sums, tickets likewise (0015).
- No reveal path exists: `sealed_pull_results` has no client SELECT
  (0011:305-306); no edge function; 0011:4-9 header defers debit/grant/
  reveal/advancement. 0015:224-225 marks the commit seam.
- KNOWN CONSTRAINT (from 0015 review): both balance backstop triggers
  (wallet ~0015 L593-area and roll_ticket ~0015 L555-area) and every
  active-hold sum count a session's own hold with no terminal notion. A naive
  commit-time debit of a still-live session will be REJECTED by these guards.
  This slice must introduce the terminal transition and rewrite ALL
  active-hold queries (both pools, prepare sums AND backstop triggers) to
  exclude terminally-transitioned sessions.

## Task
Create `supabase/migrations/0017_pull_commit_reveal.sql` + colocated
`0017_pull_commit_reveal.test.ts`.

### Requirements
1. **Terminal transition, append-only idiom.** New table
   `pull_session_transitions`: session_id (FK, UNIQUE — at most one terminal
   transition per session), kind in ('committed','cancelled'), created_at,
   plus whatever provenance the repo idiom wants. Append-only with the same
   reject-mutation trigger pattern as 0014. RLS: owner may SELECT own rows.
2. **Rewrite ALL active-hold queries** via CREATE OR REPLACE of the 0015
   canonical bodies: the three Stars sums (prepare NULL-branch,
   `preserve_active_pull_holds`, `append_wallet_ledger_entry`), the ticket
   sum in prepare, and the roll_ticket backstop trigger — each excludes
   sessions having a row in `pull_session_transitions`. Semantics: a hold
   reserves only while (in time window) AND (no terminal transition).
3. **`commit_pull_session` (private engine + public self-only wrapper):**
   on the caller's own, unexpired, non-terminal session, atomically
   (wallet_accounts lock FIRST, same order as 0014/0015/0016):
   a. Fail closed if the session's banner is premium class (#154; defense in
      depth even though prepare already rejects).
   b. Insert the 'committed' transition (the UNIQUE constraint is the
      exactly-once guard; on conflict → replay path: return the original
      receipt, no re-execution of any effect).
   c. Debit the funding for real: NULL roll_type → promotional Stars debit of
      `held_amount` via canonical `append_wallet_ledger_entry`;
      `standard_roll` → ticket debit via `record_roll_ticket_ledger_entry`.
      Idempotency keys derived from session id, distinct prefixes, same
      conventions as 0016. Because the transition row is inserted in the same
      transaction BEFORE the debit, the rewritten guards no longer count the
      session's own hold — document this ordering in a comment.
   d. Advance `pull_guarantee_states` to the session's projected values
      (create row if absent; exactly-once by virtue of (b)).
   e. Grant results: for each sealed result, non-duplicate → grant the die
      via the SAME entitlement/inventory convention the repo already uses
      (read how `fulfill_payment_order` in 0013 grants entitlements and how
      inventory rows are keyed; mirror it, don't invent a parallel scheme);
      duplicate → credit `duplicate_dust_amount` Dust to the earned bucket
      via canonical append (one idempotent entry per session, summed, or per
      result — pick what the ledger conventions favor and justify).
   f. Return the reveal payload: sealed results (item, tier, reasons, dupe
      info) + per-result nonces + `rng_seed` + commitment fields so a client
      can verify the sha256 commitments. Seed reveals ONLY here.
4. **`cancel_pull_session`:** owner cancels a live session → 'cancelled'
   transition only (reservation model: nothing to refund). Cancelled/expired
   sessions NEVER reveal seed or results. Idempotent like commit; committed
   and cancelled are mutually exclusive via the UNIQUE constraint.
5. **Reveal-read path:** owner may re-fetch the reveal payload of their own
   COMMITTED sessions (replay of commit returns it; if you also add a
   read-only getter, owner-scoped, committed-only).
6. Hygiene: SECURITY DEFINER + `search_path=''` + revoke/grant discipline
   identical to 0014-0016. Error-code conventions of the file family.
7. **Tests** (static style): transition table append-only + UNIQUE;
   EVERY active-hold sum and BOTH backstop triggers carry the
   terminal-exclusion (count exact occurrences); transition-insert precedes
   debit in the commit body; both funding branches debit through canonical
   functions (no direct DML); guarantee advancement uses projected values;
   premium fail-closed; owner-only wrappers; seed revealed only in commit/
   committed-getter path; cancel writes no ledger entries; idempotency-key
   prefixes distinct from 0015/0016's.

## Boundaries
Only the two new 0017 files. No edits to 0009-0016 files, no frontend, no
server/, no edge functions, no commits, offline.

## Verification (run, paste exact lines)
- `npm test -- 0017_pull_commit_reveal`
- `npm test -- supabase/migrations`
- `npm test` (3 history-guard files fail `spawnSync git EPERM` sandbox-only —
  environmental; anything else is yours)

## Report
`SLICE-4-REPORT.md`: summary; files + line counts; exact test output;
deviations; blockers/risks; provenance
`Authored by: Codex CLI 0.144.1 (codex exec), model: <model>`.
