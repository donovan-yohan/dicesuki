# Dice Content Wave 1 — Concept Document

Status: research complete, ready for content implementation
Date: 2026-08-03
Owner: dice-content research (delegated, PO overnight directive 2026-08-03)
Branch base: `origin/main` @ `caf9b01`
Consumers: sibling content owner (procedural wave tonight), ImageGen kit owner

> This is a **concept + parameter** document, not an implementation. Every
> engine claim below was verified against `origin/main` and is cited with a
> file:line. Where a field the catalog schema *accepts* has no runtime effect,
> that is stated explicitly rather than glossed — a content wave built on
> parameters that do nothing is the main risk this document exists to prevent.

---

## 1. Why this wave exists — the pool gap

The production economy edition `economy/production/editions/0001-earned-collection.json`
splits the standard banner into four tiers. Current occupancy:

| Economy tier | Weight (of 100) | Catalog items today | Distinct sets |
|---|---|---|---|
| `standard` | 72 | 24 | 3 (`adventurer-starter`, `dragon-jade` c/uc, `lucky-bronze`) |
| `rare` | 23 | 9 | 1 set + 3 one-offs (`dragon-jade` rare, `materials-lab` ×2, `devil-set` ×1) |
| `epic` | 4 | 6 | 1 (`celestial-gold`) |
| `signature` | 1 | 6 | 1 (`void-crystal`) |

The top three tiers are the thin part: **one set each** at epic and signature,
and the rare tier is padded with two `materials-lab` test dice and a bundled
`devil-d6`. Every pull above `standard` currently lands in a pool the player
exhausts almost immediately. This wave adds **2 signature, 2 epic, 3 rare** sets.

Tier→rarity binding is hard-asserted at
`scripts/validate-production-economy.js:157-171`:

```js
const tierDefinitions = [
  ['standard', 0, new Set(['common', 'uncommon'])],
  ['rare',     1, new Set(['rare'])],
  ['epic',     2, new Set(['epic'])],
  ['signature',3, new Set(['legendary'])],
]
```

So **"signature" is not a rarity** — it is an `EarnedEconomyTierId`
(`src/types/earnedEconomy.ts:5`) that accepts exactly `legendary` items. A
"five-star pull" set must be authored `rarity: "legendary"`.

**`mythic` maps to no tier at all.** All six `infernal-obsidian/*/mythic@1`
items are absent from every tier pool — mythic is the community-faucet rarity
and is deliberately unpullable. Do not author new mythic sets for the banner.

---

## 2. What the engine actually renders (verified)

### 2.1 The schema, quoted

`src/types/inventory.ts:50-71` — the authored surface:

```ts
export interface DieAppearance {
  baseColor: string           // Primary color (hex)
  accentColor: string         // Numbers/pips color (hex)
  material: DieMaterial

  // Optional PBR properties
  texture?: string            // Texture URL/path
  metalness?: number          // 0-1 for PBR materials
  roughness?: number          // 0-1 for PBR materials
  emissive?: string           // Glow color (hex)
  emissiveIntensity?: number  // Glow strength
}

export interface DieVFX {
  trailEffect?: string        // 'sparkles', 'fire', 'lightning', etc.
  impactEffect?: string       // Particle effect on collision
  rollSound?: string          // Custom sound effect ID
  criticalAnimation?: string  // Special animation on max roll
}
```

`src/types/inventory.ts:16` — `DieRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic'`

`src/types/inventory.ts:18-29` — `DieMaterial`, the **only** 11 accepted values:
`plastic`, `resin`, `metal`, `rubber`, `stone`, `glass`, `crystal`, `wood`,
`bone`, `obsidian`, `celestial`. Enforced again at
`scripts/catalog-edition-planner.js:12-24` (`DIE_MATERIALS`); anything else is
rejected by `npm run check:collectible-catalog`.

### 2.2 The honesty table — which authored fields actually do anything

This is the single most important section of this document.

| Authored field | Rolled die (tray) | Inventory preview | Evidence |
|---|---|---|---|
| `baseColor` | **YES** — face albedo | **YES** | `diceMaterial.ts:108` (`map: texture`), texture drawn with `color` |
| `material` | **YES** — sets roughness+metalness, and selects face renderer | **YES** + transparency | `diceMaterial.ts:60-74` |
| `accentColor` | **NO** | **NO** | numerals are hardcoded white — see §2.3 |
| `roughness` | **NO** — overridden | **NO** — overridden | `diceMaterial.ts:24-37` `MATERIAL_PBR` |
| `metalness` | **NO** — overridden | **NO** — overridden | same |
| `emissive` | **NO** | **YES** | `SharedInventoryDicePreviewCanvas.tsx:301-314` |
| `emissiveIntensity` | **NO** | **YES** | same |
| `texture` | **NO** — no consumer anywhere | **NO** | type-only field |
| `vfx.*` (all four) | **NO** | **NO** | zero runtime consumers — see §2.4 |

**Authored `roughness`/`metalness` are dead.** `resolveDiceMaterial` derives
both from the material *string* alone (`src/lib/diceMaterial.ts:24-37, 60-65`):

```ts
const MATERIAL_PBR: Record<string, { roughness: number; metalness: number }> = {
  plastic: { roughness: 0.68, metalness: 0.06 },
  resin:   { roughness: 0.42, metalness: 0.08 },
  metal:   { roughness: 0.28, metalness: 1.0 },
  rubber:  { roughness: 0.95, metalness: 0.0 },
  stone:   { roughness: 0.86, metalness: 0.02 },
  glass:   { roughness: 0.14, metalness: 0.02 },
  crystal: { roughness: 0.2,  metalness: 0.08 },
  wood:    { roughness: 0.78, metalness: 0.02 },
  bone:    { roughness: 0.7,  metalness: 0.02 },
  obsidian:{ roughness: 0.24, metalness: 0.18 },
  celestial:{ roughness: 0.34, metalness: 0.2 },
}
```

The tray passes `resolution.roughness` / `resolution.metalness`, never the
authored values (`src/components/multiplayer/MultiplayerDie.tsx:84-96`). Every
set in this document therefore authors `roughness`/`metalness` **equal to its
material's `MATERIAL_PBR` row**, so the JSON documents the real look instead of
lying about it. Do not deviate from the table — a deviation renders identically
and misleads the next author.

**Consequence for design:** with only 11 materials and per-material fixed PBR,
two procedural sets sharing a material differ **only by `baseColor`**. Material
choice is a scarce resource. This wave deliberately spends four
never-yet-shipped materials (`celestial`, `wood`, `resin`, `glass`).

Material usage today: `plastic` (adventurer-starter), `metal` (lucky-bronze,
materials-lab steel), `stone` (dragon-jade, dark-dungeon), `crystal`
(void-crystal), `obsidian` (infernal-obsidian), `rubber` (materials-lab).
**Unused: `resin`, `glass`, `wood`, `bone`, `celestial`.**

### 2.3 Numerals are always white — the hard palette constraint

`src/lib/faceRenderers/glyphStyle.ts:44-46`:

```ts
export const EMBOSSED_GLYPH_STYLE: FaceGlyphStyle = {
  fill: 'white',
  weight: 'bold',
```

Every collectible die draws **bold white numerals with a black outline and drop
shadow** on the `baseColor` field. `accentColor` is carried through
`dicePresentation.ts:11` into the spawn payload and read by nothing.

The codebase already states the failure mode, at `src/lib/diceMaterial.ts:52-58`:

> *"painting white numerals on its white body would make it unreadable."*

The repo's own WCAG large-text threshold is **3:1** (`src/themes/contrast.ts:243`;
numerals render at ~0.45× canvas, comfortably "large"). Measured contrast of
`baseColor` against white:

| Existing set | baseColor | CR vs white | Verdict |
|---|---|---|---|
| infernal-obsidian mythic | `#1f2937` | 14.68 | excellent |
| dragon-jade rare | `#047857` | 5.48 | good |
| void-crystal legendary | `#8b5cf6` | 4.23 | acceptable |
| dragon-jade uncommon | `#059669` | 3.77 | acceptable |
| adventurer-starter | `#3b82f6` | 3.68 | acceptable |
| lucky-bronze | `#cd7f32` | 3.14 | marginal |
| dragon-jade common | `#10b981` | 2.54 | **fails 3:1** |
| **celestial-gold epic** | `#fbbf24` | **1.67** | **fails** — rescued only by the black outline |
| materials-lab steel | `#c2c7cf` | 1.70 | **fails** |
| materials-lab rubber | `#e9d5ff` | 1.36 | **fails** |

