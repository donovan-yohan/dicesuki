# Dust Economy Simulation Report — Rev 2

Status: **PROPOSED / PO pending** sizing for the draft discrete-copy economy.
This is simulation-only design evidence; it does not activate production
monetization.

Provenance: Model: `gpt-5.6-sol`; reasoning effort: `high`.

## Recommendation

| tier | `dupe_dust` | `scrap_yield` | `craft_cost` | effective duplicate Dust |
|---|---:|---:|---:|---:|
| standard | 1 | 1 | 210 | 2 |
| rare | 4 | 4 | 220 | 8 |
| epic | 10 | 10 | 615 | 20 |
| signature | 25 | 25 | 2500 | 50 |
| mythic community direct-claim | n/a | 50 | n/a | n/a |

The four pull-pool tiers are unchanged from rev 1. Splitting the transitional
2/8/20/50 duplicate-Dust table evenly between automatic duplicate Dust and
scrap preserves the same effective duplicate faucet instead of doubling it.

The community die is a direct mythic claim every four weeks, outside the random
pool. Recommend `mythic scrap_yield = 50`: the claim→scrap→reclaim loop is
therefore capped at `50 / 4 = 12.5 Dust/week`, exactly the accelerator already
modeled by rev 1 and no higher. Mythic crafting is not proposed.

## Rev 2 statistical-audit corrections

- **Removed the biased `P_late` estimator.** Rev 1 used each collector's first
  300 pulls after collection completion. Completion arrives through an
  epic-or-better award that resets `epicMisses`, so those tails begin
  pity-drained. Rev 2 uses an independent 24,000,000-pull all-owned stream,
  starting from the engine's normal initial pity counters and never conditioned
  on collection completion.
- **Swept the dynamic farm trigger.** Rev 1 tested only hard-1. Rev 2 measures
  triggers 19, 25, 20, 21, 30, 40, and 60, adopts the maximum, and adds an
  independent 10,000,000-pull trigger-19 validation stream.
- **Added uncertainty to every stochastic bound.** Dust rates use batch-means
  SE over 10,000-pull batches. Each `P_late[t]` SE is the larger of its
  batch-means and binomial SE. Native-floor SE propagates the independent
  `D_FARM_MAX` and `P_late[t]` uncertainty. Every stochastic binding margin
  exceeds 3 SE.
- **Corrected the dominance explanation.** Trigger 19 forces a rank-3 signature
  every 20 pulls, resetting `epicMisses`; epic pity is suppressed. The
  duplicate-award stream averages about 4.72 Dust per duplicate pull
  (4.49 per total pull). The uplift comes from the 25-Dust signature scrap each
  cycle, not from preserved epic-duplicate Dust.

## Rev 1 audit trail retained

Rev 1 correctly replaced the base-weight pure-scrapper shortcut with the exact
engine, relabeled the all-owned result as a conditional comparator rather than
a global maximum, made native parity strict, priced signature against both its
specific-copy standard rate and premium hard-75 chase, and added fixed-owned
plus dynamic selected-pity farms. It also established the still-recommended
1/4/10/25 duplicate Dust, 1/4/10/25 scrap, and 210/220/615/2500 craft values.

Rev 1's reported `P_late`, `D_ALL_DUPE`, `D_FARM_MAX`, and native floors are
superseded by the rev 2 values below. The following underlying evidence remains
valid:

- The driver imports the production engine's `createSeededRng`,
  `candidateBProfile`, `drawBaseResult`, `initialCandidateBState`, and
  `resolveCandidateBPull`; it does not reimplement pull or pity math.
- The profile is built from
  `economy/production/editions/0001-earned-collection.json`, retaining the real
  72/23/4/1 weights, 24/9/6/6 pool sizes, and 8/25/20 guarantees.
- Collector ownership evolves by catalog id, so duplicate probability is
  measured by collection state and tier instead of supplied as a flat rate.
- Double-dip accounting, fixed seeds, and the 10-standard-pulls/week free
  faucet remain unchanged.

## Corrected equilibrium estimator

The independent all-owned stream measures:

| tier | `P_late` | conservative SE |
|---|---:|---:|
| standard | 0.687586 | 0.000095 |
| rare | 0.241262 | 0.000087 |
| epic | 0.056924 | 0.000047 |
| signature | 0.014228 | 0.000024 |

With effective duplicate Dust `(2, 8, 20, 50)`:

`D_ALL_DUPE = 5.155151 ± 0.001042 SE Dust/pull`.

This is the required all-owned/all-duplicate pace comparator. It is not the
anti-arbitrage maximum.

## Trigger sweep and `D_FARM_MAX`

The dynamic strategy stays fully owned until `selectedMisses` reaches the
trigger, scraps one signature for 25 Dust, takes and keeps the guaranteed
replacement, then resumes scrapping surplus duplicates.

