# ADR 014: Immutable earned-economy edition, wallet ledger, and reward claims

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

Migration `0010` adds the first production reward consumer without copying the
edition JSON. It normalizes one immutable reward-program version and its
passport/community item membership directly from `earned-collection@1` during
migration. Program changes therefore require a new economy edition, reward
version, and migration; runtime never reads a mutable rules document.

Use UTC Monday as the fixed seven-day period boundary. A service-role-only RPC
records immutable authoritative room-server roll completions. It takes a
server event id, payload hash, user id, and completion time, returns exact
replays, rejects mismatches, and credits only the first ten account-serialized
events in a period. Later events remain auditable without a wallet link. Local
WASM solo and browser clients have neither table DML nor RPC execution
capability, so they cannot produce earned currency.

The first New Collector Passport claim creates an immutable enrollment anchor.
Passport availability is derived from elapsed UTC-Monday periods plus immutable
claim outcomes: missed weeks accumulate, there is no streak loss, and claim 12
is terminal. Community claims become available once per four completed weeks
from that enrollment. Both claim RPCs accept only an idempotency key and derive
the signed-in non-anonymous user, time, claim index, item, and amount.

Every reward mutation locks the wallet account first. Claims choose the lowest
canonical never-granted program item. Exhausted passport/community pools append
exactly 2/50 earned Dust. Each immutable outcome has a composite foreign key to
exactly one entitlement grant or wallet-ledger row for the same
user/account/item. Direct service-role entitlement DML is revoked now that
reviewed claim and starter RPCs provide the required grant boundaries. A failed
final claim insert rolls back its entitlement or ledger append atomically.

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
- Reward status is derived, not a mutable progress row. Passport state is
  `not_enrolled`, `active`, or `complete`; Community state is `not_enrolled`,
  `waiting`, or `claimable`.
- Reward writes serialize per account. This prevents double credit/grant at the
  cost of parallel writes for one user; different users remain independent.
- Revoked entitlement rows are not recycled into another grant because catalog
  ownership is historically unique. The next never-granted item or configured
  exhausted-pool Dust is used instead.

## Proof

`scripts/test-supabase-postgres.mjs` applies every migration and every numbered
SQL/JavaScript database suite in deterministic order to a disposable,
digest-pinned PostgreSQL 17.6 container. The wallet command remains as a
compatibility wrapper. The original suites prove real RLS, least grants,
immutability including TRUNCATE, edition provenance, idempotent replay, negative
balance rejection, ledger reconciliation, and concurrent overspend safety.

The `0010` suites additionally prove exact/mismatched concurrent roll replay,
the slot-10 race never exceeding 1600 Stars, concurrent duplicate claims,
lowest-canonical selection, 12-claim catch-up/completion, 2/50-Dust all-owned
outcomes without fake entitlements, atomic rollback, cross-user RLS, direct
DML/function denial, and exact composite links.

The global `scripts/check-immutable-migration-history.js` CI gate runs before
database tests. It freezes every SQL migration at the branch merge base and
rejects edits, deletion, renumbering, duplicate prefixes, and non-contiguous
appends. Domain-specific catalog, ImageGen, and economy guards remain as deeper
semantic checks.

`scripts/validate-production-economy.test.ts` also constructs an appended,
retuned edition 0002 with its own dynamic migration marker. That fixture must
validate while any rewrite of the exact edition-0001 source remains rejected.

The pinned battle-tested-pattern catalog's MVCC entry was used only as a design
hypothesis; PostgreSQL already supplies the primitive. Its WAL entry is a
no-fit for application code because PostgreSQL transaction durability already
provides write-ahead logging. Token-bucket rate limiting is also a no-fit: it is
approximate while the weekly reward requires an exact durable count. The finite
passport uses the state-machine invariant—only enrolled active history advances
and 12 is terminal—but constraints and derived history replace a custom state
machine library. Repository Postgres concurrency tests remain authoritative.
