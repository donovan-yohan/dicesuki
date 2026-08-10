# Premium Rotation Banner 1 — "Song of the Anvil"

> **Decision document.** Scope: the shape of the FIRST premium rotation banner.
> Locked recommendations where the evidence is clear; **PO DECISION** blocks where
> it is not. Implements nothing — §8 is the slice list, not the work.
>
> Date: 2026-08-03 · Branch: `docs/premium-rotation-banner-plan` (off `origin/main`)
>
> **Nothing here ships before issue #154.** The gate is enforced twice, in two
> different functions: `private.prepare_pull_for_user` raises `Premium banner
> preparation is disabled pending issue #154`
> (`supabase/migrations/0015_banner_roll_type_binding.sql:105-108`, head version
> `0030:722`), and `private.commit_pull_session_for_user` raises `Premium banner
> commit is disabled pending issue #154` as "defense in depth"
> (`0017:740`, head version `0021:776-781`). Both live inside the trusted engine,
> so hand-inserted rows cannot reach the path. Every slice below is authorable
> today; none is *playable* today.

---

## 0. Verified current state (read first)

Everything in this table was read out of the repo at `origin/main`, not recalled.

| Fact | Value | Evidence |
|---|---|---|
| Live standard banner | `earned-collection-001@4` | `supabase/migrations/0032_earned_economy_dice_content_wave_1.sql:503` |
| Active production edition | `earned-collection@3` | `economy/production/editions/0003-earned-collection.json` |
| Standard tiers (items) | 24 / 27 / 18 / 12 | edition 0003 `acquisition.banner.tiers` |
| Standard tier weights | 72 / 23 / 4 / 1 of scale 100 | edition 0003 |
| Standard guarantees | rare 10, epic 25, selected-featured 20 | edition 0003 `guarantees` |
| Standard soft pity | `"none"` | edition 0003 `selectedFeaturedUnowned.softPity` |
| Catalog size | 117 items / 117 asset versions | `src/generated/collectibleCatalog.json` |
| Legendary sets in catalog | **three**: `stormglass`, `void-crystal`, `ten-thousand-folds` | `collectibleCatalog.json` |
| Ten Thousand Folds in catalog | 6 items, `legendary`, `assetKind: builtin`, `modelPath: builtin:<shape>` | `collectibleCatalog.json` (`ten-thousand-folds/{d4,d6,d8,d10,d12,d20}/legendary@1`) |
| Ten Thousand Folds in a banner tier | **no** — signature tier is `stormglass/*` + `void-crystal/*` only | edition 0003 |
| Premium banner rows | **none exist** — no `pull_banner_families` row, no `banner_class='premium'` version | `grep pull_banner_families supabase/migrations/*.sql` |
| Soft-pity engine | implemented **dormant**, slope-agnostic (nullable `soft_pity_model` / `_start_pull` / `_per_pull_increment`, all-or-none + `start_pull < selected_hard_guarantee_pull` constraints) | `supabase/migrations/0018_soft_pity_ramp.sql:6-40` |
| Next free global migration | **0034** (`0033_catalog_fantasy_earth.sql` is the head) | `supabase/migrations/` |
| Next free catalog edition | **7** (edition 6 = `EDITION_6_FANTASY_EARTH`, migration 0033) | `supabase/migrations/0033_catalog_fantasy_earth.sql:3` |
| Next free production economy edition | **0004** | `economy/production/editions/` |
| `DieSet.setBonus` consumers | **zero** — one legacy declaration (`infernal-obsidian`), held by a guard test that **passes today and fails if any new set adds one** | `src/types/inventory.ts:185`, `src/config/collectibleCatalogSource.guard.test.ts:194-201` |

Two planning assumptions that are **not** repo-verifiable and are stated as
assumptions: the product is in closed beta with essentially one real player, and
#154 legal review is unresolved.

---

## 1. Banner identity

**Name — carry forward: "Song of the Anvil."** Chosen in the concept doc
(`docs/exec-plans/active/2026-08-03-dice-content-wave-1.md:485`), deliberately
distinct from the set name so the banner brand outlives any one rotation. Note
the same table offers *Standing Invitation* / *Common Cast* as a **suggestion
pair** for the standard banner, not a pick — the research digest calls both
"already-locked", which overstates line 484.

The naming digest's premium register rules apply to **item-facing copy**: cheap
items name their object class, premium items refuse to (the digest's own
computation over fetched lists puts an explicit object noun in 80% of Genshin
1–2★ weapon names against 14% at 5★ — a researcher-computed figure, not a
published one). The already-authored Ten Thousand Folds die names substantially
clear that bar — `Sparkfold`, `Billetheart`, `Quenchline`, `Acidbloom`,
`Layerwake`, `Wyrmpattern` (concept doc §5.1) — though not perfectly:
*Billetheart* embeds `billet`, a steel-stock noun, and the pipeline **requires**
every ImageGen die id to end in `-<shape>` (concept doc §7.2), which is literally
naming the object class in the id. The display names are what the player reads,
and those are fine. **No copy change recommended**, but this is a judgement call,
not a rule cleanly satisfied.

**Cadence — PO DECISION 1a.** Spec §5.4 decision 5 recommends rotating every 2–3
weeks. That number was sized for a live population.

- **Option A — publish and run a 2–3 week wall clock from rotation 1.**
- **Option B (RECOMMENDED) — artifact-driven rotation until there is a real
  population: rotation N stays head-of-family until rotation N+1's edition
  merges. No published end date, no countdown UI.**

Reasoning for B: every rotation is an immutable production edition plus an
anchored migration plus a new banner version ("Rotation discipline" below). A
wall clock that outruns the art pipeline forces either a rushed edition or a dead
banner, and with one player a countdown retires content nobody chased. It also
avoids publishing an availability promise before #154 is resolved.