> **Authoring rule for this wave: `baseColor` must reach ≥ 4.5:1 against
> `#ffffff`.** Every set below is measured and passes. This is also why pale
> premium materials that the research surfaced — moonstone (`#c9d6e5`, 1.48),
> bone/ivory (`#e8dcc4`, 1.36), white howlite, rose quartz — **cannot ship
> procedurally**. They are ImageGen-only concepts, where the baked texture can
> carry dark engraved numerals instead.

### 2.4 The VFX vocabulary exists — as data, and only as data

A repo-wide search for `trailEffect|impactEffect|criticalAnimation|rollSound`
returns **only the four type declarations** at `src/types/inventory.ts:67-70`.
There is no particle system, no trail renderer, no critical-animation registry,
and no sound router. `src/lib/soundEffects.ts` exposes only
`playCollisionSfx(intensity)`, keyed on collision intensity — it never receives
a `rollSound` id. The `vfx` block is copied to the inventory die
(`collectibleCatalog.ts:163`) and never consulted.

The validator only requires `vfx` to be an **object**
(`catalog-edition-planner.js` `assertRecord`), so `{}` and
`{"trailEffect": "anything"}` both pass and render identically.

**The existing vocabulary — the complete set of strings already in use:**

| Field | Existing values (the whole vocabulary) |
|---|---|
| `trailEffect` | `sparkles`, `dragon-scales`, `golden-sparkles`, `void-particles`, `flame-trail` |
| `impactEffect` | `jade-shatter`, `light-burst`, `reality-crack`, `infernal-explosion` |
| `rollSound` | `metal_light`, `stone_mystical`, `metal_divine`, `crystal_ethereal`, `obsidian_demonic` |
| `criticalAnimation` | `dragon-roar`, `celestial-beam`, `void-collapse`, `hellfire-eruption` |

Note the casing split: the three visual fields are kebab-case, `rollSound` is
`snake_case` in a `<material>_<descriptor>` shape.

**Policy for this wave: reuse only these strings; invent nothing.** Every new id
is dead weight that implies an effect the engine will not deliver, and it grows
the surface a future VFX slice must implement. Each set below picks the closest
existing id and is explicitly marked *inert today*.

### 2.5 Rarity accent colors — and the tier-read inversion

`src/lib/rarityColor.ts` is the shipped rarity palette, and it is the **World of
Warcraft item-quality palette**, not the Genshin one:

```ts
export const RARITY_ACCENT_COLORS = {
  uncommon: '#1eff00', rare: '#0070dd', epic: '#a335ee',
  legendary: '#ff8000', mythic: '#e6cc80',
}
```

This matters more than it looks, because the PO-locked reveal minigame
(`docs/exec-plans/active/2026-07-27-gacha-reveal-minigame.md`, decision 3) makes
each die **glow in its rarity color** on settle. So a die's body color is about
to be seen next to its rarity glow.

**Current catalog has an inversion:** `celestial-gold` is the *epic* set but is
gold `#fbbf24` — which reads as legendary/mythic; `void-crystal` is the
*legendary* set but is purple `#8b5cf6` — which is almost exactly the epic
accent `#a335ee`. The two top tiers currently signal each other's rank.

This wave does not repaint existing sets (they are frozen catalog history), but
every new set is chosen so its body color **does not impersonate a different
tier's accent**: the new signature and epic sets are deliberately achromatic or
cool-dark, letting the orange/purple rarity glow do the tier signalling rather
than competing with it.

#### The rare/epic glow is not distinguishable — measured

Simulating the shipped palette (Viénot, Brettel & Mollon 1999 dichromat
projection over linear sRGB) and taking WCAG contrast between adjacent tiers:

| Adjacent tiers | Normal vision | Deuteranopia | Protanopia |
|---|---|---|---|
| uncommon vs rare | 3.52 | 3.41 | 3.71 |
| **rare vs epic** | **1.01** | **1.12** | **1.31** |
| epic vs legendary | 1.94 | 1.98 | 1.85 |
| legendary vs mythic | 1.60 | 1.46 | 1.94 |

`rare #0070dd` and `epic #a335ee` are **1.01:1 apart under normal colour
vision** — they have almost identical relative luminance, so the two mid tiers
are near-indistinguishable for *everyone*, not only for colour-blind players.
Colour-vision deficiency is not the cause here; it merely keeps the pair
collapsed (1.12 / 1.31). Under deuteranopia the palette also folds
`uncommon #1eff00` and `legendary #ff8000` into the same yellow family
(`#dbdb29` / `#b2b200`).

This is a genre-wide trap, not a local mistake — the same 3★-blue/4★-purple
collapse is measurable across shipped gacha palettes. The industry answer is
that **rarity is never carried by hue alone**: star pips, frame shape, and a
text label ride along as redundant channels.

> **Requirement this places on the reveal minigame.** PO-locked decision 3 of
> `2026-07-27-gacha-reveal-minigame.md` makes the settle glow *the* rarity tell.
> A hue-only glow cannot distinguish rare from epic. The reveal needs at least
> one redundant channel — glow **intensity/duration**, a particle count step, an
> audio stinger, or the rarity label in the summary. Flagged for the reveal
> slice owner; it is a design bug in the current spec, not a content problem,
> and no choice of dice colours can fix it.

### 2.6 Per-die display names are generated, not authored (procedural path)

`scripts/generate-collectible-catalog.js:227`:

```js
name: `${set.name} ${diceType.toUpperCase()}`,
```

A configured (procedural) set gets **one name template for all six dice** —
`"Dragon Jade Collection D20"`. There is no per-die name field on the
procedural path. Bespoke per-die names exist only on:

- `standaloneItems` — explicit `name` (`"Steel d20"`), and
- ImageGen/GLTF sets — explicit `name` per die (`"Dread Gate D20"`).

So the per-die name tables in §5 are **ImageGen-path names**. On the procedural
path tonight, a set's dice will be named `"<Set Name> D4"` … `"<Set Name> D20"`.
Getting bespoke names onto procedural dice is a generator change, not data.

### 2.7 Catalog key shapes

| Path | catalogKey | Example |
|---|---|---|
| Configured (procedural) | `setId/diceType/rarity` | `void-crystal/d20/legendary` |
| Standalone / GLTF | `setId/dieId` | `materials-lab/steel-d20` |

`id = catalogKey@contractVersion`; `assetVersionId = id/asset@N`
(`generate-collectible-catalog.js:182-195`). DB constraint
`catalog_key ~ '^[a-z0-9][a-z0-9/_-]*$'`
(`supabase/migrations/0004_collectible_catalog.sql:31-32`). Set ids stay
kebab-case.

**One configured set yields 6 dice × (number of rarity variants).** Every set in
this wave declares exactly one rarity variant → **6 catalog items each**.

---

## 3. Research digest

### 3.1 What makes physical premium dice covetable

