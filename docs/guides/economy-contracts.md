# Versioned Economy Contracts

Issue #147 starts with reproducible simulation inputs rather than a live wallet
or randomized reward path. Each contract edition freezes one hypothesis and its
canonical catalog pool. Its generated disclosure contains exact rational
probabilities, display-only rounded percentages, guarantee rules, cadence, and
duplicate conversion inputs for the future simulator.

## Version 1 hypothesis

`broad-rarity-showcase@1` is explicitly `simulation-only` and encodes:

- 160 Stars per pull and 1600 per ten-pull, with separate paid and promotional
  balance classes and promotional-first modeling semantics;
- integer rarity weights of 50 common, 28 uncommon, 14 rare, 5 epic, and 3
  legendary out of a fixed scale of 100;
- a rare-or-better result on the tenth pull when a purchased ten-pull batch
  misses, plus a player-selected featured item by pull 30;
- singles neither advance nor satisfy that batch guarantee, batches never roll
  into another purchase, and guarantee state resets after every batch;
- no 50/50 loss path and a counter carried by the compatible banner-family id;
- explicit canonical item ids for every pool member, with mythic items excluded
  from paid random acquisition;
- seven daily Stars claims banked without streak loss, plus a flexible weekly
  bonus, totaling the 1600-Star weekly simulation budget;
- one deterministic unowned evergreen common/uncommon award each week, with an
  explicit `no-item` result when the pool is exhausted;
- provisional fixed duplicate Shards of common 1, uncommon 3, rare 8, epic 20,
  legendary 50, and mythic 0.

The Shard schedule is a versioned hypothesis, not launch economics. Named-item
direct purchase and deterministic Shard crafting are required alternatives in
the contract. The first simulation study now prices and compares those routes;
commerce implementation remains a separate production slice.

## Candidate study 1

`candidate-a-vs-collection-first@1` under `economy/simulations/scenarios/`
compares the v1 broad-rarity contract with a collection-first hypothesis. The
second candidate uses integer base weights of 72 standard, 23 rare, 4 epic,
and 1 signature; rolling rare-or-better by pull 8, epic-or-better by pull 25,
and deterministic selected featured unowned by pull 20; no soft pity or loss
path; and counter carry across explicitly compatible banner ids.

The simulator resolves simultaneous guarantees in this order: selected,
epic-or-better, rare-or-better, then base. Selected pity therefore dominates
epic pity while a featured unowned item remains. Epic pity is still reachable
after that finite featured pool is exhausted, and focused tests prove the exact
8, 20, and 25 boundaries plus compatible-family carry.

The immutable generated report includes exact named-item and tier
probabilities, fixed-seed statistical validation, selected-item expected/p50/
p90/cap costs, pity and duplicate distributions, Shard yield, paid versus
promotional Star burn, 52-week completion curves, direct purchase and crafting
alternatives, route cannibalization, and content-production cost. It rejects a
perpetual weekly-new entitlement because the modeled 52 annual SKUs exceed the
12-SKU plan and budget; the alternative is a bounded 12-week passport with an
explicit no-item exhausted state plus monthly community claims.

Run or verify the study with:

```bash
npm run generate:economy-simulations
npm run check:economy-simulations
npm test -- --run scripts/economy-simulator.test.ts
```

The generator uses xorshift32 plus rejection-sampled bounded integer choices.
Seeds and SHA-256 source anchors are recorded in the report; no wall-clock
timestamp enters the artifact. `--write-new` writes only a missing report and
refuses to overwrite published output.

## Exact disclosure math

All source numbers are safe integers. Rarity weights must sum exactly to their
integer scale, and per-item weights are integers within each frozen tier. The
generator reduces each probability to an exact numerator and denominator. For
example, a common item in the 12-item common pool is exactly `1/24`; its
`4.166667%` display string is labeled with its rounding rule and is never the
simulation input.

Guarantees remain structured rules rather than being folded into misleading
base rates. A missed purchased ten-pull batch replaces pull ten using base
weights conditioned on rare-or-better; the disclosure generates exact
conditional tier and named-item probabilities for that replacement. Singles do
not participate, no window rolls across purchases, and the batch window resets
after resolution whether or not replacement was required. The future simulator
must also apply family pity state and replace pull 30 with the selected featured
item when it has not already been awarded.

## Append-only workflow

Published source contracts, disclosures, simulation scenarios, and reports are
immutable. To compare another hypothesis:

1. Add the next contiguous file under `economy/contracts/editions/` using
   `<four-digit-version>-<slug>.json`. Never edit an existing edition.
2. Freeze explicit catalog item ids and integer weights. A rarity selector is
   intentionally insufficient because future catalog additions must not change
   historical odds.
3. Generate only the missing disclosure:

   ```bash
   npm run generate:economy-disclosures
   ```

   The generator refuses to overwrite a mismatched existing disclosure.