**Cost of B, stated plainly:** an open-ended banner with no end date and no
countdown gives up **scarcity/urgency, which is a premium rotation's main revenue
lever** — "limited" is what makes a rotation worth chasing now rather than later.
It also sits oddly with Ten Thousand Folds' own `"availability": "limited"` in
`src/config/collectibleCatalogSource.json`. Adopt the 2–3 week cadence as a
*stated intent* the moment the paid path is live and there is a population to
rotate for; B is a beta posture, not a permanent one.

**Family topology — PO DECISION 1b.** Pity `counterScope` is `banner-family`
(edition 0003, draft JSON), and migration `0030` made only the **highest
`banner_version` within a `banner_family_id`** preparable, resolving the family
head dynamically (`docs/guides/economy-contracts.md` §"Production edition 0002").
So the topology choice is real:

- **Option A (RECOMMENDED) — one family `song-of-the-anvil`; rotation N = version
  `@N`.** Pity carries across rotations (the Genshin behaviour players expect),
  and `0030`'s active-version rule retires the previous rotation with **no code
  change** — appending `@2` is sufficient.
- **Option B — one family per rotation.** Pity resets each rotation. A player 60
  pulls into a 75-pull chase loses all of it at rotation end. Player-hostile and
  it makes the premium chase feel disposable. Not recommended.

> **This reverses the concept doc.** `2026-08-03-dice-content-wave-1.md:487`
> states "A rotating banner **should be renamed each rotation**." Option A keeps
> **one** banner family and one banner name across rotations. The justification is
> mechanical, not cosmetic: `banner-family`-scoped pity carry-over is what players
> expect, and Option B's alternative is hostile. The concept doc's actual
> rationale — banner name ≠ *set* name, so the banner outlives the set — is
> preserved intact; only "renamed each rotation" is dropped. **Flagged explicitly
> so a reader of either doc sees the conflict.**