| trigger | pulls | Dust/pull | batch-means SE |
|---:|---:|---:|---:|
| 19 | 2,000,000 | 5.7399690 | 0.0043842 |
| 25 | 2,000,000 | 5.7367205 | 0.0033239 |
| 20 | 2,000,000 | 5.6961890 | 0.0043774 |
| 21 | 2,000,000 | 5.6484605 | 0.0042250 |
| 30 | 2,000,000 | 5.6141910 | 0.0038514 |
| 40 | 2,000,000 | 5.4819620 | 0.0039583 |
| 60 | 2,000,000 | 5.3766820 | 0.0036263 |

Trigger 19 is the sweep maximum. The sweep selects the strategy; its independent
10,000,000-pull validation supplies the less selection-biased rate estimate:

`D_FARM_MAX = 5.7383622 ± 0.0017571 SE Dust/pull`.

The other measured comparators are
`D_ONE_SIGNATURE_UNOWNED = 5.688574 ± 0.003814 SE` and
`D_ALL_DUPE = 5.155151 ± 0.001042 SE`, both lower.

Inside the trigger-19 validation stream, duplicate awards average
`4.724592 Dust/duplicate pull` and occupy 95% of pulls, contributing
`4.488362 Dust/total pull`. The scheduled signature scrap contributes another
`1.250000 Dust/total pull`. Because the forced rank-3 replacement resets
`epicMisses` every cycle, this strategy suppresses epic pity; the signature
scrap cadence supplies the uplift.

## Native same-copy floors

For an already-owned specific standard-banner die of tier `t`:

`craft_cost[t] / D_FARM_MAX > n_t / P_late[t]`

or equivalently:

`craft_cost[t] > (n_t / P_late[t]) × D_FARM_MAX`.

The floor SE uses independent-stream propagation:

`SE_floor = hypot((n_t/P_late) × SE_D, (n_t×D_FARM_MAX/P_late²) × SE_P)`.

| tier | native floor ± SE Dust | proposed cost | margin Dust | margin/SE |
|---|---:|---:|---:|---:|
| standard | 200.296 ± 0.067 | 210 | 9.704 | 144.3 |
| rare | 214.063 ± 0.101 | 220 | 5.937 | 58.5 |
| epic | 604.842 ± 0.536 | 615 | 10.158 | 19.0 |
| signature | 2419.896 ± 4.178 | 2500 | 80.104 | 19.2 |

All four strict native-parity inequalities pass by more than 3 SE. The direct
pull route also retains the other copies and Dust earned before the target
lands, while this comparison credits only the target copy.

## Remaining binding inequalities

**Craft→scrap anti-pump.** These are exact integer design inequalities, so
estimator SE is zero and positive margins have effectively infinite margin/SE:

- Standard: `1 < 210`; margin 209 Dust.
- Rare: `4 < 220`; margin 216 Dust.
- Epic: `10 < 615`; margin 605 Dust.
- Signature: `25 < 2500`; margin 2475 Dust.

**Signature hard-75 cross-banner floor.**

`2500 / 5.738362 = 435.664 standard-farm pulls > 75 premium pulls`.

The margin is 360.664 pulls, SE is 0.133 pulls, and margin/SE is 2703.6.
The 5.809x ratio is also conservative against the proposed premium soft-pity
mean of about 46.6 pulls.

**Epic free-player pace.**

`615 / (10 × 5.155151) = 11.930 weeks`.

Its batch-means SE is 0.0024 weeks. The lower-bound margin over 4 weeks is
7.930 weeks (3288.6 SE); the upper-bound margin below 12 weeks is 0.070 weeks
(29.1 SE). At `D_FARM_MAX`, the same craft takes 10.717 weeks. Including the
optional 12.5-Dust/week mythic community faucet yields 9.602 weeks; the
recommendation does not depend on that accelerator.

**No-double-faucet guardrail.** The exact integer equalities
`dupe_dust + scrap_yield = 2/8/20/50` preserve the transitional baseline, and
`scrap_yield <= dupe_dust` holds for every pull-pool tier.

## Precision and verification

The evidence run includes 24,000,000 independent all-owned equilibrium pulls,
14,000,000 dynamic sweep pulls, a separate 10,000,000-pull trigger-19
validation, 2,000,000 fixed-owned pulls, 1,200,000 scrap-only pulls, and
1,174,502 collector-to-completion pulls.

Commands run from the repository root:

```text
$ rtk node --check economy/drafts/monetization/simulate-dust-economy.mjs
[no stdout]
exit 0

$ rtk proxy node economy/drafts/monetization/simulate-dust-economy.mjs > economy/drafts/monetization/dust-economy-sim-output.txt
[stdout captured verbatim in dust-economy-sim-output.txt]
exit 0

$ rtk node scripts/economy-simulator.js --check
Verified 1 immutable economy simulation scenario(s)
exit 0
```

The complete fixed-seed output is in
`economy/drafts/monetization/dust-economy-sim-output.txt`.
