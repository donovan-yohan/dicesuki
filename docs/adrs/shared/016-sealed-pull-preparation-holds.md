# ADR 016: Append-only sealed pull preparation and promotional-Star holds

**Status:** Accepted

## Context

The earned economy now has immutable wallet history, starter entitlements, and
authoritative reward claims, but it did not have a safe boundary for preparing
a collectible pull. A preparation request must reserve enough promotional
Stars and choose an authoritative outcome without spending currency, granting
an entitlement, revealing the result, or advancing durable guarantee state.
Client physics and presentation must never influence that choice.

Catalog snapshots and production economy editions are append-only. Copying a
future edition into a mutable JSON blob or rewriting an old snapshot would
invalidate historical odds and force large corrective migrations. A prepared
result therefore needs to bind one normalized immutable banner version and
remain exactly replayable even after its hold expires.

Preparation also introduces concurrency and disclosure hazards. Two requests
cannot both reserve the same available balance, an idempotency key cannot be
reused for different input, and neither table reads nor an RPC response may
leak the sealed item or projected guarantee state before a later reveal step.

## Decision

Migration `0011` appends normalized immutable configuration for
`earned-collection-001@1`: its source edition and SHA-256, banner family,
count/price offers, tier weights, item membership, guarantee thresholds and
precedence, and exact duplicate-to-Dust values. New editions, prices, supported
counts, and policy changes append new version/offer rows; they do not update
old catalog snapshots, reuse edition-specific schema constraints, or rewrite
configuration rows.
The 120-second `pull-hold@1` TTL is a new versioned policy introduced by this
migration, not a rule inferred from the earned-economy edition.

Authenticated non-anonymous callers invoke `prepare_pull` with a banner
version, pull count, and idempotency key. One account-first transaction:

- returns an exact existing request before considering expiry, while rejecting
  a key reused with different input;
- captures one wall-clock decision time only after the account lock and exact
  replay check, so a statement that waited cannot classify a later lock
  winner with its stale statement-start timestamp;
- permits at most one live hold per account and banner family;
- ensures starter entitlements before taking the ownership snapshot;
- computes availability as wallet balance minus every live pull hold;
- snapshots guarantee counters without creating or advancing durable state;
- derives normal weighted tier/item choices and every nonce from a fresh
  32-byte CSPRNG seed using domain-separated HMAC-SHA-256 words and uint32
  rejection sampling, while a due selected guarantee deterministically awards
  the frozen lowest-canonical-id unowned selected item;
- applies guarantee precedence as selected, epic, rare, then base odds;
- seals exactly the requested number of result rows and one root commitment;
  and
- returns only a result-free receipt containing identifiers, hold timing and
  amount, and the commitment/RNG scheme names.

Starter entitlements are an account prerequisite, not pull outcomes. During a
live hold, direct balance changes that would consume reserved Stars and new
entitlement grants that would invalidate the ownership snapshot fail closed.
Entitlement writers acquire the same account lock before checking holds, so a
grant and preparation cannot commit across one another's ownership snapshot.
Expired holds cease reducing availability, but their original request remains
stable for exact replay. Authenticated clients receive no direct read access to
session seeds, guarantee projections, or sealed results; service-role reads
exist only for audit and the future trusted continuation.

The lock-sensitive functions are deliberately `VOLATILE` under Read Committed.
Each post-lock SQL command therefore receives visibility after the preceding
lock holder commits, and `clock_timestamp()` supplies the current decision
boundary. The public wrapper cannot inject time. A revoked private override may
stamp an already-expired preparation only for the disposable SQL test.

The sealed commitment binds the selected item, tier, guarantee reason and
counters, duplicate decision and Dust projection, and a per-result nonce. The
root binds the ordered result commitments. Runtime SQL proof independently
replays the HMAC stream through the frozen weights and membership before
recomputing every commitment. This makes accidental or API-level outcome
rewrites detectable. It does not claim protection from a database owner who
can inspect or repeatedly choose seeds.

Preparation deliberately does **not** debit Stars, grant a pull entitlement,
reveal an item, update a guarantee counter, implement payment, or add UI. A
future commit/reveal migration must append an explicit terminal transition,
atomically consume or release the hold, debit and grant from the sealed rows,
advance guarantee state, and narrowly adapt the hold guards for that trusted
transaction. It must not mutate migration `0011` or its frozen configuration.

## Consequences

- A 160-Star balance cannot back two concurrent 160-Star preparations; an
  exact concurrent retry converges on one session.
- Expiry restores spendable availability without deleting history or changing
  an idempotent receipt.
- The normalized banner version prevents future catalog additions from
  leaking into old odds and avoids giant snapshot-rewrite migrations.
- Normalized offers let a later banner version append a new pull count or price
  while each session's count and held amount remain protected by a composite
  foreign key.
- Ownership, duplicate conversion, guarantee ordering, and weighted selection
  are frozen and auditable at preparation time. Any newly awarded
  selected-featured item resets selected pity; a duplicate featured result
  does not.
- Product delivery remains incomplete until a separately reviewed commit and
  reveal boundary consumes the sealed preparation.

## Proof

Static migration tests lock the append-only schema, privilege boundary,
versioned configuration, safe receipt, seed derivation, and absence of any
prepare-time debit, grant, reveal, or guarantee mutation. The real-Postgres
suite proves configuration cardinality, forced RLS, authorization, replay and
mismatch behavior, hold accounting and expiry, guarantees, exact weighted RNG
replay, commitments, duplicate/Dust projection, injected rollback, and
immutability. The Node race harness uses controlled row-lock gates to force an
older statement to resume after a later preparation commits, proving fresh
prepare, debit, and entitlement decisions without scheduling guesses. It also
proves one shared session for an exact-key race.

The focused commands are:

```text
npm test -- --run supabase/migrations/0011_earned_pull_preparation.test.ts
npm run test:db:supabase
npm run check:immutable-migration-history -- origin/main
```
