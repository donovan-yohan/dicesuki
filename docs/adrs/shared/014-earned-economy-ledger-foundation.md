# ADR 014: Immutable earned-economy edition and wallet ledger

**Status:** Accepted

## Context

The simulation study in ADR 013 selected a collection-first economy, but its
inputs are intentionally forbidden in production runtime code. Issue #148 also
needs a nonnegative, retry-safe earned-currency balance before claims and pull
state can be implemented. A client-owned balance or mutable configuration would
make later tuning rewrite history and would let concurrent rewards or debits
lose updates.

## Decision

Copy the selected values into a distinct, contiguous, append-only production
edition under `economy/production/editions/`. Anchor each edition to the
migration that publishes the exact JSON and source SHA-256. Merge-base history
guards freeze both files after publication. Production validation is an
independent implementation and never imports the simulator. Validation first
dispatches on `schemaVersion` for shared structural and safety invariants, then
applies edition-specific locks. Edition 0001 has an exact Candidate B source
hash; a later schema-v1 edition may tune rates and cadence only by appending its
own numbered source and migration block. A new schema shape requires a new
explicit validator rather than silently inheriting old semantics.

Represent each auth user with one immutable `wallet_accounts` row. Materialize
current balances by currency/bucket for efficient reads, and record every
nonzero delta in `wallet_ledger_entries` with before/after balances, reason,
idempotency key, production edition, and bounded provenance. The ledger and
balance update occur in one Postgres transaction.

Expose one `SECURITY DEFINER` append function to `service_role` only. Revoke its
default PUBLIC execution and all direct wallet DML from API roles, including
`service_role`. The function locks the stable account row before checking the
account-scoped idempotency key or balance. That single ordering point serializes
cross-bucket appends, makes exact retries return the original entry, makes
mismatched retries fail closed, and prevents concurrent overspend. PostgreSQL's
own MVCC, row locks, transaction WAL, constraints, and unique indexes are the
platform primitives; Dicesuki does not implement a custom WAL or lock manager.

Force RLS on every table. Production editions are public-readable.
Authenticated users can read only their own account, balances, and entries;
they cannot mutate any wallet row. The current phase supports promotional
Stars and earned Dust only. It creates no paid bucket or money-credit path.

Use `ON DELETE RESTRICT` between `auth.users` and wallet accounts. An auth-user
cascade must never silently erase currency history. A future erasure policy
requires an explicit reviewed tombstone or anonymization design.

## Consequences

- A rate or cadence change is visible as a new source edition and migration.
- Exact idempotent retries are safe, while reusing a key for another payload is
  an error rather than an ambiguous second mutation.
- All writes for one wallet serialize on its account row. That is a deliberate
  hobby-scale correctness trade-off; independent users still proceed in
  parallel.
- Balance reads are constant-time, while the immutable ledger remains available
  for reconciliation and audit.
- Deleting an auth user with wallet history is blocked until a deliberate data
  retention/erasure workflow exists.
- Currency entries are not collectible acquisition truth. Future paid refunds
  and chargebacks need source-specific entitlement-grant/reversal history so an
  independent starter or earned grant is never revoked accidentally.

## Proof

`scripts/test-wallet-ledger-postgres.mjs` applies all migrations to a disposable,
digest-pinned PostgreSQL 17.6 container. The SQL harness proves real RLS, least grants,
immutability including TRUNCATE, edition provenance, idempotent replay, negative
balance rejection, and ledger/snapshot reconciliation. Two-session races prove
one-row replay under concurrent retries and exactly one successful debit when
two debits would jointly overspend.

`scripts/validate-production-economy.test.ts` also constructs an appended,
retuned edition 0002 with its own dynamic migration marker. That fixture must
validate while any rewrite of the exact edition-0001 source remains rejected.

The pinned battle-tested-pattern catalog's MVCC entry was used only as a design
hypothesis; PostgreSQL already supplies the primitive. Its WAL entry is a
no-fit for application code because PostgreSQL transaction durability already
provides write-ahead logging. The repository concurrency test remains the
authoritative invariant proof.
