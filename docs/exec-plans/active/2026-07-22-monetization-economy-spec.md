# Monetization Economy Spec (DESIGN DRAFT)

> Status: **DRAFT — design only**, now formalized by
> **[ADR 017: Monetization economy architecture](../../adrs/shared/017-monetization-economy-architecture.md)**
> (Accepted). This doc stays the working design detail (bundle arithmetic, pity
> percentiles, open tuning questions); ADR 017 is the enforceable rule set. The
> engine-side slices are **implemented dormant / free-tier** in the
> `slice1-roll-tickets` PR chain (migrations `0014`–`0018`, see §6); the **paid /
> randomized-purchase** rails still ship only after the **#154 legal gate**. This
> captures decisions from a product conversation (2026-07-22/23) and validates the
> gacha math against the repo's existing economy simulator.
>
> Date: 2026-07-22 (rev 2026-07-23) · Branch: `draft/monetization-economy-spec`
> (off `origin/main`).

---

## Key findings (read first)

Two load-bearing results drive everything below.

**Finding 1 — Soft pity is now a PO-ACCEPTED engine change (2026-07-22).** The
analysis that motivated it stands: with **no** soft-pity ramp in the engine,
hard pity is a **flat guaranteed price, not a gamble.** dicesuki-core / the
`0011` pull policy had **no soft-pity ramp** when this analysis was written
(`softPity: 'none'` was the only contract value; the ramp is **now implemented
dormant** in `0018` — see §6 delta 9). Under that flat design the featured-die ceiling is exactly
**`hardGuaranteePull × 160` Stars**, and at a ~0.6% rate-up **~85% of players pay
that ceiling to the Star** (simulated, §5.2), so `p50 = p90 = p99 = ceiling`. The
repo's own frozen study — a **different** config (~1% rate-up, hard pity 20) —
independently **demonstrates the same flat-ceiling behaviour** (96.7% hit hard
pity there, §5.1), corroborating the mechanism rather than the 0.6%/85% number. A real spend
**curve** (a long tail of higher whale spend instead of a hard wall) is **not a
config knob** — it requires **adding a soft-pity ramp to dicesuki-core / the
`0011` pull policy**. The PO has now **accepted that engine change**; §5.5 sizes
the ramp slope by simulation and §6 lists the engine/schema delta (now landed
dormant as `0018_soft_pity_ramp.sql`, enabled on no banner). The
recommended ramp (**+0.5%/pull from pull 41**) drops p50 to ~51 and leaves only
**~2.2%** of players at the hard-75 ceiling while preserving a real right tail.

**Finding 2 — PREMIUM featured hard pity 75 is LOCKED; keep STANDARD shallow and
generous.** At the PO's original shallow pity 25 the whale ceiling is only
**~$27 std / ~$15 first-time / ~$25 best-value** per featured die — no meaningful
ceiling (one $24.99 vault plus loose change guarantees it). Hard pity **75** is
now **locked** (ceiling **~$82 std / ~$46 first-time / ~$74 best-value** — see
§5.4 for the exact new-pricing math). STANDARD banners stay shallow (**25–40**)
and generous. **Premium pity depth + `premium_roll` scarcity is the revenue dial
— not per-pull price.** Full numbers in §5.4.

---

## 1. Acquisition & currency model

### 1.1 Acquisition rails
- **Gacha (roll + pity) is the PRIMARY way to get dice.** Everything about the
  collectible pool funnels through the room-independent pull path already
  scaffolded in `supabase/migrations/0011_earned_pull_preparation.sql`
  (`pull_banner_versions` carries `rare/epic/selected_hard_guarantee_pull`,
  `pull_banner_tiers`, `pull_banner_offers`, and a 120s `prepare_pull` hold).
- **Direct purchase is reserved for special collab dice only** — the fixed-price
  cosmetic path already built in `0013_paid_checkout_foundation.sql`
  (`payment_orders` + `create/fulfill/refund_payment_order`, entitlement grant,
  no wallet credit). Gacha featured dice and direct-purchase collab dice **should
  stay in disjoint pools** (recommended, **still open** — not among the locked PO
  decisions; see §7) so the two rails do not cannibalize (see §5.4, §7).

### 1.2 Currencies (verified against live schema)
| Item | Kind | Bucket(s) | Source of truth | Status |
|---|---|---|---|---|
| **Stars** | fungible currency | `promotional` (live), `paid` (inert) | `0009` wallet, `0013` domain | live promo; **paid #154-gated** |
| **Dust** | earned currency | `earned` | `0009` wallet | live; **canonical duplicate-conversion currency**; **scrap source + craft sink** (§1.6) |
| **Shards** | duplicate-conversion unit | n/a (sim-only) | `0001-broad-rarity-showcase` contract | **sim-only historical label** — resolved (PO 2026-07-22): dupes convert to **Dust** |
| **standard_roll** | pull ticket | n/a | `0014` ticket ledger | **implemented (dormant)** — durable balance + append-only ledger |
| **premium_roll** | pull ticket | n/a | `0014` ticket ledger | **implemented (dormant, #154-gated)** — same ledger, no funded banner yet |

`0009` pins `wallet_balances.currency_id in ('stars','dust')` with a hard
`currency_bucket_pair` rule (`stars⇔promotional`, `dust⇔earned`). `0013`
extended the bucket **domain** to include `paid` but left that pair rule intact,
so **no `(stars,paid)` balance row can exist yet** — the paid bucket is inert by
construction. Enabling paid Stars is a coupled rule change, and it is
**#154-gated**. Duplicate gacha conversion pays out in **Dust** (the earned
bucket, production edition `0001-earned-collection.json`); **Shards** is a
simulation-only label carried by the frozen study and is not a runtime currency.

### 1.3 Rolls are a separate item from Stars (primogem vs Fate model)
Product decision: **Stars** are the fungible currency (Genshin *primogem*
analog); **rolls** are the pull tickets (*Acquaint/Intertwined Fate* analog).
There are two roll types:

- **standard_roll** → consumed by **STANDARD** banners (permanent pool).
- **premium_roll** → consumed by **PREMIUM** banners (rotating/featured/collab).

