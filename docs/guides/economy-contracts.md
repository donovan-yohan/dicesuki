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
