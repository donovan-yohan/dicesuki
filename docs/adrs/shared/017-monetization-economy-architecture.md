# ADR 017: Monetization economy architecture

**Status:** Accepted

## Context

The earned economy now has an immutable wallet ledger, starter entitlements,
authoritative reward claims (ADR 014), and a sealed, append-only pull
preparation boundary (ADR 016). What it lacked was a monetization architecture:
a way for players to acquire currency for real money, a scarcity dial that makes
a rotating featured pull a revenue path without pricing per pull predatorily, a
terminal commit/reveal boundary that turns a sealed preparation into a granted
outcome, and an ownership model that survives refunds and chargebacks.

A product conversation (2026-07-22/23) locked the design decisions. The gacha
math was validated against the repository's own frozen economy simulator rather
than hand arithmetic; the design draft and its simulation evidence live in
`docs/exec-plans/active/2026-07-22-monetization-economy-spec.md`. This ADR
formalizes that draft into enforceable architecture rules. It records the target
model; the spec remains the working detail (bundle arithmetic, percentile
tables, open tuning questions) and the numbers there are informative, not
normative, for this ADR.

Two constraints shape everything. First, real-money randomization is a distinct
legal surface (issue #154) from the rest of the economy, so the architecture
MUST let free rails ship while the randomized-purchase rails stay dormant behind
one gate. Second, `wallet_ledger_entries`, catalog snapshots, production
editions, and pull configuration are append-only (ADR 014, ADR 016); every
monetization delta MUST append rather than rewrite, and money-path migrations
need proof stronger than static text assertion.

## Decision

### Two currencies and two roll tickets

The economy MUST use two fungible currencies and two pull tickets as distinct
items. **Stars** are the fungible premium currency (Genshin *primogem* analog),
living in the `promotional` bucket (free faucets, live today) and a
`paid` bucket (real-money credit, inert until #154). **Dust** is the earned
currency (ADR 014) and MUST be the single duplicate-conversion currency; the
simulation-only "Shards" label is retired and MUST NOT become a runtime
currency. **`standard_roll`** and **`premium_roll`** MUST be durable per-user
ticket balances with their own nonnegative, append-only ledger mirroring
`wallet_ledger_entries`, distinct from Stars — a roll ticket is not a Star
balance. This ticket ledger is implemented in
`supabase/migrations/0014_roll_ticket_ledger.sql`.

`standard_roll` MUST fund only STANDARD banners; `premium_roll` MUST fund only
PREMIUM banners. Stars convert to either ticket at a fixed **160 Stars = 1
roll** (reusing `singlePullCost: 160`). The Stars→`standard_roll` conversion is
promotional-bucket, free, and idempotent
(`supabase/migrations/0016_stars_to_standard_roll_conversion.sql`). The
Stars→`premium_roll` conversion MUST accept **any** Stars bucket at 160:1 (the
Genshin primogem→Fate model — no bucket lockout), and it MUST ship behind #154
because it exists to feed the randomized premium path.

### Banner classes and the funding lifecycle

Each pull banner version MUST carry a `banner_class`
(`standard` | `premium`) and a `roll_type` (`standard_roll` | `premium_roll`),
with the pairing enforced at the schema (`standard` pairs with
`standard_roll` or a legacy NULL; `premium` MUST pair with `premium_roll`).
Pre-existing banners MUST remain `('standard', NULL)` and retain their original
promotional-Star behavior. This binding is implemented in
`supabase/migrations/0015_banner_roll_type_binding.sql`.

Ticket funding MUST use **reservation, not prepare-time debit**. A ticket-backed
`prepare_pull` computes available quantity as the ticket balance minus every
live same-user, same-type hold, and takes no ledger entry; expiry releases that
reserved capacity naturally, with no refund entry. The real debit MUST happen
only at the terminal commit boundary, which MUST NOT double-count the active
reservation. Star reservations and ticket reservations MUST NOT cross-reserve.

The **terminal commit/reveal boundary** (extending ADR 016's prepare-only
sealing) is implemented in
`supabase/migrations/0017_pull_commit_reveal.sql`. Each prepared session MUST
admit at most one immutable `committed` or `cancelled` transition. Commit MUST
lock the wallet account first, append the committed transition as its
exactly-once guard, debit the bound funding (promotional Stars or
`standard_roll` tickets) only through the canonical ledger functions, advance
durable guarantee counters from the sealed projections, grant outcomes, and
return the seed, nonces, results, and commitment fields for client
verification. Cancel MUST append only the transition — no debit, grant,
guarantee advance, or reveal. Premium banners MUST fail closed in both prepare
and commit until #154.

### Sealed-at-prepare commit/reveal fairness

Pull fairness MUST be a sealed commit/reveal scheme, not a trust-me reveal. The
outcome, tier, guarantee reason and counters, duplicate decision, and per-result
nonce are sealed at preparation time under a fresh CSPRNG seed with
domain-separated HMAC-SHA-256 and a root commitment (ADR 016). The 32-byte seed
and per-result nonces MUST be disclosed only after the immutable `committed`
transition; cancelled or merely expired sessions MUST have no reveal path.
Client physics and presentation MUST NOT influence outcome selection.

### Pity: locked hard pity, dormant soft-pity ramp

PREMIUM featured **hard pity MUST be 75** (ceiling `75 × 160 = 12000` Stars).
STANDARD banners MUST stay shallow (25–40) and generous. The revenue dial MUST
be premium pity depth plus `premium_roll` scarcity (set by Star income rate),
**not** per-pull price; the featured base rate stays ~0.6%.

The engine MUST support a **linear-rate-ramp soft pity** as structured banner
configuration (`{model, startPull, perPullIncrement, baseFeaturedRate}`)
replacing the old `softPity: 'none'` field, holding the base rate until
`startPull` then ramping the featured rate per pull up to the untouched hard
guarantee. The recommended slope is **+0.5%/pull from pull 41**
(`perPullIncrement 0.005`, base 0.6%), left PO-tunable. This engine change MUST
ship **dormant** — present and validated but enabled on no banner — with
activation riding the #154 premium-path gate. It is implemented dormant in
`supabase/migrations/0018_soft_pity_ramp.sql`, with the simulator and both
production-economy validators updated to accept and drift-check the ramp
configuration.

### Discrete-copy dice inventory (supersedes entitlement-boolean ownership)

Dice ownership MUST be tracked as **discrete copies**, not an ownership boolean.
The inventory MUST record dice as unique countable copies, and **ownership is the
live copy count**. Consequences that MUST hold:

- A duplicate pull result MUST grant **another spawnable copy plus Dust** — not
  Dust only. A player MAY hold N copies of the same die and spawn them
  simultaneously (a matched set of d6s is N live copies of one die).
- For pull semantics, "unowned" MUST mean **zero live copies** and a result is a
  duplicate when the player already holds **at least one** live copy — replacing
  the `user_entitlements` boolean check for selected-featured-unowned and
  `is_duplicate`.
- The **first-ever** copy of a die MUST set a first-copy flag so the client can
  give a brand-new-die presentation; later copies MUST NOT. This flag MUST be an
  **ever-owned latch** persisted per catalog die (the recommended reading),
  **not** a zero-to-one live-count transition, so scrapping every copy and
  re-pulling MUST NOT re-fire the brand-new-die treatment. (Ever-owned vs
  every-zero-to-one is a spec §7 confirmation item; §6.1's "first live copy"
  wording resolves to ever-owned.)
- **Every** die MUST be scrappable to Dust, and Dust MUST be spendable to
  craft/duplicate a die. Crafting is the Dust sink; scrap and duplicate pulls are
  the Dust sources.
- Because scrap can drive a featured die back to **zero live copies**, the spec
  MUST define whether a scrapped featured die becomes **re-chaseable**
  (re-enabling the 75-pull selected-featured guarantee), how scrap-driven copy
  counts may **steer** the selected-featured target when multiple featured ids
  exist, and what the guarantee resolves to when there is **no unowned** featured
  target (spec §1.6/§5).

This copy-count model supersedes the entitlement-boolean ownership model for
pull grants and, because a die's presence is a live count rather than a unique
historical grant, **reduces** the revoked-entitlement asymmetry noted in ADR 014
(a refund reversing one copy decrements a countable balance rather than erasing
an independently earned grant). It does **not** fully eliminate it: scrap is a
new player-controlled decrement, so a player MAY scrap a granted copy to zero
(pocketing scrap Dust) and then refund or charge back the purchase that granted
it, leaving the reversal nothing to decrement. Under the no-negative discipline
that reversal either fails closed (impossible for an involuntary bank chargeback —
the money leaves regardless) or would drive the copy count negative; either way
the player keeps both the scrap Dust and the refund. That scrap-then-refund /
chargeback reconciliation is an **open rule** (spec §7), not resolved by
construction. The as-built commit path in `0017` still grants duplicates
**Dust-only** against `user_entitlements` (pre-decision, transitional); the
discrete-copy grant rework is the next slice set and is the target this ADR
mandates. Duplicate-Dust yields, per-tier scrap yields, and craft costs MUST be
sized **together** by economy simulation before they ship: because a granted
duplicate copy is immediately scrappable, the effective Dust from one duplicate
is `dupe_dust + scrap_dust`, so the duplicate-Dust table cannot be treated as
settled independently of scrap. Crafting SHOULD be restricted to dice the player
already owns; because Dust is one fungible earned-bucket currency, the craft cost
of a die MUST exceed the **Dust-equivalent acquisition cost of a copy of that die
on its native banner** (a premium/signature copy priced against premium-pull
cost), not merely the Dust yield of the cheapest pulls that could farm the Dust —
otherwise cheap standard-farmed Dust crafts matched-set copies of an expensive
premium die and undercuts premium pulls.

### Real-money purchase framework

Star bundles MUST use the **Genshin-anchored** framework: the Star amounts are
the exact Genesis Crystal amounts including their standard bonus
(60 / 330 / 1090 / 2240 / 3880 / 8080), and the prices are the Genshin USD
ladder **halved and rounded down** (0.49 / 2.49 / 7.49 / 14.99 / 24.99 / 49.99).
The **first-time bonus MUST be Genshin double-raw**: the first purchase of each
SKU grants `raw × 2` and **replaces** (does not stack on) the standard bonus,
granted exactly once per user per SKU and reversed on refund. Fulfillment MUST
credit bundle Stars into the **paid** bucket through the ledger boundary (a new
fulfill branch beside `0013`'s entitlement-only grant), which requires enabling
the `(stars, paid)` currency-bucket pair. Non-die products (Star bundles, direct
roll bundles) MUST route through a SKU/product registry so fulfillment can
dispatch die-entitlement vs. currency-credit vs. roll-credit. Direct-purchase
collab dice remain the fixed-price cosmetic rail (`0013`); gacha featured dice
and direct-purchase collab dice SHOULD stay in disjoint pools (a recommended,
not-yet-PO-locked rule — it is not among the locked decisions and stays open in
spec §7) so the two rails do not cannibalize.

The **Lunar Pass** subscription ($2.99/month, Genshin "Welkin" model) MUST grant
300 Stars on purchase plus a 90-Stars/day × 30 daily-claim faucet (3000
Stars/month), riding the `earned_reward_program` rail with a subscription-status
flag flipped by a recurring-billing webhook. It MUST NOT be positioned as the
value anchor.

### Legal gating and delivery discipline

The #154 gate MUST split the economy: **free rails** (all faucets,
Stars→`standard_roll`, standard-banner pulls funded by promotional Stars,
direct-purchase collab dice) MAY ship pre-#154; the **randomized-purchase rails**
(`(stars, paid)` enablement, premium-banner random reveal, Stars→`premium_roll`
conversion, any paid-Star-funded pull, soft-pity activation) MUST stay behind
#154. The Lunar Pass MUST additionally clear subscription-law compliance
(auto-renewal disclosure and frictionless cancellation), an independent gate.

Money-path migrations MUST be proven against a **live/disposable PostgreSQL
harness** (pglite/pgTAP-style), not static regex assertion alone; static text
tests are insufficient for money-path correctness. Delivery MUST be **one
reviewable slice per PR**, CI-gated, merged autonomously only after adversarial
review clears with no unresolved P0/P1 findings.

## Consequences

- Standard-generous / premium-scarce is the revenue dial, tuned by Star income
  rate rather than per-pull price, so the free acquisition funnel and the paid
  chase share one code path and differ only in ticket supply and pity depth.
- The reservation funding model means an expired ticket-backed preparation
  restores capacity with no compensating ledger entry, and the single terminal
  transition is the exactly-once debit boundary; a double-count there would be a
  real-money defect, so it is the sharpest live-harness target.
- Copy-count ownership makes refund and chargeback reversal a decrement of a
  countable balance instead of the deletion of a unique historical grant,
  **reducing** (not removing) the accidental-revocation hazard ADR 014 flagged —
  scrap adds a new player-controlled decrement, so a copy scrapped before its
  granting purchase is refunded or charged back leaves the reversal nothing to
  decrement (an open reconciliation rule, spec §7) — at the cost of a migration
  reworking `0017`'s duplicate-grant path away from Dust-only.
- The soft-pity ramp turns the flat hard-pity wall into a spend curve with a
  real tail while shipping dormant, so disclosure numbers can freeze before the
  premium path activates.
- Scrap/craft introduces a Dust sink and (via immediately-scrappable duplicate
  copies) an amplified Dust source, so duplicate-Dust, scrap yields, and craft
  costs MUST be balance-checked **together**; an unpriced craft cost is an
  arbitrage vector — in the owned-only world the live loop is cross-banner
  matched sets (cheap standard Dust crafting extra copies of an expensive premium
  die), so the craft-cost bound is against a copy's native-banner acquisition
  cost, not merely pull Dust yield, and the loop cannot ship before economy-sim
  validation.
- The #154 split lets the entire free economy launch and be exercised while the
  randomized-purchase surface stays inert by construction (no `(stars, paid)`
  balance row can exist), keeping legal exposure to one reviewable boundary.
- Anchoring bundles and pity to Genshin's public model gives defensible,
  familiar disclosure math; halved pricing compresses the subscription's
  relative headroom, so the Lunar Pass earns its place on retention and MRR, not
  as a headline discount.

## Proof

The engine-side slices are implemented and statically proven behind the gate,
all dormant or free-tier:
`0014_roll_ticket_ledger`, `0015_banner_roll_type_binding`,
`0016_stars_to_standard_roll_conversion`, `0017_pull_commit_reveal`, and
`0018_soft_pity_ramp`, each with colocated migration tests, plus the
soft-pity updates to `scripts/economy-simulator.js` and
`scripts/validate-production-economy.js`. The gacha math is validated by the
repository's frozen simulator and the premium-pity driver referenced in
`docs/exec-plans/active/2026-07-22-monetization-economy-spec.md` §5.

The focused commands are:

```text
npm test -- supabase/migrations
node scripts/economy-simulator.js --check
node scripts/validate-production-economy.js
```

Static migration assertions and the existing history guards remain authoritative
today; the mandated live-DB harness (above, agreed but not yet built) is the
required additional proof for each money-path migration before it leaves
dormancy. No paid bucket, premium
random reveal, Stars→`premium_roll` conversion, or soft-pity activation ships
until #154.