Conversion: **160 Stars = 1 roll** (reuses today's `singlePullCost: 160`,
`tenPullCost: 1600`; matches Genshin's 160 primogems per wish). Rolls can also be
**earned/gifted directly** (faucets, events, first-purchase bonuses) without
touching Stars.

> **Reconciliation flag (updated 2026-07-23).** Before slice 1 the `0011` pull
> path priced a pull **directly in 160 promotional Stars** with no roll-ticket
> item in the schema. The two-item (Stars↔rolls) model is now **implemented
> dormant**: `0014` adds the durable ticket ledger, `0015` binds banners to a
> roll type with reservation-funded preparation, and `0016` converts
> Stars→`standard_roll` at 160:1. The spec keeps 160 Stars ≡ 1 roll so all
> existing simulator cost outputs (in Stars) still map 1:1 to rolls
> (`stars ÷ 160`).

### 1.4 Two banner types (the revenue dial)
| | STANDARD banner | PREMIUM banner |
|---|---|---|
| Pool | permanent evergreen | rotating / featured / collab |
| Ticket | `standard_roll` | `premium_roll` |
| Ticket supply | **given away generously** (faucets, Stars→standard_roll) | **scarce by Star income rate** (any-bucket Stars→premium_roll at 160:1, purchase bonuses, sparse faucets) |
| Featured pity | shallow & lossless (25–40) | deeper — hard pity **75 LOCKED** + soft-pity ramp (see §5.4/§5.5) |
| Role | acquisition funnel / retention | monetization |

Standard-generous / premium-scarce is the primary revenue dial. **Stars convert
to `premium_roll` from any bucket** at 160:1 (Genshin primogem→Intertwined Fate
model — PO decision 2026-07-22, no bucket lockout). So `premium_roll` scarcity
now comes from **how fast players accrue Stars** (income rate + sparse premium
faucets), **not** from a conversion lockout, and it sets premium-banner revenue
without changing any per-pull price. The premium **random pull path** itself
stays #154-gated (§1.5).

### 1.5 Free / paid / #154 legal split
- **Free, ships pre-#154:** all faucets (§4), Stars→**standard_roll** conversion,
  standard-banner pulls funded by **promotional** Stars, direct-purchase collab
  dice (#153/`0013`, entitlement-only, already live-capable).
- **#154-gated (real-money randomization):** paid-Stars bucket enablement,
  the **premium-banner random pull path**, and any paid-Star-funded pull.
  Stars→`premium_roll` conversion is allowed from **any bucket** (160:1, Genshin
  model), but it ships **behind #154** because it exists to feed the premium
  random path — the thing #154 governs is **money buying a randomized outcome**,
  and the premium random reveal is that path. Converting free promotional Stars
  to `premium_roll` is only useful once the premium random path is live, which is
  itself #154-gated, so the conversion RPC lands with that gate.

### 1.6 Discrete-dice-copy inventory (ownership = live copy count) — NEW (PO 2026-07-23)

Ownership is tracked as **discrete copies**, not an ownership boolean. This
**supersedes the entitlement-boolean ownership model for pull grants** and is the
target model formalized in ADR 017; the as-built `0017` behavior below is
transitional.

- **Copy-based ownership.** The inventory records dice as unique, countable,
  spawnable copies. **Ownership = the live copy count** for a catalog die. A
  player MAY hold **N copies of the same die** and spawn them **simultaneously**
  (a matched set of d6s is N live copies of one die, not one die spawned N
  times).
- **Duplicate pull = copy + Dust (not Dust-only).** A duplicate result grants
  **another spawnable copy** *plus* the tier's Dust — a duplicate is still an
  additive collection event, not just currency. This is the key change from the
  transitional path. **Double-dip caveat.** Because every copy is itself
  scrappable, a player who does not want the extra copy scraps it and nets
  `dupe_dust + scrap_dust` from a single duplicate — roughly **double** the Dust
  the transitional `0017` Dust-only path yielded (the rate the pity/whale sims
  were implicitly calibrated against). The per-tier `dupe_dust` table (2/8/20/50)
  therefore **cannot** be treated as settled independently of scrap; it MUST be
  re-sized **jointly** with scrap and craft (a three-way validation — §7).
- **Scrap any die → Dust.** **Every** die is scrappable: scrapping removes one
  live copy and credits per-tier Dust to the earned bucket. There is no
  unscrappable tier.
- **Craft / duplicate from Dust.** Dust is spendable to **craft/duplicate a die
  the player already owns**, granting one additional live copy. Craft is the
  Dust sink; scrap and duplicate pulls are the Dust sources. (Whether Dust may
  ever craft an *unowned* die is an open question — §7; working assumption is
  owned-only, per the PO's "craft or duplicate dice they already have.")
- **First-copy UI flag (ever-owned latch).** The **first-ever** copy of a given
  die sets a first-copy flag so the client can give a fancy brand-new-die
  presentation; subsequent copies do not trigger it. **Definition (recommended,
  §7 confirmation item):** the flag is an **ever-owned latch persisted per
  catalog die** — it latches on first-ever acquisition and **never re-fires**, so
  scrapping every copy to zero and re-pulling does **not** replay the
  brand-new-die celebration. It is deliberately **not** a zero-to-one live-count
  transition (which would re-fire on every scrap-all-then-re-pull — a repeatable
  celebration and a possible faucet/analytics exploit if anything ever keys off
  the flag). §6.1 delta #10's "first live copy" wording resolves to this
  ever-owned latch.

**Impact on `0017`'s grant path (transitional).** The committed reveal in
`0017_pull_commit_reveal.sql` currently grants a duplicate the tier's
`duplicate_dust` **only** (via a single deterministic wallet append) and detects
ownership by an `exists` check against `user_entitlements`. That is the
**pre-decision, transitional** behavior. The target model reworks this so a
duplicate grants **a copy plus Dust** and a non-duplicate (zero live copies at
commit) additionally sets the first-copy flag **only if the die has never been
owned** — the ever-owned latch above, not merely a zero-live-copies result, so a
re-pull after scrap-all is a non-duplicate but MUST NOT re-latch (schema deltas
§6.1).

**Impact on pull-seal semantics.** The sealed pull result carries
`is_duplicate` and (for the selected-featured guarantee) a
selected-featured-**unowned** check. Under copy-count ownership these MUST resolve
against the **live copy count**: **unowned = zero live copies**, and a result is a
duplicate when the player already holds **≥ 1** live copy. This replaces the
`user_entitlements` boolean check in the prepare/commit projection. The 75-pull
hard guarantee and the "newly awarded selected-featured resets selected pity /
duplicate featured does not" rule (ADR 016) are unchanged — only the ownership
predicate feeding them changes.

**Scrap makes featured dice re-chaseable — flag before freeze.** Because
"unowned" now means **zero live copies**, scrapping a featured signature die
makes it **unowned again**, re-enabling the 75-pull selected-featured guarantee
and the entire premium chase for a die the player already obtained. The §5
premium economics (p50 ≈ 51, mean ≈ 46.6 pulls, ~2.2% at the hard-75 ceiling) are
modeled as a **one-time** chase and do **not** price a scrap-to-re-chase loop —
decide whether re-chaseability is intended premium revenue or a loop to block.
Two further consequences of tying selection to live copy count: (1) the draft
banner's `selectedFeaturedUnowned` selection rule (**lowest-canonical-id-unowned**)
now depends on a count the player controls via scrap, so with **multiple**
featured ids a player could scrap a specific die to **steer** which die the
75-pull guarantee awards — decide whether that steering is acceptable. (2) When
the sole featured die is owned (**zero unowned targets**, draft `lossPath:
"none"`), the guarantee's resolution under the new predicate is currently
**undefined** — define what it awards (or that it simply does not arm) when there
is no unowned featured target.

**Reduces (does not fully resolve) the revoked-entitlement asymmetry.** ADR 014
warned that paid refunds and chargebacks must not accidentally revoke an
independently earned entitlement grant. Because ownership is now a **live copy
count** rather than a unique historical grant, a refund/chargeback is a
**decrement of a countable balance**, not the deletion of a one-of-a-kind grant
row — which removes the *original* deletion hazard. But copy-count ownership adds
a **new** player-controlled decrement, **scrap**, that reintroduces the same
shape: a player MAY scrap a granted copy to zero (pocketing scrap Dust) and then
refund or charge back the purchase that granted it, so the reversal has nothing
to decrement. Under the no-negative discipline the reversal either fails closed
(impossible for an involuntary bank chargeback — the money leaves regardless) or
would drive the copy count negative; either way the player keeps both the scrap
Dust **and** the refund. This scrap-then-refund / chargeback case is an **open
rule** (§7), not resolved by design.

---

## 2. Star bundle pricing (LOCKED by product owner)

**PO-LOCKED lineup (2026-07-22).** The Star amounts are the **exact Genshin
Impact Genesis Crystal amounts including their standard bonus** (raw + standard
bonus: `60+0`, `300+30`, `980+110`, `1980+260`, `3280+600`, `6480+1600`). The
**prices are Genshin's USD ladder halved and rounded down to the cent**
(`0.99/4.99/14.99/29.99/49.99/99.99` → `0.49/2.49/7.49/14.99/24.99/49.99`). The
**first-time bonus is Genshin-style double-raw**: the first purchase of each SKU
grants `raw × 2` total, **replacing** (not stacking on) the standard bonus.
Effective rates computed with `node` arithmetic, not hand math.

| SKU | price_usd | raw | bonus | base_stars (total) | first_time_total | $/Star std | $/Star 1st | $/pull std | $/pull 1st | pulls (base) |
|---|---|---|---|---|---|---|---|---|---|---|
| stars_handful | 0.49 | 60 | 0 | 60 | 120 | 0.0081667 | 0.0040833 | **1.3067** | 0.6533 | 0.375 |
| stars_pouch | 2.49 | 300 | 30 | 330 | 600 | 0.0075455 | 0.0041500 | 1.2073 | 0.6640 | 2.0625 |
| stars_bag | 7.49 | 980 | 110 | 1090 | 1960 | 0.0068716 | 0.0038214 | 1.0994 | 0.6114 | 6.8125 |
| stars_chest | 14.99 | 1980 | 260 | 2240 | 3960 | 0.0066920 | 0.0037854 | 1.0707 | 0.6057 | **14.0** |
| stars_vault | 24.99 | 3280 | 600 | 3880 | 6560 | 0.0064407 | 0.0038095 | 1.0305 | 0.6095 | 24.25 |
| stars_hoard | 49.99 | 6480 | 1600 | 8080 | 12960 | 0.0061869 | 0.0038573 | **0.9899** | 0.6172 | 50.5 |

- **Best value:** `stars_hoard` — $0.9899/pull std, $0.0061869/Star std.
- **Value curve is now strictly monotonic.** Ranked by $/Star std (lower =
  better): handful `0.0081667` → pouch `0.0075455` → bag `0.0068716` → chest
  `0.0066920` → vault `0.0064407` → hoard `0.0061869` — **strictly decreasing
  with bundle size** (verified by `node`). `$/pull std` decreases in lockstep
  (`1.3067 → 0.9899`). Small SKUs are a genuine convenience premium (handful
  costs **1.32×** hoard's per-Star rate), bulk is a real discount. The old
  low-end inversion is gone. Fleet-average $/Star std ≈ **0.0069839**.
- **First-time $/Star is NOT strictly monotonic** (minor): because double-raw
  *replaces* the standard bonus, and the standard bonus is a different fraction
  of raw at each tier, first-time $/Star wobbles (`0.0040833` handful,
  `0.0041500` pouch, `0.0038214` bag, `0.0037854` chest, `0.0038095` vault,
  `0.0038573` hoard). Not a defect — an artifact of mirroring Genshin's own
  per-tier bonus schedule. First purchases still roughly halve $/Star vs standard.
- **No intrinsic 10-pull discount.** `tenPullCost 1600 = 10 × singlePullCost
  160` exactly. All "discount" lives in the first-time double-raw and bundle
  scaling, not in the 10-pull mechanic. State this so nobody expects a cheaper
  per-pull on 10-pulls.
- **Fractional pulls per SKU are inherent to Genshin's amounts at 160/pull.**
  Only chest lands clean (`2240 / 160 = 14.0` pulls). handful `0.375`, pouch
  `2.0625`, bag `6.8125`, vault `24.25`, hoard `50.5` all strand a partial pull
  of Star balance. This is a direct consequence of using Genshin's exact Genesis
  Crystal amounts — not a math error, just carried-over remainder Stars.

### 2.1 (Superseded) Low-end value inversion
The prior draft's lineup (`160/800/1600/3360/8640/17600` base Stars at
`$0.99/$4.99/$9.99/$19.99/$49.99/$99.99`) was non-monotonic: the $9.99 bag was
the worst $/Star and ten $0.99 handfuls beat it. **That analysis is superseded**
— the PO-locked lineup above is strictly monotonic in $/Star std, so the
inversion no longer exists. Kept only as a pointer for anyone diffing older revs.

### 2.2 (Superseded) Monotonic alternative
The prior draft proposed a hand-tuned monotonic alternative
(`140/760/1600/3400/8800/18000`). **Superseded and moot:** the locked lineup is
already strictly monotonic (§2 verified by `node`), so no alternative is needed.

---

## 3. Lunar Pass subscription (Genshin "Welkin" model)

A monthly recurring subscription for **retention + predictable MRR +
convenience**. It is a **separate monetization lever from the bundles and is NOT
the value anchor** (see §3.2).

### 3.1 Offer (LOCKED)
- **$2.99 / month (LOCKED, PO 2026-07-22):** **300 Stars on purchase** + **90
  Stars/day × 30** (claimed on login) = **3,000 Stars/month = 18.75 pulls**.
  Effective **$0.0009967/Star** ($0.1595/pull-equivalent). Contents unchanged
  from the prior draft; only the price is locked ($4.99 → $2.99).

### 3.2 Cheap-base compression (why it is NOT the value anchor)
Because our base Stars are already ~**$0.0062–0.0082/Star** (roughly **half**,
~50%, of Genshin's price — identical Star amounts at half the USD ladder), the
sub does **not** open the ~7.4× gap Genshin's Welkin has over its own best bulk
(Welkin $0.00166/primo vs Genshin's $99.99/8080 = $0.01238/crystal; the figure
only reaches ~9.9× against Genshin's worst $0.99/60 tier, not its bulk). At the
**locked $2.99/mo** the sub is **~6.2×** better than
our best-value à-la-carte bulk (hoard std $0.0061869/Star) and **~6.9×** vs the
bag anchor ($0.0068716/Star) — dramatic, but a cheap base still **compresses**
the sub's relative headroom vs Genshin. So its role is **retention + predictable
MRR + convenience**, not a headline discount.
- **Locked decision (was the tunable lever):** the prior draft flagged
  $2.99/mo as a lever that "trades against cannibalizing bundle sales." The PO
  has **locked $2.99/mo**. The cannibalization risk it named is now a modeling
  item, not a price question — **model sub-holder vs bundle-buyer LTV** with the
  price fixed.

### 3.3 Implementation
- A **subscription-status flag** flipped by an **Xsolla RECURRING-billing
  webhook**, plus a **daily-claim faucet gated on that flag**, riding the
  existing `earned_reward_program` rail (§4).
- **New plumbing beyond what #174 deployed:** recurring subscription webhook
  events (renew / cancel / grace / dunning), on top of the one-time
  payment/refund path already in `0013` and the deployed `xsolla-webhook` edge
  function.

### 3.4 Compliance (SEPARATE from the #154 loot-box gate)
Auto-renewal law is its own gate, independent of loot-box legality: auto-renewal
**disclosure** (California ARL, EU rules), **frictionless cancellation**, and
**clear renewal terms**. Xsolla Pay Station supports recurring billing. This
must be satisfied even if #154 loot-box review is still open.

### 3.5 Ethic flag — daily-claim hook vs "no streak-loss trap"
The **claim-on-login-or-lose-it** daily accrual **conflicts with the free-faucet
"no streak-loss trap" ethic** (`streakLoss: false` everywhere in §4). For a
**paid** sub it is more defensible (Genshin does exactly this), but **call it
deliberately**:
- **Daily pressure** (claim-or-lose): stronger retention hook, mild dark-pattern.
- **Auto-accrue / claim-anytime**: friendlier, weaker hook, consistent with the
  free-faucet ethic.

### 3.6 Gate
**#154** (paid premium currency credited into the paid Stars bucket) **AND**
**subscription-law** (auto-renewal disclosure + cancellation). Both must clear
before launch.

---

## 4. Faucet strategy (map to the existing `earned_reward_program` scaffold)

All faucets already have scaffolding in `0009`/`0010`
(`earned_reward_program_versions`, `earned_reward_program_items`,
`authoritative_roll_completion_events`, `earned_reward_passport_enrollments`,
`earned_reward_claim_outcomes`) and the production edition
`0001-earned-collection.json`. **No-streak-loss ethic** and **UTC-Monday
periods** are already encoded (`streakLoss:false`, `missedDayPenalty:false`).

| Faucet | Existing scaffold | Grants | Notes |
|---|---|---|---|
| Daily login (banked) | `freeCadence.dailyBank` (7-day capacity, oldest-first, no streak loss) | 160 promo Stars/day = **1 standard_roll/day** | already in both editions |
| Weekly flexible bonus | `freeCadence.weeklyFlexibleBonus` | 480 promo Stars | already present |
| Weekly Star budget | `freeCadence.weeklyStarBudget` = 1600/wk | **10 standard_roll/wk** budget | matches `check:economy-simulations` model |
| Roll-completion reward | `0010 authoritative_roll_completion_events` + `rewards.weeklyAuthoritativeRolls` (10 rolls × 160, cap 1600/wk) | promo Stars → standard_roll | server-authoritative only; no streak loss |
| New-collector passport | `0010 passport_enrollments` + `rewards.newCollectorPassport` (12 wk × 1 unowned standard) | named standard dice | bounded, `no-item`/Dust when exhausted |
| Community die | `rewards.communityDie` (every 4 wk) | mythic direct claim → Dust when owned | direct-claim, outside random |

**Revenue dial via faucets:** faucets feed **standard_roll** (and promotional
Stars) generously — standard-banner acquisition is meant to feel free.
**premium_roll is deliberately NOT a general faucet reward**; it drips only from
purchase bonuses, occasional events, and player-directed Stars→premium_roll
conversion (any bucket, 160:1). Because conversion is unlocked, premium scarcity
is dialed by **Star income rate**, not by a conversion lockout — that rate, not
per-pull price, is what makes PREMIUM banners the money path. Minigame faucets
are **explicitly deferred** (out of scope here).

---

## 5. Gacha math validation

### 5.1 Method (simulated, not hand-waved)
The repo's economy simulator (`scripts/economy-simulator.js`) exports the exact
pity-resolution engine used by the frozen `candidate-a-vs-collection-first@1`
study: `createSeededRng`, `candidateBProfile`, `drawBaseResult`,
`initialCandidateBState`, `resolveCandidateBPull`. The simulator **CLI**
(`--check`/`--write-new`) is hard-locked to that frozen schema
(`validateCandidateB` pins pity to 8/25/20 and the tier names), so a **new**
premium banner cannot flow through the CLI. Per the task's "minimally-adapted
copy" allowance, a driver
(`economy/drafts/monetization/simulate-premium-pity.mjs`) **imports those exact
primitives** and drives them with candidate premium-banner configs. No engine
math is re-implemented — only the banner config, the percentile loop, and a
**design-simulation soft-pity ramp layer** (§5.5) that wraps the injected `draw`
parameter of `resolveCandidateBPull`.

**Commands run (exact):**
```
$ node scripts/economy-simulator.js --check
Verified 1 immutable economy simulation scenario(s)        # exit 0

$ node economy/drafts/monetization/simulate-premium-pity.mjs
trials per variant: 200000
```
Cross-check against the repo's OWN frozen report
(`economy/simulations/reports/0001-candidate-a-vs-collection-first.json`,
candidate B, featured hard pity **20**, ~1% signature, produced by
`npm run check:economy-simulations`): `expectedFirstAwardPullsMilli 19681`
(mean **19.68** pulls), `selectedCost {expected 3149, p50 3200, p90 3200, cap
3200}` (p50=p90=cap=hard pity), and `resolutionCounts.selected-guarantee 48372 /
50000 = 96.7%` of trials hit hard pity. That frozen result independently
demonstrates the flat-ceiling behaviour that motivated the soft-pity decision.

### 5.2 (Historical / superseded) No-soft-pity distribution (200,000 trials each)
> **Historical context.** These rows describe the engine's **current**
> no-soft-pity behaviour and the depth sweep that motivated Finding 1. They are
> **superseded** by the accepted soft-pity ramp (§5.5) for the recommended
> design, but remain reproducible from the same driver (the `soft = none` rows).

Config: featured die = sole signature-tier item (rate-up); rare hard pity 10,
epic hard pity 30; **no soft pity** (engine has none). Full output saved to
`economy/drafts/monetization/premium-pity-sim-output.txt`.

| Variant | featured base | hard pity | mean | p50 | p90 | p99 | max | % hit hard pity |
|---|---|---|---|---|---|---|---|---|
| **A** shallow (PO concern) | 0.60% | 25 | 23.16 | 25 | 25 | 25 | 25 | **85.3%** |
| B | 0.60% | 50 | 42.05 | 50 | 50 | 50 | 50 | 68.0% |
| C | 0.60% | 70 | 54.49 | 70 | 70 | 70 | 70 | 57.1% |
| **E** hard 75 baseline | 0.60% | **75** | 57.34 | 75 | 75 | 75 | 75 | 54.9% |
| D deep | 0.60% | 90 | 64.85 | 85 | 90 | 90 | 90 | 48.0% |
| F higher rate-up | 1.00% | 75 | 48.93 | **54** | 75 | 75 | 75 | 37.2% |

Simulated means match the closed-form truncated-geometric
`E[pulls]=(1−(1−p)^N)/p` within noise (A: 23.16 sim vs 23.3 analytic; %hard-pity
is slightly below `(1−p)^(N−1)` because epic/rare guarantee draws occasionally
land the signature die). **Structural finding that drove the soft-pity decision:**
at a 0.6% rate-up with **no soft pity**, `p50 = p90 = p99 = hard pity` for every
depth ≤ 75 — the cost is **near-deterministic at the ceiling**, not a
distribution with a tail. Only raising the base rate to ~1.0% (variant F) pulls
the median (54) off the ceiling. Rather than raise the base rate, the PO accepted
a soft-pity ramp (§5.5), which shapes the tail while keeping the 0.6% base.

### 5.3 Dollar-outcome table (soft-pity variants, new pricing)
Anchor per-pull rates on the §2 locked lineup: **std anchor $1.0994/pull** (bag),
**first-time double-raw $0.6114/pull** (bag first purchase), **best-value floor
$0.9899/pull** (hoard). Because the recommended design now has a soft-pity ramp,
the meaningful figures are the **mean** and **p50** (a real distribution), with
the **hard-75 ceiling** (`75 × 160 = 12000` Stars) as the tail cap.

| Variant | mean pulls | $ mean (std) | $ mean (1st) | $ mean (best) | p50 | $ p50 (std) | $ p50 (1st) | $ p50 (best) |
|---|---|---|---|---|---|---|---|---|
| no-soft (E, hard 75) | 57.34 | $63.04 | $35.06 | $56.76 | 75 | $82.46 | $45.86 | $74.24 |
| **soft +0.5%/pull (recommended)** | **46.58** | **$51.21** | **$28.48** | **$46.11** | **51** | **$56.07** | **$31.18** | **$50.48** |
| soft +1%/pull | 43.41 | $47.73 | $26.54 | $42.97 | 48 | $52.77 | $29.35 | $47.52 |
| soft +2%/pull | 41.01 | $45.09 | $25.07 | $40.60 | 46 | $50.57 | $28.13 | $45.54 |
| soft +3%/pull | 39.92 | $43.89 | $24.41 | $39.52 | 45 | $49.48 | $27.51 | $44.55 |

Hard-75 ceiling in dollars (the tail cap, `12000` Stars): **$82.46 std / $45.86
first-time / $74.24 best-value**. Under the recommended +0.5%/pull ramp only
~2.2% of players reach it; under steeper ramps essentially nobody does.

### 5.4 Whale-ceiling analysis & DECISIONS
**The flat-ceiling concern was confirmed by simulation, and the fixes are now
decisions.** Under the old **hard pity 25 + no soft pity**, the whale ceiling for
one featured die was **~$27 std / ~$15 first-time / ~$25 best-value**, and
because there was no soft pity **85% of players paid exactly that ceiling** — a
fixed price, not a gamble (a single $24.99 vault, 3880 Stars = 24.25 pulls, plus
loose change guaranteed the die). That is no meaningful whale ceiling.

**DECISIONS (backed by §5.2/§5.3/§5.5 numbers):**
1. **Hard pity 75 is LOCKED.** Ceiling = `75 × 160 = 12000` Stars ≈ **$82.46 std
   / $74.24 best-value / $45.86 first-time** — ~3× the shallow-25 ceiling,
   meaningful for a premium/collab tier, still well under predatory. Draft
   config: `economy/drafts/monetization/premium-featured-rate-up.draft.json`.
   For comparison, Genshin's 90-pull hard pity at ~$2/pull is a ~$180 ceiling (up
   to ~$360 with 50/50); our std ceiling is **~2.2× cheaper** and our best-value
   ceiling **~2.4× cheaper**, and with soft pity most players land well below it.
2. **Soft pity is ACCEPTED (engine change) — recommend +0.5%/pull from pull 41.**
   This is no longer a "structural caveat"; it is a **PO-accepted engine change**
   to dicesuki-core / the `0011` pull policy + contracts (§6 delta 9). It turns
   the flat wall into a real spend **curve** with a tail: p50 ≈ 51 (~$56 std /
   ~$50 best-value / ~$31 first-time), mean ≈ 46.6 pulls (~$51 std), and only
   **~2.2%** of players reach the hard-75 ceiling. Full slope sweep and rationale
   in §5.5.
3. **Keep STANDARD banners shallow (25–40) and generous**, funded by promotional
   Stars and `standard_roll` faucets. Premium depth + `premium_roll` scarcity (by
   Star income rate) is the revenue dial; standard stays the free funnel.
4. **Keep featured base rate ~0.6%.** The soft-pity ramp — not a higher base rate
   — now provides the median-off-the-ceiling delight, so the base stays 0.6% for
   predictable disclosure and ARPPU. (Historical variant F at 1.0% is retained in
   §5.2 for comparison only.)
5. **Banner cadence:** rotate the premium featured die every **2–3 weeks**
   (aligns with the existing 4-week community/mythic cadence), **1 featured
   signature die per banner**. An engaged whale chasing each rotation at a
   ~$28–56 median (soft +0.5%) is a sustainable recurring chase; collectors skip
   rotations they don't want.

### 5.5 Soft-pity simulation (design-sim of the accepted engine change)
**Honesty note.** When this driver was written the `0011` pull policy had **no
soft-pity ramp** (`softPity: 'none'` was the only contract value). The **driver**
(`simulate-premium-pity.mjs`) still models the ramp **externally** and leaves the
engine contract field untouched — its `selectedFeaturedUnowned` carries
`softPity: 'none'`. (The engine has since gained **dormant** native ramp support
in `0018` — §6 delta 9 — but the sizing sim below intentionally does not depend
on it.) The
**draft banner JSON**, by contrast, **does not** leave the field alone: it
carries the populated **design-target**
`softPity` object (`{model, startPull, perPullIncrement, baseFeaturedRate}` — see
the paragraph below and §6 delta 9). The driver models the **accepted
future** ramp **outside** the engine: it wraps the `draw` parameter that
`resolveCandidateBPull` already accepts, and — based on the live candidate-B
featured-pity counter (`state.selectedMisses`) — upgrades the draw to the
featured signature result with the ramp probability, otherwise delegating to the
real `drawBaseResult`. The 75-pull hard guarantee is untouched
(`resolveCandidateBPull` still fires `selected-guarantee` at attempt 75 without
ever calling `draw`). This is a **design-simulation to size the slope**, not
engine parity; the engine change itself is §6 delta 9.

**Ramp model (linear rate ramp).** Featured rate holds at the base **0.6%** for
pulls `1..40`; from pull **41** (`softPityStart`) it becomes
`min(1, 0.006 + increment × (n − 41 + 1))`; hard guarantee at **75** unchanged.
The wrapper injects only the *excess* above base so the effective featured rate
equals the ramp target exactly. Slope sweep at **200,000 trials each**
(rare hard 10 / epic hard 30 / sig hard 75 / base 0.6% / softPityStart 41):

| Ramp (per-pull, start 41) | mean | p50 | p90 | p99 | max | % hit hard-75 | mean Stars |
|---|---|---|---|---|---|---|---|
| **no soft pity (baseline E)** | 57.34 | 75 | 75 | 75 | 75 | **54.9%** | 9,175 |
| **+0.5%/pull (RECOMMENDED)** | **46.58** | **51** | **66** | **75** | **75** | **2.2%** | **7,453** |
| +1%/pull | 43.41 | 48 | 59 | 67 | 75 | 0.1% | 6,946 |
| +2%/pull | 41.01 | 46 | 53 | 59 | 70 | 0.0% | 6,562 |
| +3%/pull | 39.92 | 45 | 51 | 55 | 65 | 0.0% | 6,388 |

**Recommendation: +0.5%/pull from pull 41.** Criteria and how it scores:
- **p50 meaningfully below 75:** ✓ p50 = **51** (all ramps clear this; even the
  shallowest ramp moves the median 24 pulls off the ceiling).
- **% hitting hard pity in low single digits (or below ~15%):** ✓ **2.2%** — low
  single digits, and crucially **still nonzero**: a small tail (p99 = 75) still
  pays the full ceiling, so it is a **curve with a ceiling**, not a wall (old
  design) and not a collapse (steeper ramps push % to ~0 and p99 down to 55–67,
  erasing the whale tail entirely).
- **Mean pulls not collapsing so far the premium chase loses revenue value:** ✓
  +0.5% keeps the **highest mean of the four ramps** (46.58 pulls ≈ 7,453 Stars ≈
  **$51 std / $46 best-value / $28 first-time**). +2% and +3% shave the mean a
  further ~10–15% and flatten the distribution, giving up revenue for marginal
  extra "delight."
- **Slope stays PO-tunable:** ✓ `perPullIncrement` is a single config number; the
  final value is a tuning decision (§7) — +1%/pull is the reasonable next step up
  if playtest sentiment wants a softer chase.

The recommended ramp is written into the draft banner JSON as the design-target
`softPity` object (`{model:"linear-rate-ramp", startPull:41, perPullIncrement:
0.005}`), explicitly marked as the design target while the engine still has none.

---

## 6. Schema / engine deltas required

Ordered; each marked **[free]** (may ship pre-#154) or **[#154]** (legal-gated,
real-money randomization). This is the delta list the migration set implements.

> **Implemented-state note (2026-07-23).** The engine-side slices have landed in
> the `slice1-roll-tickets` PR chain (not yet merged to `main`), all **dormant /
> free-tier**: **`0014`** = delta #2 (roll-ticket ledger); **`0015`** = delta #3
> standard binding with **reservation** (not prepare-time debit) funding;
> **`0016`** = delta #4 free (Stars→`standard_roll` 160:1); **`0017`** = the
> commit/reveal terminal boundary ADR 016 deferred (real debit at commit,
> entitlement grant, duplicate→Dust, sha256 commit-reveal seed disclosure);
> **`0018`** = delta #9 soft-pity ramp implemented **dormant**. Deltas that are
> still unimplemented (paid bucket, fulfill currency-credit, SKUs, premium data
> rows) and the discrete-copy rework (deltas #10–14 below) remain to do.

1. **[#154] Enable `(stars, paid)` balances.** Extend the `0009`
   `wallet_balances_currency_bucket_pair` **and** the ledger append boundary
   (`wallet_ledger_entries` pair rule + `record_*` SECURITY DEFINER path)
   *together* to admit `stars/paid`. Today they fail closed; `0013` only widened
   the bucket domain, not the currency-bucket pair.
2. **[free] `standard_roll` / `premium_roll` ticket item types.** ✅ **IMPLEMENTED
   dormant — `0014_roll_ticket_ledger.sql`.** A durable per-user roll balance
   (`roll_ticket_balances`) plus append-only `roll_ticket_ledger_entries` with
   no-negative guarantees and a service-role-only record function, mirroring
   `wallet_ledger_entries`. Both roll types exist; no banner funds a ticket yet.
3. **[free/#154] Banner→roll-type binding.** ✅ **Standard IMPLEMENTED —
   `0015_banner_roll_type_binding.sql`.** Adds `roll_type`
   (`standard_roll` | `premium_roll`) + `banner_class` (`standard` | `premium`)
   to `pull_banner_versions`; ticket-funded preparation uses **reservation
   semantics** (available = ticket balance − live same-type holds; the real debit
   is the `0017` commit boundary, not prepare time). Standard binding **[free]**,
   done; premium binding & its random reveal path **[#154]**, fail-closed.
4. **[free] Stars→standard_roll conversion RPC** ✅ **IMPLEMENTED —
   `0016_stars_to_standard_roll_conversion.sql`** (160 Stars → 1 standard_roll,
   SECURITY DEFINER, promotional bucket, idempotent). **[#154] Stars→premium_roll
   conversion RPC** — accepts **any Stars bucket** at 160:1 (Genshin model, no
   bucket lockout — PO 2026-07-22); ships behind #154 because it feeds the
   premium random path (not yet built). The old "can Stars convert to
   premium_roll at all" dial is **retired**: conversion is always allowed, and
   premium scarcity is dialed by Star income rate instead.
5. **[#154] `fulfill_payment_order` currency-credit branch.** Today
   `fulfill_payment_order` grants an **entitlement only**. Add a branch: when the
   order's SKU is a **Star bundle** (new non-die SKU class), credit
   `base_stars` (+ first-time double-raw bonus) into the **paid** Stars bucket via
   the ledger boundary, instead of granting a die. Requires delta #1.
6. **[#154] First-time-bonus per-user-per-SKU tracking.** New table (e.g.
   `star_bundle_first_purchase(user_id, sku)` unique) consulted inside the fulfill
   currency-credit branch so the **double-raw** bonus is granted **exactly once
   per user per SKU**; refunds must reverse both the credit and the first-time
   flag (see §7 — refund semantics under double-raw need a precise rule).
7. **[#154] Star-bundle & roll-bundle SKUs.** `payment_orders.catalog_item_id`
   currently FKs `catalog_items` (dice). Introduce a SKU/product registry for
   non-die products (Star bundles, direct roll bundles) with price/raw/bonus, so
   fulfill can dispatch die-entitlement vs currency-credit vs roll-credit.
8. **[#154] Premium banner data rows.** The recommended banner
   (`premium-featured-rate-up`, hard pity 75, 0.6% rate-up) becomes real
   `pull_banner_families` / `pull_banner_versions` / `pull_banner_tiers` rows
   referencing real catalog ids — **data**, not schema, but gated with the
   premium random path.
9. **[free-dormant / #154-activate] Soft-pity ramp support in dicesuki-core / the
   `0011` pull policy + contracts.** ✅ **IMPLEMENTED dormant —
   `0018_soft_pity_ramp.sql`** (+ `scripts/economy-simulator.js`,
   `scripts/validate-production-economy.js`, `src/types/gacha.ts`). PO-accepted
   (2026-07-22). Replaces the `softPity: 'none'` contract field with a structured
   ramp (`{model, startPull, perPullIncrement, baseFeaturedRate}`) and implements
   the linear rate ramp in the pull-resolution engine; both validators derive and
   drift-check `baseFeaturedRate` from tier weights. Enabled on **no** banner;
   **activation rides the premium random path gate** (delta #3/#8). Recommended
   slope +0.5%/pull from pull 41 (§5.5), left PO-tunable.

### 6.1 Discrete-dice-copy inventory deltas — NEW (decision 5, PO 2026-07-23)

These rework ownership from an entitlement boolean to a live copy count (§1.6).
None are implemented yet; they are the next slice set and supersede `0017`'s
Dust-only duplicate path.

10. **[free-dormant] Discrete dice-copy inventory table.** Add a per-user
    **discrete copy** inventory (e.g. `dice_copies`), one row per unique spawnable
    copy keyed by owner + catalog die, replacing the `user_entitlements` boolean
    as ownership truth for pull grants. **Ownership = live copy count.** Mirrors
    the append-only / no-negative discipline of the ledgers; derives the
    **first-copy flag** (an **ever-owned latch** persisted per catalog die — §1.6;
    **not** a zero-to-one live-count transition, so it does not re-fire after
    scrap-all) for the brand-new-die UI, and feeds simultaneous spawn of matched
    sets.
11. **[free-dormant] Commit-grant rework (supersede `0017` Dust-only dupe path).**
    Append a migration so the committed reveal grants a duplicate **another copy
    PLUS the tier's Dust** (not Dust-only), a non-duplicate additionally sets the
    first-copy flag (**ever-owned latch**, §1.6 — MUST NOT re-latch on a re-pull
    after scrap-all), and `is_duplicate` / selected-featured-**unowned** resolve
    against **live copy count** (unowned = zero copies) instead of
    `user_entitlements`. The tier's `dupe_dust` is **not** settled here: because
    the granted copy is immediately scrappable, the effective per-duplicate Dust
    is `dupe_dust + scrap_dust`, so `dupe_dust` MUST be re-sized jointly with
    scrap and craft (§7 three-way validation) before this freezes. Does **not**
    mutate `0017` (append-only).
12. **[free] Scrap RPC.** `scrap_dice_copy` (SECURITY DEFINER, self-only,
    idempotent): removes one live copy and credits **per-tier Dust** through the
    wallet ledger boundary. Any die scrappable. Per-tier scrap yields are a §7
    open question (economy-sim sized).
13. **[free] Craft / duplicate RPC.** `craft_dice_copy` (SECURITY DEFINER,
    self-only, idempotent): debits **Dust** and grants **one additional copy** of
    a die. Working assumption: **restricted to already-owned dice** (§7). Craft
    cost MUST exceed the **Dust-equivalent acquisition cost of a copy of THAT die
    on its native banner** (premium copies priced against premium-pull cost),
    accounting for Dust fungibility across banners — not merely the Dust yield of
    the cheapest farmable pulls (anti-arbitrage reframed for the owned-only,
    fungible-Dust world; §7).
14. **[harness] Live-DB migration test harness slice.** A pglite/pgTAP-style
    disposable-Postgres harness that **applies** the money-path migrations and
    proves funding, grant, scrap, craft, and no-double-count behavior at runtime.
    **Static regex tests are not sufficient for money-path migrations** (PO
    2026-07-23); this harness precedes or accompanies deltas #10–13.

---

## 7. Open questions / decisions to lock before ADR
- **Disjoint pools (still open, recommended).** Premium featured value must
  exceed or be exclusive of the direct-purchase collab price (#153) to avoid a
  ~$74–82 gacha ceiling competing with a fixed-price collab. Recommend disjoint
  pools (gacha = rotating exclusive; direct = permanent).
- **Soft-pity slope final tuning.** +0.5%/pull is recommended (§5.5); the final
  `perPullIncrement` (and whether `startPull` stays at 41) is a playtest/LTV
  tuning decision. Lock the slope before **§6 delta #8 (premium-banner data
  rows)** freeze the disclosure numbers — the delta-9 engine already landed
  **dormant** (`0018`) and is **slope-agnostic** (nullable `soft_pity_*` columns,
  no baked-in slope), so the freeze happens when a specific slope is written into
  a live premium banner data row, not at the delta-9 engine work.
- **First-time-bonus refund semantics under the double-raw model.** A refund of a
  first purchase must reverse both the credited Stars **and** the
  `star_bundle_first_purchase` flag — but define precisely what happens if the
  player already **spent** the doubled Stars (claw back to negative? block refund?
  net against balance?), and whether a re-purchase after refund re-grants
  double-raw. Needed before the fulfill/refund branch (§6 delta 5/6) is written.
- **Scrap-then-refund / chargeback of a granted copy — NEW.** Copy-count
  ownership adds a player-controlled decrement (scrap) that the "reduces the
  asymmetry" note (§1.6) does not fully cover. Define what happens when a player
  **scraps** (or **crafts-consumes**) a copy that a purchase or pull granted and
  the granting purchase is then **refunded or charged back**: is the scrap Dust
  clawed back, does the reversal decrement **clamp at zero**, and how does an
  **involuntary** chargeback reconcile when the granted copy no longer exists
  (the money leaves regardless — it cannot simply "fail closed")? This is
  distinct from the STAR-bundle double-raw claw-back above (currency, not a
  granted copy). Needed before deltas #10–13 and the refund path freeze.
- **Duplicate-Dust, scrap yields & craft costs (economy-sim validation required)
  — NEW.** Per-tier **duplicate Dust** (`dupe_dust`, currently 2/8/20/50),
  **scrap Dust values**, and **craft Dust costs** MUST be sized by the economy
  simulator, not hand-picked, and validated **together** — a **three-way** joint
  validation, not the two-way scrap+craft pair. A granted duplicate copy is
  itself immediately scrappable, so the effective Dust from one duplicate is
  `dupe_dust + scrap_dust` (roughly double the transitional `0017` Dust-only
  yield the pity/whale sims were implicitly calibrated against); options include
  `dupe_dust = 0` with Dust coming only from an explicit scrap, or a documented
  reduction, so a dupe does not silently double the faucet vs the `0017`
  baseline.
- **Craft-cost anti-arbitrage bound (owned-only world) — NEW.** Because crafting
  is **owned-only** (below), it structurally cannot mint a *first* copy of an
  unowned die, so the old "farm cheap pulls → scrap junk → craft the wanted
  (unowned) die" framing does **not** apply — that loop cannot occur, so drop it.
  The real, unbounded loop is **cross-banner matched sets**: Dust is one fungible
  earned-bucket currency, so cheap standard-banner-farmed Dust could craft
  additional copies of an **expensive premium/signature die you already own**,
  undercutting premium pulls. The bound MUST therefore be: the craft cost of a
  die MUST **exceed the Dust-equivalent acquisition cost of a copy of THAT die on
  its NATIVE banner** (a premium copy priced against premium-pull cost),
  accounting for Dust fungibility across banners — **not** merely the Dust yield
  of the cheapest pulls that could farm the Dust. Size `dupe_dust`-per-tier,
  scrap-per-tier, and craft-per-die as one jointly-validated set before deltas
  #10–13 freeze.
- **Crafting scope (working assumption: owned-only) — NEW.** The PO said players
  "craft or duplicate dice they already have," so **owned-only** is the working
  assumption (a player can duplicate a die they hold ≥1 live copy of, but Dust
  cannot mint a die they have never owned). Confirm whether that restriction
  holds — recommend keeping it, so the gacha/collab rails remain the only way to
  *first* obtain a die and Dust only multiplies what you own.

> **Resolved since the prior draft (no longer open):** soft-pity ramp (PO
> accepted, §5.5/§6 delta 9, now implemented dormant in `0018`);
> Stars→premium_roll conversion (allowed from any bucket, 160:1, §1.4/§1.5/§6
> delta 4); duplicate-conversion currency (**Dust**, §1.2); **discrete-copy
> ownership** (PO 2026-07-23, §1.6) — which **reduces** the revoked-entitlement
> asymmetry flagged in ADR 014 / slice-4 review (a refund/chargeback decrements a
> countable balance instead of risking deletion of an independently earned
> grant), but does **not** fully resolve it: scrap adds a new player-controlled
> decrement, so **scrap-then-refund / chargeback of a granted copy remains an
> open rule** (§7).

---

## 8. Files in this draft
- `docs/exec-plans/active/2026-07-22-monetization-economy-spec.md` (this doc)
- `economy/drafts/monetization/premium-featured-rate-up.draft.json` (draft
  premium banner, edition-JSON shape, hard pity 75 LOCKED / 0.6% rate-up /
  design-target soft-pity ramp +0.5%/pull from pull 41)
- `economy/drafts/monetization/simulate-premium-pity.mjs` (driver reusing the
  repo's exported pity engine; now includes the **design-simulation soft-pity
  ramp layer** that wraps the injected `draw` — models the accepted engine
  change, does not touch engine math)
- `economy/drafts/monetization/premium-pity-sim-output.txt` (captured 200k-trial
  output: 6 historical no-soft-pity rows + 4 soft-pity ramp rows)

**Reproduce:**
```
node scripts/economy-simulator.js --check                       # repo harness, exit 0
node economy/drafts/monetization/simulate-premium-pity.mjs      # premium variants, 200k trials
                                                                # (no-soft-pity baseline + soft-pity ramp sweep)
```

> The design-draft files above (banner JSON, simulator driver, captured output)
> remain uncommitted working-tree artifacts. The design is now formalized by
> **[ADR 017](../../adrs/shared/017-monetization-economy-architecture.md)**
> (authored alongside this doc). The engine-side migrations **`0014`–`0018`** are
> implemented in the separate `slice1-roll-tickets` PR chain (dormant /
> free-tier, not yet merged to `main`); no paid bucket, premium random reveal,
> Stars→`premium_roll` conversion, or soft-pity activation ships until #154, and
> no existing economy edition was modified.