4. Verify source/artifact consistency and merge-base history:

   ```bash
   npm run check:economy-disclosures
   npm run check:immutable-economy-history -- origin/main
   npm test -- --run scripts/generate-economy-disclosures.test.ts scripts/check-immutable-economy-history.test.ts
   ```

Pull-request CI resolves the branch merge base, then rejects any change to a
contract, disclosure, scenario, or report that existed there. New
source/disclosure and scenario/report pairs are allowed only at the next
contiguous version. A future study must append the next file under
`economy/simulations/scenarios/`; it must never rewrite the 0001 snapshot.

## Safety boundary

Validation rejects fractional or unsafe numbers, invalid weight totals, empty
tiers, duplicate or unknown catalog ids, catalog rarity mismatches, mythic paid
random entries, inaccessible featured choices, lossy featured selection,
incorrect guarantee boundaries, broken family carry, incoherent cadence totals,
missing or negative Shard values, and random-only acquisition policies.

The same gate scans `src/`, `server/src/`, `server/core/src/`, and
`server/wasm/src/` for production imports of `economy/contracts`,
`economy/disclosures`, `economy/simulations`, or the simulator. No wallet,
debit, RNG, pull, checkout, entitlement grant, or client runtime integration
exists in this slice.

## Production edition and earned-wallet foundation

The selected Candidate B rules now have a separate production source at
`economy/production/editions/0001-earned-collection.json`. It is not generated
from, imported from, or evaluated by simulator runtime code. The production
validator freezes the explicit catalog pools, 72/23/4/1 weights, pull-8 and
pull-25 tier guarantees, pull-20 selected-unowned guarantee, 160/1600 Star
cost, flexible ten-roll weekly earning cap, finite 12-week passport, four-week
Community Die cadence, and deterministic Dust outcomes.

Production files use the same append-only rule as the studies: add the next
contiguous production edition and a new anchored migration; never rewrite an
edition or migration that exists at the branch merge base. The validator
dispatches shared semantics by `schemaVersion`, freezes edition 0001 to its
exact Candidate B source hash, and derives each migration block marker from the
edition number. A rate change therefore appends a tuned 0002 under the existing
schema; a shape change must add an explicit schema-version validator. Verify
with:

```bash
npm run check:production-economy
npm run check:immutable-economy-history -- origin/main
npm test -- --run scripts/validate-production-economy.test.ts
```

Migration `0009_earned_economy_ledger.sql` creates account-anchored balances
and an immutable ledger. Authenticated clients receive own-row SELECT only.
Only the explicitly granted service-role function may append a delta; it locks
the stable account row, returns exact idempotent replays, rejects mismatched
replays, and rejects negative or overflowing balances. Promotional Stars and
earned Dust are separate buckets, and this phase has no paid bucket or balance
credit path.

Run the real Postgres proof with Docker:

```bash
npm run test:db:wallet-ledger
```

The harness applies the repository migrations to PostgreSQL 17, exercises
actual RLS and grants, proves update/delete/truncate rejection, and races both
identical retries and competing debits. The foundation follows the merged Dark
Dungeon catalog migration `0008`, so the wallet migration remains the next
contiguous migration at `0009`.

Migration `0010_earned_reward_claims.sql` is the next contiguous append. It
normalizes the `earned-collection@1` reward rules/items instead of embedding a
second configuration snapshot, and adds:

- service-only exact-replay room-roll ingest with a hard first-10-per-UTC-
  Monday-period cap (160 Stars each, 1600 maximum);
- immutable passport enrollment and accumulated weekly catch-up, capped at 12
  claims with an explicit complete state;
- Community Die claims every four completed weeks from enrollment;
- deterministic lowest-canonical never-granted selection, with exact 2-Dust
  passport and 50-Dust Community exhausted-pool outcomes;
- immutable outcomes linked exactly to their entitlement or wallet ledger;
- authenticated, non-anonymous status and claim RPCs with no caller user, item,
  amount, time, or claim-index arguments.

Local WASM solo rolls do not earn: browser roles cannot execute authoritative
roll ingest or write its tables. `src/lib/earnedEconomy.ts` exposes only the
status/passport/community client RPCs and throws typed errors instead of
converting backend failure into a false success.

Run every numbered SQL and concurrency suite in deterministic order with:

```bash
npm run test:db:supabase
```

Before database tests, CI runs the global migration-history guard:

```bash
npm run check:immutable-migration-history -- origin/main
```

Every migration at the merge base is frozen. New migrations must use the next
unique contiguous four-digit prefix; edits, deletion, renumbering, gaps, and
duplicate prefixes fail. Catalog, ImageGen, and economy guards still run for
their deeper domain invariants.

Currency provenance is not commerce entitlement provenance. Pulls, RNG,
guarantee state, source-specific paid grant/reversal history, checkout, and
money remain downstream slices.