Option A carries one consequence that must be **budgeted, not fixed**:
`private.pull_selected_misses_after` resets the selected counter only when a
featured non-duplicate is actually awarded
(`supabase/migrations/0011_earned_pull_preparation.sql:609-625`), so a player who
owns every featured die of the current rotation banks `selected_misses` without
bound; the moment rotation 2 goes live its featured die is unowned and eligible,
and that player is awarded a guaranteed signature on their **very next pull**
(`docs/guides/economy-contracts.md` §"Expanding a featured pool moves targets and
discharges banked pity"). The guide is explicit that migrations in this lineage
never rewrite `pull_guarantee_states` — that would confiscate earned pity.
**Budget the grant when sizing rotation 2 and pin it with a behavioural case**,
mirroring the banked-pity block in
`supabase/tests/0032_earned_economy_dice_content_wave_1.test.sql`.

A third option exists — cap `selected_misses` accumulation when there is no
eligible target — but it is an engine change to a money-path function and must
never be applied retroactively to existing counters. Log it; not for rotation 1.

**Rotation discipline (not a decision — the existing rule).** Each rotation is a
new banner version `@N+1` anchored to a **new production edition**, because a
pool change *is* a rate change (`docs/guides/economy-contracts.md` §"Production
edition 0003 and banner pool changes"). Published editions, disclosures and
migrations are immutable and CI rejects edits at the merge base.

---

## 2. Featured structure — resolving issue #238

Issue #238 asks whether a 6-die featured set plus `lowest-canonical-id-unowned`
selection lets a player scrap-steer the 75-pull guarantee.

**First, a correction to the framing.** Selection is by catalog id **string** —
`supabase/migrations/0021_pull_copy_grant_rework.sql:268` is literally
`order by items.catalog_item_id` — so a 6-die Ten Thousand Folds featured set
would have its **guarantee path** award d10 → d12 → d20 → d4 → d6 → d8 (the same
string sort is visible in edition 0003's `stormglass`/`void-crystal` array). Base
draws still hit the tier uniformly (`0021:405-409`), so a lucky player can pull
the d20 first — the ordering binds the guarantee, not every outcome. Scrapping
can only make an *earlier* die unowned again, i.e. steer **backwards**; it cannot
skip a player ahead to the d20. So the real defects of a 6-die featured set are
(a) the guarantee path hands over the hero shape — the d20, whose matte-numeral
mask is the one premium cue that survives procedurally (concept doc §5.1) —
**third**, after two dice nobody put on the banner art, and (b) scrap-to-re-chase
becomes a Dust farm on a *paid* banner (spec §1.6 "Scrap makes featured dice
re-chaseable"; `0022_scrap_craft_economy.sql`).

**Second, the mechanism constraint.** Both the validator and the **runtime**
derive the featured base rate from the **signature tier weight fraction**:
`scripts/validate-production-economy.js:241` and `:489`, and
`private.prepare_pull_for_user` itself at `0021:296-308`
(`tiers.weight_units / sum(weight_units)` for the selected item's tier). The
runtime does model featured as a per-item flag
(`pull_banner_items.selected_featured`, `0011:126`), so a featured subset is
*expressible*; but the moment the signature tier holds 6 dice and only 1 is
featured, the featured die's true rate is **0.1%**, the derived base rate of
0.006 is wrong, and the ramp is mis-specified in three places at once.

### PO DECISION 2 — featured structure

| Option | Shape | Verdict |
|---|---|---|
| **1. Accept steering** | signature tier = 6 TTF dice, featured = all 6 | Guarantee path awards d10 first, d20 third; 0.6% becomes a *tier* rate at 0.1%/die; a full set is ≥ ~6 pity cycles ≈ **≥280 pulls ≈ 44,700 Stars ≈ ~$307 std / ~$276 best-value** (6 × mean 46.58 × 160 Stars, priced off spec §5.3/§5.5). Treat that as a **floor**: `pull_selected_misses_after` only resets on a non-duplicate featured award, so the unowned-featured rate falls 0.6% → 0.5% → … → 0.1% and later cycles run materially longer than 46.6. The §5.5 sim prices a **one-time single-target** chase, not this. Also the substrate a set-completion reward would later attach to (§4). |
| **2. Single featured die (RECOMMENDED)** | signature tier = exactly one die, featured = that item | Matches the draft JSON verbatim ("Sole signature-tier item, so every signature hit is the featured die"), spec §5.4 decision 4 (keep featured base ~0.6%) and decision 5 ("1 featured signature die per banner"). Keeps the derived base rate correct with **no new validator or engine math**. Dissolves #238: one featured id makes `lowest-canonical-id-unowned` degenerate — nothing to steer. |
| **3. Random-unowned selection** | change the selection rule | Engine change to `private.prepare_pull_for_user` plus a contract field plus every published edition's semantics, to solve a problem option 2 removes for free. Not for rotation 1. |
| **2b. 6 in tier, 1 featured** | signature tier = 6, featured = d20 | Expressible at runtime, but needs new per-item base-rate derivation in `validate-production-economy.js`, **in `private.prepare_pull_for_user` (`0021:296-308`)** and in the disclosure generator — i.e. the same money-path engine change option 3 is rejected for. Also drops the featured die to 0.1%. Revisit at rotation 3+ if collectors want the matched set on-banner. |

**Recommendation: option 2.**

**Which d20 depends on DECISION 5.** The featured item is Ten Thousand Folds'
d20, but its catalog id differs by pipeline:
`ten-thousand-folds/d20/legendary@1` if **5 = A** (ship procedural), or
`ten-thousand-folds-imagegen-set/wyrmpattern-d20@1` if **5 = B** (ship textured —
the key shape and die id follow from §5 and concept doc §5.1). These are
different catalog items, not two versions of one; DECISION 5 must be settled
before the banner rows are authored.

### PO DECISION 2b — acquisition path for the other five Ten Thousand Folds dice

Under option 2 the other five have **no acquisition path at rotation 1**: craft
is owned-only and cannot mint a first copy (spec §7 "Crafting scope"), the reward
rail grants named *standard* dice (edition 0003 `rewards`), and concept doc §4.1
keeps the set out of the standard banner.

- **Option A (RECOMMENDED) — graduate them to the standard signature tier in a
  later earned-collection edition**, once premium rotation 1 has retired. The d20
  stays premium-exclusive forever; the rest of the billet feeds the free funnel.
  See §8 P8 for the two consequences this carries — they are not free.
- Option B — direct-purchase SKUs. The rail exists (`0026_sku_registry.sql`,
  `0028_sku_fulfillment.sql`), but spec §1.1/§7 recommend gacha and direct
  purchase stay **disjoint pools**, so this cuts against a standing (open) spec
  recommendation.
- Option C — a later premium rotation. Works, but a set-completion chase spread
  across paid rotations is precisely the substrate §4 says to keep clear of.

---

## 3. Rates, pool and pity

Locked by the spec and carried unchanged: **featured base rate 0.6%** and **hard
pity 75** (spec §5.4 decisions 1 and 4). Ceiling `75 × 160 = 12,000` Stars ≈
**$82.46 std / $74.24 best-value / $45.86 first-time** (spec §5.3/§5.4). For
reference, JOGA self-regulation guidance caps rare-item expected spend at
`min(100 × pull cost, ¥50,000)` = 16,000 Stars here; the recommended design's
mean (7,453 Stars) and its ceiling (12,000) both sit inside that.

### PO DECISION 3a — the non-featured tier weights are NOT locked

Only 0.6% featured and hard pity 75 are PO-locked. The rest of the draft
structure (`economy/drafts/monetization/premium-featured-rate-up.draft.json`) is
an **unratified draft** and is surfaced here as a decision, not inherited as a
given: weight scale **1000**, tiers standard 800 / rare 154 / epic 40 /
signature 6; rare-or-better hard 10; epic-or-better hard 30.

Compare against the live free banner (edition 0003, scale 100): rare **15.4% vs
23%**, epic **4.0% vs 4.0%**, total legendary **0.6% vs 1.0%**, rare guarantee
**10 vs 10**, epic guarantee **30 vs 25**.

**As drafted, the paid banner is measurably worse than the free banner on every
axis except the one featured die.** That is defensible — the featured legendary
*is* what is being sold — but it is a product and disclosure-optics decision on a
#154-gated surface, and it should be made deliberately.

- **Option A — carry the draft as-is.** Maximum contrast between free funnel and
  paid chase; simplest to author.
- **Option B (RECOMMENDED) — raise the premium rare/epic weights to at least
  parity with the free banner** (e.g. standard 724 / rare 230 / epic 40 /
  signature 6 of 1000) and pull the epic guarantee back to 25 to match. The
  featured die remains the entire premium proposition; there is no reason the
  *consolation* should be worse than what a player gets for free, and "our paid
  banner has worse rare odds than our free one" is a bad sentence to defend in a
  legal review.
- Option C — anything in between; the weights are a single integer set.

Whatever is chosen must keep the signature tier at 6/1000 to preserve the locked
0.6%.

### PO DECISION 3b — what the non-featured premium pool is

The draft's non-featured tiers are `draft-premium/std-*`, `rare-*`, `epic-*`
placeholders. They have to become real catalog ids.

- **Option A (RECOMMENDED) — mirror edition 0003's standard / rare / epic pools
  verbatim (24 / 27 / 18 items).** Zero new content, no new catalog edition, and
  it is what Genshin's limited banner does (shared 4★ pool plus rate-up). The
  premium proposition is the 0.6% featured legendary and the 75-pull ceiling, not
  the consolation tier.
- Option B — a premium-exclusive non-featured pool. Needs at least three more
  sets; the wave shipped seven and six are already committed to standard.
- Option C — shared standard/rare, premium-exclusive epic. Middle path, one new
  epic set.

Recommendation **A** for rotation 1, downside stated plainly: a premium 10-pull's
non-featured results are drawn from exactly the pools a player can farm for free,
and under DECISION 3a option A they arrive at **worse** rates. The obvious fix —
rate-up on selected items *within* a shared tier — is **not expressible today**:
tier objects accept exactly `tierId, rank, weightUnits, catalogItemIds`
(`scripts/validate-production-economy.js:174`, `:413`), so weights are uniform
within a tier. Log per-item weights as rotation-2 work.

### PO DECISION 3c — activate the dormant soft-pity ramp for rotation 1?

- **Option A (RECOMMENDED) — activate: `{model: "linear-rate-ramp", startPull:
  41, perPullIncrement: 0.005, baseFeaturedRate: 0.006}`.**
- Option B — keep dormant for rotation 1, activate after one rotation of data.

Reasoning for A: with no ramp, spec §5.2/§5.5 measure **p50 = p90 = p99 = 75** and
~55% of players landing exactly on the ceiling — hard pity is a **price tag, not
a gamble**, which is both a worse product and a worse posture for a paid
randomized path sitting under a legal gate. The recommended ramp moves p50 to
**51**, mean to **46.6** pulls, and leaves **2.2%** at the ceiling: a curve with a
ceiling rather than a wall, and it preserves the highest mean of the four sampled
slopes (§5.5). Activation is strictly player-favourable, so it can never be a
regression for an existing holder.

**Cost of A, and the real argument for B:** spec §7 calls `perPullIncrement` "a
playtest/LTV tuning decision" and names +1%/pull as the next step up if sentiment
wants a softer chase — and §0 records the working assumption of essentially **one
real player**, i.e. **zero playtest data**. Writing a slope into a live banner row
**freezes it**: changing it later needs a new production edition, a new migration
and a new banner version. Option B trades a worse rotation-1 distribution for the
ability to tune the slope against real behaviour before it becomes immutable
history. A is recommended because the no-ramp distribution is bad enough on a
*paid* surface to be worth an untuned slope — but that is a judgement, and the
irreversibility is its price.

Two obligations ride with A: the odds disclosure must describe the ramp
truthfully (§4), and `startPull` must stay strictly below
`selected_hard_guarantee_pull` — the DB constraint enforces it
(`0018_soft_pity_ramp.sql:35-40`); 41 < 75 passes.

### PO DECISION 3d — guarantee behaviour when no unowned featured target exists

With `lossPath: "none"` and the sole featured die owned, the guarantee's
behaviour is **undefined** — spec §1.6 flags it and does not resolve it. Under
DECISION 1b option A this is not academic: it is exactly the state that banks
unbounded `selected_misses`. Spec §1.6 names the two candidates:

- **Option A (RECOMMENDED) — the guarantee simply does not arm** when there is no
  unowned featured target. This is what the engine already does implicitly
  (`0011:609-625` only resets on a non-duplicate featured award), so it is the
  zero-change answer, and it preserves the banked-pity discharge at rotation N+1
  that §1b already budgets for.
- Option B — it awards something (a duplicate copy plus signature Dust, or a
  fallback). Engine change; it also converts the premium chase into a Dust faucet
  at a fixed 75-pull cadence for a completed player, which the whale-ceiling
  analysis never priced.

Must be settled in the same slice as the banner rows (§8 P4).

---

## 4. Kompu-gacha compliance

> **Scope note.** This section is *analysis against the research digest's
> reconstruction* of the rule — not a legal opinion, and not the #154 review. The
> digest marks its own foundation: the CAA's own PDF was **not parsed**; the
> four-element test is reconstructed from the CAA standing Q&A plus four
> independent Japanese legal analyses.

Japan's 景品表示法 ban is **categorical — no prize-value threshold makes it
compliant**. The four-element test (prohibited only if all four co-exist),
applied to the recommended design:

| # | Element | This design |
|---|---|---|
| 1 | Items obtained by chance | **YES** — randomised pull. |
| 2 | Draw incidental to a **paid** transaction | **YES** in the general case, once #154 opens paid Stars → `premium_roll` → premium pull. See the mixed-funding question below. |
| 3 | Two or more **different kinds** of collectible | **YES** — the banner pool holds many distinguishable dice. |
| 4 | Assembling a **specific combination** unlocks a **separate further benefit** | **NO — and this is the element the design must keep at NO.** |

**Reading: the design sits outside kompu gacha on the four-element test as
reconstructed, because element 4 is absent.** Elements 1–3 are inherent to any
paid gacha and are not themselves the violation. Under the §2 recommendation
(single featured die) there is not even a set to complete on the banner, so
element 4 has no substrate. The digest's strongest statement about our shape is
"Rotation = one pool, pity/guarantee on a COUNTER: **clean**" — it issues no
verdict on our design, and neither does this section.

**Open question inside element 2 — mixed funding.** The draft carries
`balanceBuckets: ["paid", "promotional"]` with
`debitPolicy: "promotional-before-paid"`, and spec §1.4/§1.5 allow
Stars→`premium_roll` conversion **from any bucket**. So a premium pull can be
funded entirely from *earned* Stars. Whether "draw incidental to a paid
transaction" attaches to such a pull is exactly the sort of question the #154
review should be asked; the digest does not answer it.

**Compliant by construction, per the digest's carve-outs:** the random item *is*
the purchased thing; duplicates convert to a fungible currency (Dust) rather than
to combination progress — the single most important industry carve-out; and pity
is an arithmetic **counter**, not a design combination. Two hedges the digest
attaches and this doc carries: the step-up / pity-counter carve-out passes **by
inference** and is not affirmatively blessed in any CAA document, and point/
counter totals are the digest's **least crisp** carve-out (keep die art off any
point token).

**`DieSet.setBonus` — the one live risk.** `src/types/inventory.ts:185` declares
`setBonus?: { description, effectId }`, which is exactly element 4's shape. It is
inert: **zero consumers** (only the type declaration and the guard test reference
it), and `src/config/collectibleCatalogSource.guard.test.ts:194-201` pins
`infernal-obsidian` as the sole legacy declaration and **fails** if any new set
adds one. That test is real backpressure, not doctrine — keep it.

**POLICY TO RATIFY 4 (one recommendation, seeking sign-off — not a multi-option
decision): no `setBonus` on any set reachable from a paid banner without explicit
PO *and* legal sign-off.** If set-completion recognition is wanted, the
earned/free path is outside premium regulation, so an earned-path-only bonus is
the low-risk form. If it must touch the paid path, use the digest's compliant
reformulations: a **fungible currency/shard milestone** dropped by all rotations
(same token kind), a **pull-count** milestone, a **directly purchasable** missing
piece (removes chance), or fusion of duplicates. Never a **bingo/grid — which the
CAA names directly alongside コンプガチャ** — and never "collect all N
rotation-exclusive dice → season prize", which is the *digest's own reading* of
the same rule applied to our shape rather than a CAA enumeration.

**Truth in rates is not optional even though disclosure is voluntary.** KOF '98
UM Online displayed 3% against a real 0.333% and drew a CAA 措置命令 (2018) plus a
¥6.09M surcharge (2021); since Oct 2024 the CAA can fine directly without a prior
order. Our commit/reveal seal (`0017`) plus published immutable editions already
exceed JOGA self-regulation — but the published number must match the shipped
banner row, **including the soft-pity ramp** if §3c lands as recommended. That
makes the disclosure slice (§8 P5) a launch blocker, not a nicety.

Disregard any claim of a "2025 Japan mandatory probability-disclosure law" — the
digest checked caa.go.jp / JOGA / CESA and found it uncorroborated. The live
framework is the 2012 rules plus Oct-2023 stealth-marketing plus Oct-2024
penalties.

---

## 5. Content pipeline dependency — procedural vs textured Ten Thousand Folds

**A correction to the working assumption, verified in the generator.** The idea
that we can ship procedural now and swap textures in later under `asset@N+1` is
only **half** true:

- **True for procedural refinement.** `setVersionOverrides.<setId>.assetVersion`
  bumps a set to `asset@2` while the catalog **item id stays
  `.../legendary@1`** (`scripts/generate-collectible-catalog.js:136-195`). So
  palette, roughness and VFX metadata can be re-published with **no banner
  edition change**.
- **False for the ImageGen pass.** Baked GLB dice do not enter through
  `configuredSets` at all. They are discovered by a directory scan of
  `public/dice/<setId>/<dieId>/` and emitted with `assetKind: 'gltf'` and a
  catalog key of shape `<setId>/<dieId>`
  (`scripts/generate-collectible-catalog.js:268-380`) — a **different key shape
  and different item ids** from the procedural `<setId>/<shape>/<rarity>`. There
  is no supported route from a `builtin:` configured item to a GLB item: the
  `modelPath` override is rejected for non-production catalog keys (line 160),
  and configured entries hardcode `assetKind: 'builtin'` (line 234).

**Therefore a textured Ten Thousand Folds is a different set of catalog ids, and
putting it in the banner is a pool change** — new production edition, new
migration, new banner version. Rotation-1 buyers cannot be upgraded in place.

The other blocker is unchanged and verified:
`scripts/imagegen-uv/theme-workshop-data.mjs:49-56` freezes `BAKE_RARITIES` by
shape globally (`d20: 'epic'`), so **no ImageGen set can currently be
legendary**. A per-theme override is a small, contained code change — but it is a
code change with a test update, because the three shipped sets' rarities are
frozen catalog history.

### PO DECISION 5 — what rotation 1 ships

- **Option A — ship rotation 1 with the procedural Ten Thousand Folds now.**
  Pro: no code change, no art pass, unblocks the premium rail immediately; the
  d20's matte-numeral mask is a genuine premium-metal cue. Con: the concept doc
  rates TTF procedural fidelity **2/5 — the weakest of all seven sets** — and
  states outright "this set is not finished until the ImageGen pass lands"
  (§5.1); Damascus stripped of its swirl is indistinguishable from plain
  gunmetal. And per the finding above, rotation-1 buyers keep the 2/5 version
  permanently.
- **Option B (RECOMMENDED) — block rotation 1 on the ImageGen pass.** Pro: the
  featured die of the first *paid* banner is the best-looking object in the game,
  which is the entire pitch; and rotation 1 is #154-gated anyway, so the art pass
  is **not on the critical path to anything shippable today**. Con: longest pole,
  and the scope is the whole set, not one die — the workshop bakes a **set**, so
  this is the `BAKE_RARITIES` override + **six** dice atlases + normals + GLB bake
  + proofs + release lock + catalog edition (§8 P1). Featuring only the d20 does
  not make the other five free to skip.
- Option C — feature a different die and hold TTF. Not available: the other two
  legendary sets are Stormglass and Void Crystal, and **both are already in the
  standard signature tier** (edition 0003).

**Recommendation: B.** The "upgrade later" escape hatch that made A cheap does
not exist. If the PO takes A anyway, the honest framing is that rotation 1 sells
the procedural d20 as its own permanent artifact and the textured version becomes
a **later rotation's** featured die under an escalated name (§7) — legitimate
re-release practice, **provided store copy never promises a future art upgrade**.

> **Cost of B that is easy to miss:** the six procedural
> `ten-thousand-folds/*/legendary@1` items already shipped in catalog edition 5
> (`supabase/migrations/0031_catalog_dice_content_wave_1.sql`) and sit in no pool.
> Under B they never enter one, and under DECISION 2b option A the graduated dice
> would be the *GLB* ids. **Six legendary catalog items become permanently
> unobtainable.** Catalog history is immutable, so they cannot be removed —
> decide whether that is acceptable dead inventory, or whether the procedural six
> should graduate to the standard pool as their own cheaper set.

Note the art pass is cheaper than it looks: the authoring guide records that
environment textures are generated but **unused at runtime**, so budget the art
time on the six dice atlases only (concept doc §7.2).

---

## 6. Reveal and presentation — handoff, not design

**This plan designs no reveal behaviour.** The following findings belong to the
reveal-minigame slices in
`docs/exec-plans/active/2026-07-27-gacha-reveal-minigame.md` (S1–S5; **S5 =
premium ceremony visuals, #154-gated**) and to **issue #237**.

- **Escalate the pre-reveal window, not just the payoff.** Larche et al. (2019,
  *J. Gambling Studies*) measured arousal peaking in the ~2s **pre-reveal**
  anticipation window, with legendary SCR .77 µS > rare .58 > epic .54, and
  post-reveal dwell also scaling with rarity. The anticipation stage has no
  slot-machine analogue — it is a deliberate design addition. This maps directly
  onto the PO-locked staged-finale glow (reveal doc decision 3): the neutral
  shimmer hold **is** the anticipation window, so escalate its duration and
  intensity, and preserve post-reveal dwell.
- **The digest's full reveal grammar**, carried so it is not lost: commit →
  sealed transit → **TELL** (partially predictive cue) → **fake-out upgrade
  window** → pause → tier-scaled reveal + stinger → dwell. The fake-out upgrade
  window is the one element here with independent ethical weight on a *paid*
  banner — it is a near-miss device. Flagged for the reveal slice to adopt
  deliberately or not at all, never by default.
- **One parameterized effect, tiers = parameter sets** (color, particle density,
  emissive, scale, trails, duration, audio layers) — not per-tier assets. Riot's
  restraint ladder is clarity → clutter → theme → delight; avoid 0/100
  value+saturation extremes so legendary keeps headroom.
- **Hard accessibility caps apply to ALL tiers and never scale with rarity:**
  ≤3 flashes/sec, <10% luminance change or <20% screen area (Xbox XAG 118 /
  WCAG 2.3.1), no saturated-red flash, and disable sliders.
- **Rarity must stay readable with all VFX disabled** — colour **plus** text
  **plus** icon. Same requirement as issue #237's redundant channel, where rare
  `#0070dd` and epic `#a335ee` sit 1.01:1 apart in relative luminance. A premium
  banner raises the stakes: rare and epic are most of what a premium 10-pull shows
  above the standard tier, and they are precisely the two the player cannot tell
  apart.

---

## 7. Rotation 2+ seeding

**Quicksilver Core (liquid core) — the natural rotation-2+ headline.** Logged as
deferred in concept doc §6. It is the one artisan category that can be neither a
texture nor a procedural material: the fill moves when the die is rolled, so it
needs an inner mesh or a parallax shader driven by angular velocity — which we
uniquely *can* do, because the room core already streams authoritative angular
state at 60 Hz. That makes it structurally premium-exclusive (it cannot be
approximated on the cheap path) and it would be the first die whose look is
driven by physics, a differentiator no static dice-collection game has. It is a
**rendering** slice, not a content slice — route it through `/harness:plan`, not
through a content wave. Copy guardrail: physical liquid-core dice are "essentially
weighted" per Dice Envy; ours are server-authoritative and provably fair, so "a
die that *looks* loaded and demonstrably isn't" is a good story — provided the
copy never implies a rolling advantage.

**Re-running a set on a later rotation.** Use the FEH pattern the naming digest
identifies: **escalating adjective on a fixed proper noun** (Divine → Virtuous →
Hallowed Tyrfing), where the proper noun is the brand and the adjective is the
version number. A textured Ten Thousand Folds re-release is therefore *"Quenched
Ten Thousand Folds"* or *"Hallowed Ten Thousand Folds"*, never *"Ten Thousand
Folds+"* — the digest notes the `+` suffix honestly marks non-top-tier, the
opposite of what a premium re-release wants. Under DECISION 1b option A the banner
brand **"Song of the Anvil" stays fixed** across rotations and only the **set**
name escalates — see the flagged reversal of concept doc line 487 in §1.

---

## 8. Implementation slices

Ordered, **one reviewable PR per slice**. Nothing here is implemented by this
document. "Blocks on" lists what the PO must decide before the slice can start.

| # | Slice | Kind | Blocks on |
|---|---|---|---|
| **P0** | `BAKE_RARITIES` per-theme override (optional `theme.rarities` merged over the shape default) + test update; the three shipped sets' rarities stay frozen | **code** | DECISION 5 = B |
| **P1** | Ten Thousand Folds ImageGen pass: **six** dice atlases → normals → GLB bake → proofs → release archive+lock, per `docs/guides/dice-set-authoring.md`. Reuse the `dungeon-castle` environment; skip environment art (unused at runtime) | **art / pipeline** | P0 |
| **P2** | Catalog edition **7** publishing the baked GLB items (migration `0034_catalog_<slug>.sql`) | **migration + generated** | P1 |
| **P3** | Production-economy **premium lineage support** in `scripts/validate-production-economy.js` — see the five hard blockers below | **code** | DECISIONS 1b, 2, 3a, 3b, 3c |
| **P4** | Production economy edition **0004** (premium) + anchored migration + `pull_banner_families` / `pull_banner_versions` / `pull_banner_tiers` / `pull_banner_items` rows, `banner_class='premium'`, `roll_type='premium_roll'`, soft-pity columns per DECISION 3c. Derive rows from the pinned edition JSON and diff-assert, as `0032` does. **Must also retire or re-scope the `0032` TTF reservation assertion (blocker 5).** | **migration + data** | P3; DECISION 3d; DECISION 1a for availability copy |
| **P5** | Odds disclosure for edition 0004 **including the soft-pity ramp**; one-tap-from-pull placement per reveal doc decision 6 | **code + generated** | P4. **Launch blocker** (§4) |
| **P6** | Lift the premium fail-closed guard in **both** `prepare_pull_for_user` **and** `commit_pull_session_for_user` — shipping only the first yields a banner that prepares and then throws on commit | **migration** | **#154 legal only** |
| **P7** | Reveal S5 — premium ceremony visuals and arena dressing | **code** | issue #237 channel decision; P6 |
| **P8** | Graduate the other five Ten Thousand Folds dice to the standard signature tier — earned-collection edition **0005** + migration + banner version `@5` | **migration + data** | DECISION 2b = A; after rotation 1 retires |

**P3 in detail — five hard blockers, all verified.** A premium edition cannot be
appended as-is:

1. `SCHEMA_VERSION_VALIDATORS` only knows `schemaVersion: 1`
   (`validate-production-economy.js:699-701`), and schema v1 requires
   `currencyId === 'stars'` **and** `balanceBucket === 'promotional'` and asserts
   "Schema-v1 production remains earned-only with money and checkout disabled"
   (lines 636-658). Per `docs/guides/economy-contracts.md`, "a shape change must
   add an explicit schema-version validator" — so add **schemaVersion 2**; do not
   widen v1.
2. `MIGRATION_FILE_PATTERN = /^\d{4}_earned_economy_[a-z0-9_]+\.sql$/` (line 12)
   rejects any anchor not named `earned_economy`, and the orphan check at the end
   of `validateProductionEconomy` sweeps the same pattern.
3. `validateMigrationAnchor` hardcodes the marker
   `-- BEGIN EARNED ECONOMY EDITION NNNN` (lines 765-775).
4. The top-level exact-keys list requires `rewards`
   (`validateProductionEdition`, lines 726-742) — a premium banner has no faucet
   rewards, so schema 2 must define what an empty `rewards` means. The same list
   has **no** `bannerClass` or `rollType` key, both of which the draft JSON carries
   at top level, so those must be admitted by schema 2 too.
5. **`supabase/tests/0032_earned_economy_dice_content_wave_1.test.sql:244-252`
   fails the moment a TTF die enters any banner.** The assertion is **global** —
   no `banner_version_id` filter — and raises "The reserved premium featured set
   leaked into a pull banner" if any `pull_banner_items` row joins a
   `catalog_items` row with `set_id = 'ten-thousand-folds'`. Migration `0032`
   carries the same reservation, and `scripts/test-supabase-postgres.mjs` applies
   **all** migrations then runs **all** suites — so this is a live CI failure, not
   a latent one. It trips unconditionally under DECISION 5 = A and under P8; under
   5 = B it is dodged only by the accident that the GLB `set_id` is
   `ten-thousand-folds-imagegen-set`. The reservation did its job and now has to
   be retired deliberately, in P4.

Also note `EDITION_VALIDATORS` maps *edition numbers* to the earned-collection
validator (lines 703-707), so edition 4 falls through to a no-op unless a premium
boundary table is added alongside it. And editions are **globally contiguous** in
one directory (`validateProductionEconomy`, `expectedEdition = index + 1`), so the
premium edition is `0004-<slug>.json` in the same lineage directory as the
earned-collection ones.

**P8 in detail — two documented consequences, both must be budgeted.**
`docs/guides/economy-contracts.md:264-267` states that
`selectedFeaturedUnowned.catalogItemIds` **must remain exactly the signature
tier** (the validator asserts array equality at
`validate-production-economy.js:503`), so:

- The five graduated dice **automatically become featured** on the free banner —
  they cannot be "just pool filler". Size the 20-pull selected-featured target
  accordingly.
- `ten-thousand-folds/` string-sorts **between** `stormglass/` and
  `void-crystal/`, so per the guide's §"Expanding a featured pool moves targets
  and discharges banked pity", **every partial collector's guarantee target
  moves** and **banked pity discharges** on the first pull after the version goes
  live. Budget the grant; do **not** rewrite `pull_guarantee_states`; pin it with
  a behavioural case, exactly as §1b requires for the premium family.

---

## 9. PO decision summary

| ID | Decision | Recommendation |
|---|---|---|
| **1a** | Rotation cadence | Artifact-driven (rotation N head-of-family until N+1 merges). **Cost: gives up the urgency/scarcity lever.** Adopt the 2–3 week clock once there is a population |
| **1b** | Family topology | One family `song-of-the-anvil`, rotations = versions; pity carries; **budget** the banked-pity discharge at each rotation launch, never rewrite counters. **Reverses concept doc line 487 ("renamed each rotation")** |
| **2** | Featured structure (issue #238) | Single featured die = Ten Thousand Folds' d20 as the sole signature item. **Its catalog id depends on DECISION 5:** `ten-thousand-folds/d20/legendary@1` (5=A) or `ten-thousand-folds-imagegen-set/wyrmpattern-d20@1` (5=B) |
| **2b** | Acquisition path for the other five TTF dice | Graduate them to the standard signature tier in a later edition (§8 P8) — not direct-purchase SKUs |
| **3a** | Premium non-featured tier weights + rare/epic boundaries (**NOT locked — draft only**) | Raise premium rare/epic to at least free-banner parity. As drafted the paid banner is *worse than free* on rare (15.4% vs 23%) and total legendary (0.6% vs 1.0%) |
| **3b** | Non-featured premium pool | Mirror edition 0003's standard/rare/epic pools verbatim; log per-item weights for rotation 2 |
| **3c** | Soft-pity ramp | **Activate** at rotation 1: linear ramp, start 41, +0.5%/pull. **Cost: freezes an untuned slope with zero playtest data**; changing it later needs a new edition + migration + banner version |
| **3d** | Guarantee behaviour with no unowned featured target (`lossPath: "none"`) | It **does not arm** — the zero-change answer, consistent with the banked-pity budgeting in 1b |
| **4** | `setBonus` on paid-banner sets (**policy to ratify, single option**) | No `setBonus` reachable from a paid banner without PO **and** legal sign-off; earned-path-only bonuses are the low-risk form; keep the guard test |
| **5** | Procedural vs textured Ten Thousand Folds | **Block rotation 1 on the ImageGen pass** — no in-place upgrade path exists, and rotation 1 is #154-gated anyway. **Costs: a six-die art pass, and six already-shipped procedural legendary items become permanently unobtainable** |

Two questions this plan raises for the **#154 legal review** rather than for the
PO: whether "draw incidental to a paid transaction" attaches to a premium pull
funded entirely from promotional Stars (§4), and sign-off on the four-element
reading itself.

---

## 10. Sources

**Repo (all read at `origin/main`):**
`economy/production/editions/0003-earned-collection.json` ·
`economy/drafts/monetization/premium-featured-rate-up.draft.json` ·
`src/generated/collectibleCatalog.json` ·
`src/config/collectibleCatalogSource.json` ·
`scripts/validate-production-economy.js` ·
`scripts/generate-collectible-catalog.js` ·
`scripts/imagegen-uv/theme-workshop-data.mjs` ·
`scripts/test-supabase-postgres.mjs` ·
`src/types/inventory.ts` ·
`src/config/collectibleCatalogSource.guard.test.ts` ·
`supabase/migrations/0011_earned_pull_preparation.sql` ·
`0015_banner_roll_type_binding.sql` · `0017_pull_commit_reveal.sql` ·
`0018_soft_pity_ramp.sql` · `0021_pull_copy_grant_rework.sql` ·
`0022_scrap_craft_economy.sql` · `0026_sku_registry.sql` ·
`0028_sku_fulfillment.sql` · `0030_earned_economy_rare_pity_10.sql` ·
`0031_catalog_dice_content_wave_1.sql` ·
`0032_earned_economy_dice_content_wave_1.sql` ·
`supabase/tests/0032_earned_economy_dice_content_wave_1.test.sql` ·
`0033_catalog_fantasy_earth.sql` ·
`docs/guides/economy-contracts.md` · `docs/guides/dice-set-authoring.md` ·
`docs/exec-plans/active/2026-07-22-monetization-economy-spec.md` ·
`docs/exec-plans/active/2026-08-03-dice-content-wave-1.md` ·
`docs/exec-plans/active/2026-07-27-gacha-reveal-minigame.md` ·
GitHub issues **#238**, **#237**, **#154**.

**Research digests (2026-08-02, sourced; carried here, not re-derived):** gacha
naming conventions (Genshin/HSR/ZZZ/FEH register ladders, banner-name split);
kompu-gacha law (CAA four-element test, compliant reformulations, KOF '98 UM
enforcement precedent, JOGA expected-spend guidance) and VFX escalation (Larche
et al. 2019 psychophysiology; reveal grammar; Riot restraint ladder; Xbox XAG 118
/ WCAG 2.3.1 caps); artisan premium-dice covetability.

**Digest-marked gaps, carried forward in full:**

- *Kompu/VFX digest:* the CAA's own PDF was **not parsed** (reconstructed from the
  CAA standing Q&A plus four independent Japanese legal analyses); the step-up /
  pity-counter carve-out is **inference**, not an affirmative CAA blessing; the
  JOGA 1% floor comes via a 4Gamer summary only; "restraint conveys prestige" is
  the researcher's synthesis, uncited.
- *Naming digest:* Blue Archive excluded (sources refused); Genshin/FEH lists via
  Game8/GameWith/Fextralife because the primary wikis returned 402/403; and **the
  percentages are the researcher's own computation** over the fetched lists —
  including the 80%/14% object-noun figure quoted in §1.

---

## 11. PO decisions — LOCKED 2026-08-10

Recorded verbatim from the PO walkthrough. These supersede the recommendations
in §9 where they differ.

| ID | Decision | Locked outcome |
|---|---|---|
| **1a** | Cadence | **Artifact-driven.** Rotation N stays head-of-family until rotation N+1's content merges. Fixed clock revisited once there is a player population. |
| **1b** | Family topology | **One family `song-of-the-anvil`; rotations = appended banner versions; pity carries.** Banked-pity discharge at each rotation launch is budgeted, never rewritten. Supersedes concept doc line 487. |
| **2** | Featured structure (#238) | **Single featured die: `ten-thousand-folds-imagegen-set/wyrmpattern-d20@1`** (textured id per decision 5). Scrap-steering closed by construction. |
| **2b** | Other five TTF dice | **REVISED from §9 recommendation — premium-exclusive, no standard-pool graduation on any current roadmap** ("not until much later"). Deliberate exclusivity lever. Future rotations MAY feature the remaining TTF dice individually (composes with 1b pity-carry and 3d: each new featured piece re-arms the guarantee for owners of the previous one). Owning multiple TTF dice MUST NOT unlock any separate benefit (§4 four-element test). |
| **3a** | Premium tier weights | **REVISED from §9 recommendation — exact parity floor.** Premium non-featured odds mirror the free banner tier-for-tier; the paid value proposition is the exclusive featured die + the soft-pity ramp, not juiced odds. (Also removes the need for a weight-tuning sim slice: weights are copied, featured 0.6% sits on top.) |
| **3b** | Non-featured pool | **Mirror edition 0003's standard/rare/epic pools verbatim.** Per-item weights logged for rotation 2. |
| **3c** | Soft-pity ramp | **Activate at rotation 1: linear, start pull 41, +0.5%/pull to hard pity 75.** Accepted cost: slope ships untuned; re-tuning requires a new edition + migration + banner version. |
| **3d** | Guarantee with no unowned target | **Does not arm.** Counter accrues and discharges when a future rotation offers an unowned featured item. |
| **4** | setBonus policy | **RATIFIED.** No `setBonus` reachable from any paid banner without PO and legal (#154) sign-off; earned-path-only bonuses are the permitted low-risk form; guard test stays. |
| **5** | TTF assets | **Block rotation 1 on the ImageGen pass.** Rotation 1 ships the textured set; the six never-pooled procedural `ten-thousand-folds/*` ids remain permanently unobtainable. |
| **#237** | Reveal rarity tell | **Audio stinger per tier + glow intensity/duration step**, in addition to (not replacing) glow color. Particle escalation and label not selected as tell channels. Accessibility caps apply at all tiers; rarity must remain readable with VFX disabled. |

Remaining external gate before any activation slice: **#154 legal review** (the
two questions in §9 routed there).