The artisan market splits into a manufacturing tier that drives the whole visual
language. [Norse Foundry's True Metal line](https://www.norsefoundry.com/collections/true-metal-dice)
machines dice from real bar stock — Brass/Bronze/Stainless **$200/set**,
Damascus Steel **$500**, Titanium $575, Tungsten $850 — and leans into the fact
that they *tarnish*: "each piece will tarnish and may come tarnished… we use
REAL DAMASCUS STEEL" ([Damascus 7-set](https://www.norsefoundry.com/products/set-of-7-damascus-steel-rpg-dice-by-norse-foundry-polyhedral-dice-set)).
Below it, [Die Hard's Mythica line](https://www.dieharddice.com/collections/mythica-dice/metal)
is die-cast zinc + electroplate at $35–60, and that is where the *named finish*
vocabulary lives — Battleworn Copper, Dark Iron, Copper Onyx, Shadowcrown.

Four recurring signals of "grail":

1. **Non-repeatability.** The single most consistent claim in the category:
   "no two dice ever looking the same" (Norse Foundry Damascus), "each and every
   die a unique one off pattern" ([Artisan Dice Timascus](https://www.artisandice.com/order/timascus-dice-titanium-damascus/)),
   "no two sets will ever be exactly the same" ([Wyrmwood](https://wyrmwood.zendesk.com/hc/en-us/articles/4405032177691-Gemstone-Dice)).
   Collectors "specifically seek out the variation rather than tolerating it"
   ([RollHoard](https://rollhoard.com/guides/how-to-choose-ttrpg-dice/)).
2. **Authenticity through decay.** Tarnish, patina, verdigris, "battleworn",
   "Raw and unpainted, as the Maker intended" ([Die Hard Battleworn Copper](https://www.dieharddice.com/products/mythica-battleworn-copper)).
   Norse Foundry sells bronze on the promise it "naturally develops a darkened
   green patina" ([Bronze d20](https://www.norsefoundry.com/products/single-d20-in-bronze-by-norse-foundry)).
3. **Deep-time provenance.** Bog oak "over 5,000 years in an Eastern European
   swamp" ([Artisan Dice](https://www.artisandice.com/order/ancient-bog-wood/)),
   Late Jurassic [dinosaur bone](https://www.artisandice.com/order/dino-bone-dice/),
   4.5-billion-year meteorite. The story is priced.
4. **Sharp edge.** Zero-chamfer casting, which [Awesome Dice](https://www.awesomedice.com/collections/sharp-edge-dice)
   dates to a 2019 boom. Prized for fairness framing, for the hard specular
   break that lets you see into the resin, and because it cannot be tumbled —
   [Dispel](https://www.kickstarter.com/projects/dispeldice/dispel-dice/faqs)
   notes their designs "can only be hand made due to the sharp edges."

Gemstone optical behaviour is four physically distinct phenomena, and they are
*not* interchangeable: **labradorescence** (thin-film interference in 50–250 nm
lamellae — [gemmology.dev](https://gemmology.dev/learn/phenomena/labradorescence/),
[Eur. J. Mineralogy 34:393](https://ejm.copernicus.org/articles/34/393/2022/)),
**adularescence** (moonstone's soft uniform glow), **play-of-color** (opal's
diffraction domains — [Australian Museum](https://australian.museum/learn/minerals/gemstones/opal/)),
and **chatoyancy** (tiger's eye's moving band, perpendicular to the fibres —
[Geology.com](https://geology.com/gemstones/chatoyancy/)).

> **The most useful single fact found:** real labradorite dice flash on only
> **1–2 faces per die** — "You will only find 1–2 faces with the labradorescence
> on each die" ([Runic Dice](https://www.runicdice.com/blogs/news/labradorite-dice-sets-care-and-buying-guide)),
> and sourcing full-coverage flash is the hard part
> ([Dice Craft Lab](https://dicecraftlab.com/buying-guides/gemstone-dice/)).
> A labradorite die is a **dull blue-grey solid most of the time**. That makes
> it one of the *better* procedural candidates in the premium tier, and it means
> a uniformly-iridescent labradorite would read as cheap, not expensive.

Also load-bearing: dark bodies read best. "Light-colored number fills pop
against the dark surface" for obsidian, while rose quartz is "one of the hardest
gemstone dice to read across a table" ([Dice Craft Lab](https://dicecraftlab.com/buying-guides/gemstone-dice/)).
That is the physical-world version of our §2.3 contrast rule.

### 3.2 Procedural vs texture — the classification that drives this wave

| Class | Reads correctly from `baseColor` + material alone? | Examples |
|---|---|---|
| **A — flat** | Yes | obsidian, hematite, gunmetal/blackened steel, plain titanium/tungsten, polished brass/bronze/copper, solid-pour resin (gloss or ultra-matte), ebony and very dark hardwoods, glow-in-dark |
| **B — flat + view-dependent term** | Almost — needs a shader term, not a bitmap | moonstone adularescence, UV/heat colour-shift, pearlescence, goldstone aventurescence, glitter |
| **C — requires texture** | **No** | Damascus swirl, Timascus/scorched oxide zones, mokume-gane, meteorite Widmanstätten lattice, labradorite flash, opal play-of-color, tiger's eye banding, malachite/agate/fluorite banding, lapis pyrite flecks, galaxy/nebula resin, petri cells, inclusions, gold leaf |
| **D — geometry** | N/A — mesh or normal map | sharp edge, dragon-scale relief, recessed numerals + ink fill |
| **E — animated** | N/A — needs simulation | liquid core (it "moves when the die is rolled", and is deliberately unbalanced — [Dice Envy](https://diceenvy.com/collections/sharp-edge)) |

Class A is tonight's procedural wave. Class C is the ImageGen kit list. Class D
is partially available to us — the ImageGen pipeline derives a **normal map**
(`derive-theme-normal-maps.mjs`), so engraved numerals and relief *are*
reachable on the textured path, but sharp-edge geometry is not (die meshes are
canonical and frozen).

### 3.3 Gacha rarity-tier design language

The near-universal convention is gold → purple → blue descending. Genshin's
3-star items are blue, 4-star purple, 5-star gold, and the wish animation
escalates in tandem, with the 5-star reveal leaning on gold and "vibrant hues
signifying wealth, prestige, and ultimate rarity"; 3- and 4-star animations are
"more subdued" ([Genshin wish animation analysis](https://img.krmangalam.edu.in/star-base/genshin-impact-5-star-wish-animation-secrets-1764806225),
[Destructoid: standard banner](https://www.destructoid.com/genshin-impact-wishes-explained-the-standard-banner/)).

**Our palette is WoW's, not Genshin's** (§2.5), so we inherit orange-legendary
rather than gold-five-star. The design consequence is the same either way:
*escalation is carried by the tier accent, so the item body should not fight
it.*

**Escalation is on chroma, not brightness.** Measuring shipped assets rather
than repeating folklore: Genshin's 5★ plate is a *muted amber* around `#E0AF5F`
at roughly 68% saturation while its 1–4★ plates sit at 8–28%, with lightness
held roughly flat — the tier climbs in **saturation**, not brightness, and the
gold is emphatically **not** `#FFD700`. Star Rail escalates on **hue** instead:
its 5★ gold (`#B28C6C`→`#CBAE83`) is *less* saturated than its own 3★ blue and
reads premium only because it is the sole warm tier in the set. Neither game
uses a flat fill — plates are a dark→light diagonal gradient. Community design
tokens converge on 5★ `#FFD070`, 4★ `#AF86FF`, 3★ `#699DED`, 2★ `#68D391`,
1★ `#AFAFAF`.

Two things follow for us. First, the "make it gold and bright" instinct is
wrong; **saturation and warmth carry rank, and a gradient reads richer than a
flat fill** — relevant to the reveal glow and to any future rarity chrome, not
to the dice themselves. Second, and more useful tonight: since our tier accents
are fixed and partly collapsed (§2.5), the *dice* should stay low-chroma and let
the accent be the saturated element. Every set in this wave is desaturated
relative to its tier accent, which is the correct direction.

**How much VFX is too much.** The most transferable statement of the principle
is Riot's VFX style guide: *visual impact should represent gameplay impact* —
escalate the **primary** element's value and saturation contrast, and actively
*suppress* secondary elements (keep them small and low value-range) so the
primary reads. Prestige comes from restraint and hierarchy, not particle count.
Genre practice reinforces it by going **multi-channel rather than louder**: Star
Rail changes the music before any colour is visible, FGO steps a ring
blue→gold→rainbow, Genshin's Capturing Radiance tell is gold light turning
purple and sparkling, and Wuthering Waves deliberately locks the colour at
animation start so there is no mid-animation upgrade tease.

> This is the design argument behind **Ashvow** (§5.7) and behind its empty
> `vfx` block: at the point where every tier has a trail and a burst, the trail
> and the burst stop meaning anything. It is also the argument for the reveal
> room's staged finale being **colour + audio + one primary glow channel** and
> nothing else.

**Naming registers.** Genshin's five-star weapons read as possessive proper
nouns and compound epithets — *Wolf's Gravestone*, *Primordial Jade
Winged-Spear*, *Mistsplitter Reforged*, *Staff of Homa*, *Aquila Favonia*,
*Lost Prayer to the Sacred Winds* ([5-star weapon list](https://game8.co/games/Genshin-Impact/archives/304647),
[Genshin Wiki](https://genshin-impact.fandom.com/wiki/Category:5-Star_Weapons)).
Four-stars read as *series* names — the **Favonius** series, the **Sacrificial**
series, *The Widsith* — institutional and repeatable rather than singular.
Artifact sets take the "X of Y" form: *Crimson Witch of Flames*, *Emblem of
Severed Fate*, *Gladiator's Finale* ([artifact set list](https://game8.co/games/Genshin-Impact/archives/297493)).

Cross-referencing the artifact corpus by rarity ceiling exposes the underlying
**ladder**, which is more useful than the individual examples: low-rarity names
are *possessive + literal object* (**Adventurer's** Flower, **Berserker's**
Rose), while top-rarity names either drop the possessive or swap the literal
object for an **abstract noun or a loanword** (Gladiator's **Triumphus**, Ornate
**Kabuto**, **Shadow of the Sand King**). The axis is
`possessive+concrete → abstract/foreign`. Note also the *Noblesse Oblige*
pattern: a set-level name can be premium while individual piece names stay
plain — which is exactly our situation, since procedural per-die names are
forced to `"<Set Name> D20"` (§2.6).

Adopted for this wave:

| Tier | Position on the ladder | Shape |
|---|---|---|
| signature (legendary) | abstract noun / dropped possessive | a phrase that could not name a *series* — *Ten Thousand Folds* (abstract quantity), *Stormglass* (compound, no possessive) |
| epic | concrete noun + institutional noun | *Bogwood Reliquary*, *Amberfall* |
| rare | plain compound noun, series-able | *Verdigris Vigil*, *Abyssal Glass*, *Ashvow* |

The already-authored `fantasy-earth` set independently matches this ladder
in-set — `runeleaf-d4` (literal) climbing to `aurelian-d20` (proper/abstract) —
so the convention is consistent with work already in flight.

No "Collection" suffix on new sets: the three existing `*-imagegen-set` sets
already dropped it (*Cozy Forest Relics*, *Dark Dungeon Armory*, *Neon Street
Overdrive*) and the shorter form reads more premium.

**Banner names follow a different split from item names.** Permanent banners
take **institutional** names (*Wanderlust Invocation*, *Stellar Warp*); limited
banners take **bespoke poetic** ones, averaging about three words (*Ballad in
Goblets*, *Nessun Dorma*). Applied to us:

| Banner | Register | Suggestion |
|---|---|---|
| standard (permanent) | institutional | *Standing Invitation* / *Common Cast* |
| premium (rotating) | bespoke poetic, ~3 words | *Ten Thousand Folds* rotation → **"Song of the Anvil"** |

A rotating banner should be renamed each rotation; the set name and the banner
name should **not** be the same string, so that the banner can outlive the set.

---

## 4. Roster

| # | Set | Set id | Economy tier | Rarity | Material | baseColor | CR vs white | Procedural fidelity | ImageGen rank |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Ten Thousand Folds | `ten-thousand-folds` | signature | legendary | `metal` | `#2f343b` | 12.54 | **2 / 5** | **1 — flagship** |
| 2 | Stormglass | `stormglass` | signature | legendary | `celestial` | `#2b3a52` | 11.48 | **3 / 5** | **2 — flagship** |
| 3 | Bogwood Reliquary | `bogwood-reliquary` | epic | epic | `wood` | `#2b1d14` | 16.30 | **4 / 5** | 4 |
| 4 | Amberfall | `amberfall` | epic | epic | `resin` | `#6b380c` | 9.56 | **3 / 5** | **3 — flagship** |
| 5 | Verdigris Vigil | `verdigris-vigil` | rare | rare | `metal` | `#1f6b5e` | 6.32 | **3 / 5** | 5 |
| 6 | Abyssal Glass | `abyssal-glass` | rare | rare | `glass` | `#12306b` | 12.64 | **4 / 5** | 6 |
| 7 | Ashvow | `ashvow` | rare | rare | `stone` | `#26292e` | 14.59 | **5 / 5** | 7 (not needed) |
| — | Quicksilver Core | `quicksilver-core` | *deferred* | — | — | — | — | **1 / 5** | concept only — §6 |

Pool effect: signature 6 → 12 items (Stormglass only; see §4.1), epic 6 → 18,
rare 9 → 27. Four never-shipped materials enter the catalog (`celestial`,
`wood`, `resin`, `glass`).

### 4.1 Banner placement — Ten Thousand Folds is the premium featured candidate

Per `docs/exec-plans/active/2026-07-22-monetization-economy-spec.md` §1.4 and the
draft `economy/drafts/monetization/premium-featured-rate-up.draft.json`, the
premium banner's featured die is the **sole signature-tier item** at 0.6%
rate-up with hard pity 75. That structure only works if the featured set is
*not* also in the standard signature pool.

Recommendation:

- **Ten Thousand Folds → premium banner featured only.** Do not add it to the
  standard-banner `signature` tier. It replaces the
  `draft-premium/featured-signature-die@1` placeholder ids in the draft banner.
- **Stormglass → standard banner `signature` tier.** This doubles the standard
  signature pool (6 → 12) so the 1-weight tier stops being a single set.

Note the spec's own open flag (§6.1 "Scrap makes featured dice re-chaseable"):
with a **6-die** featured set and `selectedFeaturedUnowned` selecting
lowest-canonical-id-unowned, a player can scrap a specific die to steer which
die the 75-pull guarantee awards. If that steering is unacceptable, the premium
featured target should be a **single die** (e.g. `wyrmpattern-d20` alone) with
the other five sold or awarded another way. **This is a PO decision, flagged not
resolved.**

---

## 5. Set specifications

Each set gives (a) the procedural block to paste into
`src/config/collectibleCatalogSource.json` `configuredSets`, and (b) the
ImageGen art direction for `scripts/imagegen-uv/theme-workshop-data.mjs`.

`roughness`/`metalness` in every procedural block are set **equal to the
material's `MATERIAL_PBR` row** (§2.2) so the data documents reality.
`accentColor` and `vfx` are authored for future use and are **inert today**.

---

### 5.1 Ten Thousand Folds — signature (legendary) — premium banner featured

**Hook.** A blade-smith's billet folded until the count stopped meaning
anything. The pattern is not decoration; it is the record of the folding. Every
die shows a different section through the same billet — no two faces repeat, and
no two sets ever will.

Grounded in the real grail: Norse Foundry's [Damascus Steel 7-set](https://www.norsefoundry.com/products/set-of-7-damascus-steel-rpg-dice-by-norse-foundry-polyhedral-dice-set)
at $500 with its "signature swirl patterned finish," brushed rather than
mirrored, and gold numerals for contrast on the sibling
[Hydra Scorched](https://www.norsefoundry.com/products/set-of-7-hydra-scorched-titanium-rpg-dice-by-norse-foundry-polyhedral-dice-set).

```json
{
  "id": "ten-thousand-folds",
  "name": "Ten Thousand Folds",
  "description": "A billet folded past counting, then acid-etched to reveal the record of its making. The pattern runs all the way through; no two faces repeat.",
  "theme": {
    "colorPalette": ["#2f343b", "#8d949e", "#d9c88a"],
    "materialType": "metal",
    "visualStyle": "fantasy"
  },
  "rarityVariants": {
    "legendary": {
      "appearance": {
        "baseColor": "#2f343b",
        "accentColor": "#d9c88a",
        "material": "metal",
        "metalness": 1.0,
        "roughness": 0.28
      },
      "vfx": {
        "trailEffect": "sparkles",
        "impactEffect": "light-burst",
        "rollSound": "metal_divine",
        "criticalAnimation": "celestial-beam"
      }
    }
  },
  "availability": "limited",
  "releaseDate": 0
}
```

**Procedural fidelity: 2 / 5.** The lowest score in the wave, and it is
deliberate — this set exists to be the ImageGen flagship. Damascus *is* its
swirl: etching two alloys that etch at different rates produces simultaneous
albedo and micro-topography variation. Stripped of that, `#2f343b` at
`metal` PBR is indistinguishable from plain gunmetal, i.e. from the cheapest
premium metal in the category. The one thing that survives is the d20's
matte-numeral mask (`renderMetalMaskD20`, `diceMaterial.ts:71-73`), which gives
glossy faces with matte painted numerals — a genuine, correct premium-metal
cue. Ship procedurally only as a placeholder; **this set is not finished until
the ImageGen pass lands.**

**ImageGen art direction** (`theme-workshop-data.mjs` entry):

```js
{
  id: 'ten-thousand-folds',
  themeId: 'dungeon-castle',
  setId: 'ten-thousand-folds-imagegen-set',
  name: 'Ten Thousand Folds',
  releaseDate: '2026-08-03',
  status: 'authoring',
  description: 'Acid-etched pattern-welded steel dice with flowing light-and-dark folded bands and recessed antique-gold numerals.',
  tags: ['ten-thousand-folds', 'damascus', 'pattern-welded', 'steel', 'smithing', 'codex-imagegen'],
  materialPrompt: 'authentic acid-etched pattern-welded Damascus steel dice, flowing organic light-silver and charcoal-grey folded bands with feathered ladder and raindrop figuring running continuously across every face, brushed satin finish rather than mirror polish, faint forge-scale mottling and honest tarnish in the low areas, deeply recessed antique-gold inlaid Arabic numerals with softly worn highlights, heirloom smithing rather than printed or painted pattern, no repeated tiling, no text, no maker marks',
  material: { roughness: 0.45, metalness: 0.92, normalScale: 0.75 },
  physics: { density: 0.95, restitution: 0.22, friction: 0.55 },
  environment: { /* reuse dungeon-castle floor/wall/skybox — see §7.2 */ },
  dice: {
    d4:  { id: 'sparkfold-d4',     name: 'Sparkfold D4' },
    d6:  { id: 'billetheart-d6',   name: 'Billetheart D6' },
    d8:  { id: 'quenchline-d8',    name: 'Quenchline D8' },
    d10: { id: 'acidbloom-d10',    name: 'Acidbloom D10' },
    d12: { id: 'layerwake-d12',    name: 'Layerwake D12' },
    d20: { id: 'wyrmpattern-d20',  name: 'Wyrmpattern D20' },
  },
}
```

`physics.density: 0.95` makes it the heaviest set in the game (existing range
0.38–0.62) — "satisfying heft" is the most-cited reason collectors buy metal
([Misty Mountain](https://mistymountaingaming.com/blogs/dungeon-feed/the-collector-s-guide-to-d20-dice)),
and per-set physics is real on the GLB path.

---

### 5.2 Stormglass — signature (legendary) — standard banner

**Hook.** Cut from a stone that is grey until it isn't. Turn it in the light and
one face — never the same one — catches fire in blue and gold, then goes dark
again. Collectors pay for the faces that flash; the smith cannot promise which.

**Procedural fidelity: 3 / 5 — and this is the honest surprise of the wave.**
Because a real labradorite die only flashes on
[1–2 faces](https://www.runicdice.com/blogs/news/labradorite-dice-sets-care-and-buying-guide),
a dull blue-grey solid *is* what the die looks like most of the time. The
procedural version is a truthful rendering of the material's resting state; it
is only missing the payoff. `material: "celestial"` is chosen because it is the
only unused material whose PBR (`roughness 0.34, metalness 0.2`) sits in the
polished-feldspar range **and** because the inventory preview gives `celestial`
a default `emissiveIntensity` of 0.18 when none is authored
(`SharedInventoryDicePreviewCanvas.tsx:302`) — a faint inner light that reads as
adularescence in the collection view. Authoring `emissive` + `emissiveIntensity`
strengthens that, in the preview only.

```json
{
  "id": "stormglass",
  "name": "Stormglass",
  "description": "Grey stone that hides a storm. Tilt it and a single face ignites blue and gold, then goes dark again — the smith cannot promise which face, only that it is there.",
  "theme": {
    "colorPalette": ["#2b3a52", "#4a7fb5", "#c9a227"],
    "materialType": "celestial",
    "visualStyle": "fantasy"
  },
  "rarityVariants": {
    "legendary": {
      "appearance": {
        "baseColor": "#2b3a52",
        "accentColor": "#c9a227",
        "material": "celestial",
        "metalness": 0.2,
        "roughness": 0.34,
        "emissive": "#4a7fb5",
        "emissiveIntensity": 0.28
      },
      "vfx": {
        "trailEffect": "void-particles",
        "impactEffect": "light-burst",
        "rollSound": "crystal_ethereal",
        "criticalAnimation": "celestial-beam"
      }
    }
  },
  "availability": "always",
  "releaseDate": 0
}
```

**ImageGen art direction:**

```js
{
  id: 'stormglass',
  themeId: 'default',
  setId: 'stormglass-imagegen-set',
  name: 'Stormglass',
  releaseDate: '2026-08-03',
  status: 'authoring',
  description: 'Polished labradorite dice, dull storm-grey across most faces with one or two igniting in directional blue-gold labradorescence.',
  tags: ['stormglass', 'labradorite', 'gemstone', 'labradorescence', 'schiller', 'codex-imagegen'],
  materialPrompt: 'polished natural labradorite gemstone dice, deep storm-grey and slate-blue feldspar body with fine internal lamellar striations, most faces quiet and matte-dark, one or two faces igniting with broad directional labradorescent schiller flash in peacock blue, teal and warm gold confined to sharp-edged patches rather than covering the whole face, subtle stone translucency at the edges, crisply engraved pale champagne-gold Arabic numerals with dark recesses, genuine mineral specimen rather than glitter, iridescent paint, or uniform holographic sheen',
  material: { roughness: 0.28, metalness: 0.22, normalScale: 0.55 },
  physics: { density: 0.7, restitution: 0.3, friction: 0.62 },
  environment: { /* new or reuse default — see §7.2 */ },
  dice: {
    d4:  { id: 'flashpoint-d4',  name: 'Flashpoint D4' },
    d6:  { id: 'coldfire-d6',    name: 'Coldfire D6' },
    d8:  { id: 'lamella-d8',     name: 'Lamella D8' },
    d10: { id: 'duskflare-d10',  name: 'Duskflare D10' },
    d12: { id: 'auroragate-d12', name: 'Auroragate D12' },
    d20: { id: 'stormglass-d20', name: 'Stormglass D20' },
  },
}
```

> Art-direction note the ImageGen owner must not lose: **do not flash every
> face.** The prompt deliberately says "one or two faces." A uniformly
> iridescent die reads as cheap holographic plastic, which is the opposite of
> the $100+ material being referenced.

---

### 5.3 Bogwood Reliquary — epic

**Hook.** Oak that went into a Northern European swamp before anyone wrote
anything down and came out five thousand years later stained almost black —
tannins and minerals having crept through the grain in an oxygen-starved dark.
It is not carved to look ancient. It is ancient.

Sourced from [Artisan Dice's Ancient Bog Wood](https://www.artisandice.com/order/ancient-bog-wood/)
("an early stage of petrification," "an enduring relic of darkness") and the
[GeekDad interview](https://geekdad.com/2015/09/bog-wood-and-mammoth-bones/).

**Procedural fidelity: 4 / 5.** Bog oak is genuinely near-uniform: at die scale
its grain is low-contrast and sub-perceptual against a near-black body, which is
exactly the Class-A condition. `material: "wood"` (`roughness 0.78`) gives the
dry, unlacquered look the real material has. What is lost is only the faint
grain direction — worth a texture pass eventually, not urgently.

```json
{
  "id": "bogwood-reliquary",
  "name": "Bogwood Reliquary",
  "description": "Oak that lay five thousand years in an airless swamp, stained black by tannin and mineral. Not carved to look ancient — simply ancient.",
  "theme": {
    "colorPalette": ["#2b1d14", "#5c4632", "#b08d57"],
    "materialType": "wood",
    "visualStyle": "fantasy"
  },
  "rarityVariants": {
    "epic": {
      "appearance": {
        "baseColor": "#2b1d14",
        "accentColor": "#b08d57",
        "material": "wood",
        "metalness": 0.02,
        "roughness": 0.78
      },
      "vfx": {
        "trailEffect": "sparkles",
        "impactEffect": "jade-shatter",
        "rollSound": "stone_mystical",
        "criticalAnimation": "dragon-roar"
      }
    }
  },
  "availability": "always",
  "releaseDate": 0
}
```

**ImageGen art direction** — `materialPrompt`:

> `'ancient bog oak dice, near-black brown petrified heartwood with tight dark grain and faint mineral staining, dry unlacquered satin surface with soft edge wear, occasional hairline age fissures filled with pale sediment, slender aged brass corner banding, deeply engraved warm antique-brass Arabic numerals sitting in dark recesses, five-thousand-year-old swamp-preserved timber rather than stained modern wood, sombre and reverent, no bark, no knots, no text'`

`material: { roughness: 0.7, metalness: 0.12, normalScale: 0.6 }`,
`physics: { density: 0.4, restitution: 0.26, friction: 0.72 }`.
Die names: `barrowgrain-d4`, `peatheart-d6`, `tannin-d8`, `slowdark-d10`,
`fenwood-d12`, `reliquary-d20`.

---

### 5.4 Amberfall — epic

**Hook.** Resin that fell from a tree before there were bees, and kept whatever
fell in with it. Hold it to a lamp and something small and very old is still in
there, mid-motion.

**Procedural fidelity: 3 / 5.** Deep amber's *colour* is honest at
`material: "resin"` (`roughness 0.42` — the semi-gloss the real material has),
and `#6b380c` is dark enough for white numerals (CR 9.56). What is missing is
the two things that make amber amber: **translucency** and **inclusions**. The
renderer only applies transparency to `glass` and `crystal`
(`SharedInventoryDicePreviewCanvas.tsx:303-304`), so `resin` renders opaque,
and inclusions are Class C by definition. Reads as a good dark-caramel resin
die; does not yet read as amber. Strong ImageGen candidate precisely because
inclusions are what the texture buys.

```json
{
  "id": "amberfall",
  "name": "Amberfall",
  "description": "Resin that fell before there were bees, and kept what fell in with it. Held to a lamp, something small and very old is still in there.",
  "theme": {
    "colorPalette": ["#6b380c", "#c17817", "#f0c987"],
    "materialType": "resin",
    "visualStyle": "fantasy"
  },
  "rarityVariants": {
    "epic": {
      "appearance": {
        "baseColor": "#6b380c",
        "accentColor": "#f0c987",
        "material": "resin",
        "metalness": 0.08,
        "roughness": 0.42
      },
      "vfx": {
        "trailEffect": "golden-sparkles",
        "impactEffect": "light-burst",
        "rollSound": "stone_mystical",
        "criticalAnimation": "celestial-beam"
      }
    }
  },
  "availability": "always",
  "releaseDate": 0
}
```

**ImageGen art direction** — `materialPrompt`:

> `'translucent Baltic amber dice, deep honey and burnt-cognac resin with visible internal flow lines, suspended air bubbles, drifting flecks of dark plant debris and one small ancient winged insect inclusion per die, warm light scattering through the body with glowing bright edges against darker cores, faint craquelure near the surface, crisply engraved deep-bronze Arabic numerals, genuine fossil resin rather than orange glass, plastic, or glitter'`

`material: { roughness: 0.22, metalness: 0.08, normalScale: 0.45 }`,
`physics: { density: 0.32, restitution: 0.42, friction: 0.5 }` — amber is light
and lively, the counterweight to Ten Thousand Folds' 0.95.
Die names: `sapdrop-d4`, `resinseed-d6`, `wingcase-d8`, `goldenvein-d10`,
`sunsnare-d12`, `amberfall-d20`.

---

### 5.5 Verdigris Vigil — rare

**Hook.** Bronze left out on purpose. The green is not damage — it is the metal
finishing itself, and the smith who polished it back would be undoing the work.

The most reproducible premium-metal cue in the research: antiquing that darkens
recesses while raised surfaces stay bright, which
[Die Hard](https://www.dieharddice.com/products/mythica-battleworn-copper)
explicitly credits for legibility, and Norse Foundry's promise that bronze
"naturally develops a darkened green patina."
([Verdigris background](https://halmanthompson.com/what-is-verdigris/).)

**Procedural fidelity: 3 / 5.** The colour is right and `metal` PBR gives the
correct sheen, but the *entire point* of a battleworn finish is
cavity-contrast — dark in the recesses, bright on the raised metal — and we have
no curvature/AO mask in `MeshStandardMaterial` (`diceMaterial.ts:108`; no
`MeshPhysicalMaterial` is constructed anywhere in `src/`). A flat verdigris
green reads as painted metal rather than aged metal. Noted in §7.3 as the
highest-value non-texture engine upgrade available.

```json
{
  "id": "verdigris-vigil",
  "name": "Verdigris Vigil",
  "description": "Bronze left out on purpose. The green is not damage — it is the metal finishing itself, and polishing it back would undo the work.",
  "theme": {
    "colorPalette": ["#1f6b5e", "#3fa08c", "#cfa14a"],
    "materialType": "metal",
    "visualStyle": "fantasy"
  },
  "rarityVariants": {
    "rare": {
      "appearance": {
        "baseColor": "#1f6b5e",
        "accentColor": "#cfa14a",
        "material": "metal",
        "metalness": 1.0,
        "roughness": 0.28
      },
      "vfx": {
        "trailEffect": "sparkles",
        "impactEffect": "jade-shatter",
        "rollSound": "metal_light",
        "criticalAnimation": "dragon-roar"
      }
    }
  },
  "availability": "always",
  "releaseDate": 0
}
```

---

### 5.6 Abyssal Glass — rare

**Hook.** Poured, not cut. A cobalt so deep it only admits it is blue at the
edges, where the light gets through.

**Procedural fidelity: 4 / 5.** `material: "glass"` is one of the few places the
renderer does something genuinely material-specific: the inventory preview sets
`transparent: true, opacity: 0.66` for glass
(`SharedInventoryDicePreviewCanvas.tsx:303-304`), and `MATERIAL_PBR.glass` gives
`roughness 0.14` — a real gloss. Deep cobalt glass is Class A (a volume tint
with no internal pattern), so this is close to a faithful rendering. Caveat: the
transparency applies in the **preview only**, not the tray, so the rolled die
looks like opaque dark-blue gloss.

```json
{
  "id": "abyssal-glass",
  "name": "Abyssal Glass",
  "description": "Poured, not cut. A cobalt so deep it only admits to being blue at the edges, where the light gets through.",
  "theme": {
    "colorPalette": ["#12306b", "#2a5da8", "#9dc4f0"],
    "materialType": "glass",
    "visualStyle": "fantasy"
  },
  "rarityVariants": {
    "rare": {
      "appearance": {
        "baseColor": "#12306b",
        "accentColor": "#9dc4f0",
        "material": "glass",
        "metalness": 0.02,
        "roughness": 0.14
      },
      "vfx": {
        "trailEffect": "void-particles",
        "impactEffect": "reality-crack",
        "rollSound": "crystal_ethereal",
        "criticalAnimation": "void-collapse"
      }
    }
  },
  "availability": "always",
  "releaseDate": 0
}
```

---

### 5.7 Ashvow — rare

**Hook.** No shine, no story, no apology. A single pour of charcoal resin sanded
to dead matte, so that the only thing you look at is the number.

The research's sleeper finding: ultra-matte is a *deliberate* premium
differentiator in the artisan market (Dice Envy's *Ozymandias* is sold on being
"gold ultra matte" — [Dice Envy sharp edge](https://diceenvy.com/collections/sharp-edge)),
and a "perfectly executed solid-color set with sharp, clear numbers" is listed
first among techniques by [Dice Craft Lab](https://dicecraftlab.com/techniques/dice-making-techniques/).

**Procedural fidelity: 5 / 5 — the only perfect score in the wave.** A
solid-pour matte die *is* a flat colour at high roughness. `material: "stone"`
gives `roughness 0.86`, and `#26292e` is near-black with 14.59:1 numeral
contrast. There is literally nothing a texture would add. **This is the set to
ship first tonight and the one that needs no ImageGen pass at all.**

```json
{
  "id": "ashvow",
  "name": "Ashvow",
  "description": "No shine, no story, no apology. One pour of charcoal sanded to dead matte, so the only thing you look at is the number.",
  "theme": {
    "colorPalette": ["#26292e", "#4a4f57", "#e8e8e8"],
    "materialType": "stone",
    "visualStyle": "minimalist"
  },
  "rarityVariants": {
    "rare": {
      "appearance": {
        "baseColor": "#26292e",
        "accentColor": "#e8e8e8",
        "material": "stone",
        "metalness": 0.02,
        "roughness": 0.86
      },
      "vfx": {}
    }
  },
  "availability": "always",
  "releaseDate": 0
}
```

> `vfx: {}` is intentional. Ashvow's entire pitch is restraint, and since every
> vfx id is inert anyway (§2.4), an empty block is the honest authoring choice.

---

## 6. Deferred flagship concept — Quicksilver Core

**Not shippable in this wave. Logged so it is not re-derived later.**

Liquid-core dice are the one artisan category that cannot be a texture *or* a
procedural material: the fill "moves when the die is rolled," and makers include
a deliberate air bubble to make the motion visible
([Dice Craft Lab liquid core](https://dicecraftlab.com/techniques/liquid-core-dice-how-to-make/)).
Rendering it needs an inner mesh or a parallax shader driven by the die's
angular velocity — which we uniquely *can* do, because the room core already
streams authoritative angular state at 60 Hz.

Two hooks worth keeping:

- **It would be the first die whose look is driven by physics**, which is a
  differentiator no static dice-collection game has.
- Dice Envy states plainly that liquid cores "are not balanced… essentially
  weighted dice" ([source](https://diceenvy.com/collections/sharp-edge)). Our
  dice are server-authoritative and provably fair, so "a die that *looks*
  loaded and demonstrably isn't" is a genuinely good story — **provided** the
  copy never implies a rolling advantage.

Estimated size: a rendering slice, not a content slice. Route through
`/harness:plan`, not through this wave.

---

## 7. Implementation notes for the two owners

### 7.1 Procedural wave (tonight)

1. Append the seven `configuredSets` blocks from §5 to
   `src/config/collectibleCatalogSource.json`.
2. `npm run prepare:collectible-edition -- 0031 dice-content-wave-1`
   — migration number is four digits and the slug is kebab-case
   (`generate-collectible-catalog.js:790-795`). Next free catalog edition is
   **0005**; next free global migration is **0031** (0030 is
   `0030_earned_economy_rare_pity_10.sql`).
3. `npm run generate:collectible-catalog`
4. `npm run check:collectible-catalog` and
   `npm run check:immutable-catalog-history -- origin/main`
5. To make them pullable, append **production economy edition 0003** with the
   new tier pools plus its own contiguous migration, then
   `npm run check:production-economy`. Catalog alone does not put a die in a
   banner — the three shipped `*-imagegen-set` sets are proof: they exist in the
   catalog and sit in **no** tier, so they are unpullable today.

Optionally add `requireConfiguredSet('<id>')` exports in
`src/config/dieSets.ts:21-26` to match the existing pattern.

`docs/guides/dice-set-authoring.md` step 9 gives the short form of steps 2–4 as
`npm run prepare:collectible-edition` followed by `npm run build` (which runs
the catalog, economy, runtime-asset and manifest checks together). The explicit
argument form above is required because `createPreparedCatalogEdition`
hard-rejects a missing four-digit migration number or non-kebab slug
(`generate-collectible-catalog.js:790-795`).

### 7.2 ImageGen wave — priority order and one blocker

Recommended order: **Ten Thousand Folds → Stormglass → Amberfall → Bogwood
Reliquary → Verdigris Vigil → Abyssal Glass**. Ashvow needs no pass (§5.7).

The first two are ranked highest because they are the two sets whose procedural
fidelity is lowest *and* whose tier is highest — the largest gap between what
the player is told they pulled and what they see.

**The canonical process doc is `docs/guides/dice-set-authoring.md`** (9 steps,
generate kit → art pass → register atlases → derive normals → bake GLBs →
capture proofs → release archive+lock → promote to runtime → catalog edition).
Follow it; the notes below are only the content-side deltas it does not cover.
Its gate list is:

```bash
npm run test:imagegen-uv                 # contract + workshop tests + authoring boundary
npm run validate:theme-workshop          # generated kit matches its source of truth
npm run check:runtime-dice-assets        # runtime manifests match bytes on disk
npm run check:immutable-imagegen-history # locks/manifests/fixtures unchanged
```

New `THEME_WORKSHOP` entries must satisfy
`scripts/imagegen-uv/theme-workshop.node-test.mjs:41-67`:

- unique `setId`; unique die ids; **every die id must end in `-<shape>`**
- `releaseDate` matching `^\d{4}-\d{2}-\d{2}$`
- `materialPrompt.length > 80`
- `environment.floorPrompt` / `wallPrompt` / `skyboxPrompt` each `> 80`
- `material.roughness` / `metalness` / `normalScale` each in **(0, 1]**
- `physics.density` ∈ [0.05, 5], `restitution` ∈ [0, 1], `friction` ∈ [0, 2]

`themeId` is **not** validated against the theme registry (it is only printed in
the workshop README, `generate-theme-workshop.mjs:188`), so a new dice set may
ride an existing theme's environment. Only five themes exist (`default`,
`fantasy-earth`, `critter-forest`, `dungeon-castle`, `neon-cyber-city`), and
authoring a genuinely new one means new floor/wall/skybox art plus tokens and
contrast guards. **Recommendation: reuse `dungeon-castle` for Ten Thousand
Folds and `default` for the rest**; treat bespoke environments as a later slice.

> Cheap win the authoring guide records under "Known gaps": **environment
> textures are optional and unused at runtime** — the workshop emits prompts and
> derives normals for floor/wall/skybox, but no runtime code consumes
> `.artifacts/theme-workshop/<themeId>/environment/` yet. The three
> `>80`-character prompts are still **required to pass the unit tests**, so
> write them, but do not spend art time on the environment pass for these sets
> until something renders it. Budget the art pass on the six dice atlases only.

> **BLOCKER — an ImageGen set cannot currently be legendary.**
> `scripts/imagegen-uv/theme-workshop-data.mjs:49-56` hardcodes rarity **by
> shape, globally**:
>
> ```js
> const BAKE_RARITIES = Object.freeze({
>   d4: 'uncommon', d6: 'uncommon', d8: 'uncommon',
>   d10: 'rare',    d12: 'rare',    d20: 'epic',
> })
> ```
>
> Every ImageGen set therefore tops out at **epic on the d20** and is a mixed-
> rarity set, which is why `dark-dungeon` ships `cinder-spike-d4` as uncommon
> and `dread-gate-d20` as epic. A signature/legendary flagship on the textured
> path requires making this **overridable per theme** (e.g. an optional
> `theme.rarities` merged over the default). That is a small, contained change
> — but it is a code change, it must land before Ten Thousand Folds or
> Stormglass can bake as legendary, and it needs its own test update since the
> existing three sets' rarities are frozen catalog history.

### 7.3 Highest-value engine upgrades this research surfaced

Not in scope tonight; recorded because each unlocks a whole family of concepts.

1. **Cavity/curvature-driven wear** (dark in recesses, bright on convexities).
   One shader term unlocks Die Hard's entire Battleworn family, every patina and
   verdigris concept, and "antiqued" as a reusable finish across *all* existing
   sets. Highest leverage per unit of work.
2. **Honour authored `roughness`/`metalness`** instead of overriding from
   `MATERIAL_PBR`, or add per-set overrides. Today 11 materials cap the entire
   procedural design space.
3. **Per-instance seeded variation.** Every premium maker's top marketing claim
   is "no two are the same." Physical makers get it free from material
   randomness; we would have to build it — but a seeded per-copy hue/pattern
   jitter converts a skin into a collectible, and it composes with the
   discrete-copy ownership model the economy spec already landed.
4. **Wire `accentColor`** so numerals are not permanently white — this alone
   would unlock the pale premium materials (moonstone, ivory, howlite) that
   §2.3 currently rules out.

---

## 8. Guardrails

**Kompu gacha (complete gacha).** On 2012-05-18 Japan's Consumer Affairs Agency
ruled kompu gacha a prohibited "card matching" practice under the Act against
Unjustifiable Premiums and Misleading Representations, effective 2012-07-01, on
the grounds that it was "highly deceptive and significantly stimulated a
gambling spirit"
([Monolith Law](https://monolith.law/en/general-corporate/game-random-complete-illegal),
[Lexology](https://www.lexology.com/library/detail.aspx?g=9207df10-a8a2-4f67-81c3-6a148a6100e2),
[APL Japan](https://www.aplawjapan.com/archives/pdf/file/World_Online_Gambling_Law_Report_Journal_October2012.pdf)).
The prohibited shape is: *collect a full set of N distinct randomly-obtained
items → unlock a further prize.*

> **Live risk in this repo.** `DieSet.setBonus`
> (`src/types/inventory.ts:178-181`) is exactly that shape, and
> `infernal-obsidian` already declares one:
> `"When rolling a complete Infernal set, all dice leave scorched trails"`,
> `effectId: "infernal-synergy"`. It is currently **inert — zero consumers** —
> which is the only reason it is not a problem.
>
> **Rule for this wave: no new set declares `setBonus`, and none of the seven
> above does.** If set-completion rewards are ever wired up, the completion
> reward must be reachable without gacha (crafting from Dust, direct purchase,
> or an earned track), so that a full set is never *only* obtainable by
> repeated randomised pulls. Flag to PO before any `setBonus` implementation
> slice.

**IP.** Per `docs/exec-plans/active/2026-07-25-roll-catalogue-brief.md` §2.3/§7,
generic themes carry no IP risk; Product Identity creatures (beholder, mind
flayer, displacer beast, githyanki, slaad, umber hulk, yuan-ti, carrion crawler,
kuo-toa) must never name a set. **All seven sets here are material/craft themes,
which is the safest possible register** — no creature, setting, or character
names are used.

**Naming/ids.** kebab-case set ids; catalog keys
`set/die/rarity@version` (procedural) or `set/dieId@version` (ImageGen);
ImageGen die ids must end `-<shape>`.

**Contrast.** Every `baseColor` above is ≥ 4.5:1 against white (§2.3). Any
substitution must be re-measured — this is the rule most likely to be broken by
a "just make it a nicer colour" edit.

---

## 9. Sources

**Repo evidence:** `docs/guides/dice-set-authoring.md` (canonical ImageGen
process + known gaps), `src/types/inventory.ts`, `src/lib/diceMaterial.ts`,
`src/lib/rarityColor.ts`, `src/lib/faceRenderers/glyphStyle.ts`,
`src/components/multiplayer/MultiplayerDie.tsx`,
`src/components/panels/SharedInventoryDicePreviewCanvas.tsx`,
`src/themes/contrast.ts`, `scripts/generate-collectible-catalog.js`,
`scripts/catalog-edition-planner.js`, `scripts/validate-production-economy.js`,
`scripts/imagegen-uv/theme-workshop-data.mjs`,
`scripts/imagegen-uv/theme-workshop.node-test.mjs`,
`supabase/migrations/0004_collectible_catalog.sql`,
`economy/production/editions/0001-earned-collection.json`,
`economy/drafts/monetization/premium-featured-rate-up.draft.json`,
`docs/exec-plans/active/2026-07-22-monetization-economy-spec.md`,
`docs/exec-plans/active/2026-07-25-roll-catalogue-brief.md`,
`docs/exec-plans/active/2026-07-27-gacha-reveal-minigame.md`.

**Artisan dice:**
[Norse Foundry True Metal](https://www.norsefoundry.com/collections/true-metal-dice) ·
[NF Damascus 7-set](https://www.norsefoundry.com/products/set-of-7-damascus-steel-rpg-dice-by-norse-foundry-polyhedral-dice-set) ·
[NF Bronze d20](https://www.norsefoundry.com/products/single-d20-in-bronze-by-norse-foundry) ·
[NF Hydra Scorched Titanium](https://www.norsefoundry.com/products/set-of-7-hydra-scorched-titanium-rpg-dice-by-norse-foundry-polyhedral-dice-set) ·
[NF gemstone catalogue](https://www.norsefoundry.com/collections/gemstone-all-dice) ·
[Die Hard Mythica metal](https://www.dieharddice.com/collections/mythica-dice/metal) ·
[DH Battleworn Copper](https://www.dieharddice.com/products/mythica-battleworn-copper) ·
[DH Scorched Rainbow](https://www.dieharddice.com/products/mythica-scorched-rainbow) ·
[Artisan Dice Timascus](https://www.artisandice.com/order/timascus-dice-titanium-damascus/) ·
[AD Mokume-Gane](https://www.artisandice.com/order/mokume-gane-dice/) ·
[AD Ancient Bog Wood](https://www.artisandice.com/order/ancient-bog-wood/) ·
[AD Dino Bone](https://www.artisandice.com/order/dino-bone-dice/) ·
[AD Harlequin Opal](https://www.artisandice.com/order/harlequin-opal-dice/) ·
[GeekDad — Bog Wood and Mammoth Bones](https://geekdad.com/2015/09/bog-wood-and-mammoth-bones/) ·
[Dispel sharp-edge](https://dispeldice.com/collections/sharp-edge-dice) ·
[Dispel Kickstarter FAQ](https://www.kickstarter.com/projects/dispeldice/dispel-dice/faqs) ·
[Awesome Dice sharp edge](https://www.awesomedice.com/collections/sharp-edge-dice) ·
[Dice Envy sharp edge & liquid core](https://diceenvy.com/collections/sharp-edge) ·
[Kraken color-changing](https://krakendice.com/collections/color-changing) ·
[Dice Craft Lab — gemstone guide](https://dicecraftlab.com/buying-guides/gemstone-dice/) ·
[DCL — techniques](https://dicecraftlab.com/techniques/dice-making-techniques/) ·
[DCL — liquid core](https://dicecraftlab.com/techniques/liquid-core-dice-how-to-make/) ·
[HaxTec natural vs man-made gemstone](https://haxtec.com/blogs/product-guides/gemstone-dice-guide) ·
[Runic Dice — labradorite guide](https://www.runicdice.com/blogs/news/labradorite-dice-sets-care-and-buying-guide) ·
[Wyrmwood gemstone FAQ](https://wyrmwood.zendesk.com/hc/en-us/articles/4405032177691-Gemstone-Dice) ·
[Misty Mountain — collector's guide](https://mistymountaingaming.com/blogs/dungeon-feed/the-collector-s-guide-to-d20-dice) ·
[RollHoard — choosing TTRPG dice](https://rollhoard.com/guides/how-to-choose-ttrpg-dice/) ·
[Halman Thompson — verdigris](https://halmanthompson.com/what-is-verdigris/)

**Gem optics:**
[gemmology.dev — labradorescence](https://gemmology.dev/learn/phenomena/labradorescence/) ·
[Eur. J. Mineralogy 34:393](https://ejm.copernicus.org/articles/34/393/2022/) ·
[Geology.com — chatoyancy](https://geology.com/gemstones/chatoyancy/) ·
[Australian Museum — opal](https://australian.museum/learn/minerals/gemstones/opal/) ·
[GIA — opal](https://www.gia.edu/opal) ·
[Arizona Skies — Widmanstätten](https://www.arizonaskiesmeteorites.com/Widmanstatten/)

**Gacha conventions & regulation:**
[Genshin 5-star weapon list (Game8)](https://game8.co/games/Genshin-Impact/archives/304647) ·
[Genshin 5-Star Weapons (Wiki)](https://genshin-impact.fandom.com/wiki/Category:5-Star_Weapons) ·
[Genshin artifact set list (Game8)](https://game8.co/games/Genshin-Impact/archives/297493) ·
[Artifact/Sets (Wiki)](https://genshin-impact.fandom.com/wiki/Artifact/Sets) ·
[Destructoid — standard banner](https://www.destructoid.com/genshin-impact-wishes-explained-the-standard-banner/) ·
[Genshin wish animation colour analysis](https://img.krmangalam.edu.in/star-base/genshin-impact-5-star-wish-animation-secrets-1764806225) ·
[Monolith Law — why comp gacha is illegal](https://monolith.law/en/general-corporate/game-random-complete-illegal) ·
[Lexology — loot boxes in Japan / kompu gacha](https://www.lexology.com/library/detail.aspx?g=9207df10-a8a2-4f67-81c3-6a148a6100e2) ·
[APL Japan — the illegality of Complete Gacha (PDF)](https://www.aplawjapan.com/archives/pdf/file/World_Online_Gambling_Law_Report_Journal_October2012.pdf) ·
[Abe Legal — gacha regulation in Japan](https://abe-legal.jp/en/columns/game-gacha-legal-regulation) ·
[Serkan Toto — 2012 kompu gacha regulation](https://www.serkantoto.com/2012/05/18/gacha-regulation-official/)

**Rarity colour, VFX escalation & naming ladder.** The measured findings in
§2.5 and §3.3 — Genshin's 5★ `#E0AF5F` at ~68% saturation with flat lightness,
Star Rail's warm-hue-only escalation (`#B28C6C`→`#CBAE83`), the cross-game
token set (5★ `#FFD070` / 4★ `#AF86FF` / 3★ `#699DED` / 2★ `#68D391` /
1★ `#AFAFAF`), the dark→light gradient convention, the 3★/4★ CVD collapse, the
Riot VFX style-guide principle ("visual impact should represent gameplay
impact"; escalate the primary, suppress secondaries), the multi-channel
escalation practice (HSR audio-before-colour, FGO blue→gold→rainbow, Genshin
Capturing Radiance, WuWa colour-locked-at-start), the artifact naming ladder
(`possessive+concrete → abstract/loanword`), the *Noblesse Oblige* set-vs-piece
pattern, and the permanent-institutional / limited-poetic banner split — were
supplied by the parallel rarity-visual-language research track, measured from
shipped game assets and design documentation. Treat those specific hex values
and the CVD claim as **second-hand**: the tier-collapse numbers in the §2.5
table are my own computation over `src/lib/rarityColor.ts` and are independently
reproducible from the Viénot–Brettel–Mollon (1999) projection, but the
per-game hex measurements above were not re-derived here.
