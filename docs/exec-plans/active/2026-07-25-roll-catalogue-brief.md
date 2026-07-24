# Roll Catalogue — SRD Monster Roll Templates (PRODUCT BRIEF)

> Status: **DRAFT — brainstorm.** No engineering committed. This captures a PO
> idea (2026-07-24), the licensing homework, a recommended data source, and a
> data-model/UX sketch to map it onto the existing saved-rolls system. Numbers,
> scope, and the free-vs-paid stance are **for PO review**, not decisions.
> Author: research pass. Branch: off `origin/main` — **do not commit** until PO
> greenlights the shape.

## 1. The idea (in the PO's terms)

A scrollable / searchable **catalogue of ready-made roll templates** sourced from
openly-licensed D&D 5e content. A DM searches monster stat blocks **by CR, level,
type, or name**, grabs a monster, and gets its rolls pre-built as one-tap
templates: **initiative**, each attack's **to-hit**, its **damage dice**, and
**saving throws** — then rolls them fast on the physics table without hand-entering
`1d20+11` or `2d10+6`. The catalogue is a curated front-end over a static bestiary,
executed through the saved-rolls path we already ship.

Why it fits dicesuki: we already have (a) a physics roll table, (b) a
`SavedRoll` template model with die-type-aware entries and bonuses, and (c) a
saved-rolls execution path that clears the table and spawns a template's dice. A
monster stat block is just a **pack of saved-roll templates** the user didn't have
to build.

## 2. Licensing findings (the load-bearing part)

**Bottom line: this is safe to ship commercially with one short attribution
string, provided we source SRD-only content and avoid a specific list of named
creatures.** The 5e SRD is under Creative Commons, which is cleaner than the old
OGL path (no share-alike, no license-chain to maintain, irrevocable).

### 2.1 Which SRD, which license

| SRD | Rules era | License | Released | Notes |
|-----|-----------|---------|----------|-------|
| **SRD 5.1** | 2014 "5e" | **CC-BY-4.0** | Jan 2023 (re-licensed) | The widely-played ruleset; originally OGL 1.0a, re-released under CC-BY after the Jan 2023 OGL controversy. ~**334 monsters**. |
| **SRD 5.2 / 5.2.1** | 2024 "5.5e" | **CC-BY-4.0** | 5.2 Apr 22 2025; 5.2.1 May 1 2025 | Revised/expanded (more spells, feats, monsters, items). 5.2.1 fixed 15 omitted magic items. |

Both are **CC-BY-4.0** — free to use, adapt, remix, and **sell**, with attribution
and no share-alike (unlike the OGL version). CC-BY-4.0 is **permanent and
irrevocable**: once published under it, WotC cannot pull it back. **Recommendation:
ship SRD 5.1 (2014) first** — it is the most broadly compatible ruleset and the
mature machine-readable datasets target it; SRD 5.2 is a later additive slice under
the identical license.

### 2.2 Exact attribution text we must ship

CC-BY-4.0 requires an attribution notice (in-app "credits/legal" screen is fine).
Ship the string for whichever SRD version the data came from, verbatim:

**SRD 5.1:**

> This work includes material taken from the System Reference Document 5.1
> ("SRD 5.1") by Wizards of the Coast LLC and available at
> https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is
> licensed under the Creative Commons Attribution 4.0 International License
> available at https://creativecommons.org/licenses/by/4.0/legalcode.

**SRD 5.2.1** (if/when we add it):

> This work includes material from the System Reference Document 5.2.1
> ("SRD 5.2.1") by Wizards of the Coast LLC, available at
> https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative
> Commons Attribution 4.0 International License, available at
> https://creativecommons.org/licenses/by/4.0/legalcode.

Additional CC-BY obligations:
- **Indicate modifications.** We reshape stat blocks into roll templates (a
  modification), so state that material has been adapted/modified.
- **Nothing more about WotC.** The license says: *"Please do not include any other
  attribution regarding Wizards other than that provided above."* Do not imply
  endorsement, do not use WotC/D&D logos or brand dress.

### 2.3 What is NOT in the SRD — hard exclusions (Product Identity)

WotC retained a set of iconic monsters as **Product Identity**; they are **not** in
the SRD under any license and **must be excluded** from ingestion. Confirmed
excluded (non-exhaustive — filter by an allowlist, not a denylist):
**beholder, mind flayer / illithid, githyanki, githzerai, displacer beast,
yuan-ti, carrion crawler, umber hulk, slaad, kuo-toa** (plus named settings,
characters, and spells). Any community dataset that tags a monster as SRD/OGL is
implicitly filtered, but we should **assert** at build time that our ingested list
is a subset of a known-SRD manifest so a bad upstream edit can't sneak a Beholder
into a commercial build.

**Generic creatures are fine** regardless of the above: dragons (all metallic /
chromatic color dragons are in the SRD), goblins, orcs, skeletons, zombies, giants,
elementals, etc. This matters for the dice-set synergy in §7.

### 2.4 Trademark hygiene — can we say "5e compatible"?

**Yes.** The CC guidance explicitly permits stating a work is **"compatible with
fifth edition"** or **"5E compatible."** We must **not** use the "Dungeons &
Dragons" / "D&D" word marks or logos as branding, must not imply WotC endorsement,
and must not use the exact "Dungeons & Dragons"-styled trade dress. Safe framing in
UI copy: *"roll templates for fifth-edition-compatible monsters."*

## 3. Data source — recommendation

Two mature, machine-readable options. Both are community-maintained; both expose
the roll-relevant fields.

| | **5e-bits / 5e-database** (dnd5eapi.co) | **Open5e** (open5e.com) |
|---|---|---|
| Scope | **SRD-only** (~334 monsters, 2014 set; also a 2024 set) | **3,541 creatures** — SRD **+ third-party** (Kobold Press, Green Ronin, …) |
| Licensing | Code MIT; content SRD under OGL/CC — **single clean attribution** | **Mixed** — per-source OGL/CC; multiple attributions to track |
| Format | Clean cross-referenced **JSON**, REST + GraphQL, **no API key**; static JSON files live in the GitHub repo (`src/2014/5e-SRD-Monsters.json`) | REST **JSON** API v2 (actively maintained), normalized schema |
| Damage shape | `damage_dice: "2d10+6"` (bonus embedded in notation), `attack_bonus: 11` | `to_hit_mod`, `damage_die_count`, `damage_die_type`, `damage_bonus` (pre-split) |
| Health | Active, widely used by VTTs/tools | Active, V2 current |

**Recommended: 5e-bits / 5e-database, SRD 2014 set, ingested as a build-time static
dataset.** Rationale:

1. **One clean license surface.** SRD-only ⇒ a single CC-BY attribution string
   (§2.2). Open5e's third-party content means juggling multiple publisher
   attributions for marginal creatures we don't need for a v1.
2. **Offline PWA.** dicesuki is an offline-capable PWA; a **build-time static
   dataset** (JSON bundled/served as an asset, not a runtime API call) means the
   catalogue works with no network, no rate limits, no upstream-downtime risk, and
   is **versioned/deterministic** — we snapshot a known-good SRD dump, filter it
   through our allowlist, and commit the derived artifact.
3. **~334 monsters is tractable** — a curated, searchable set, not an
   overwhelming 3,500-entry firehose. Right size for a "grab a monster fast" UX.
4. The GitHub repo ships the **raw JSON files directly**, so ingestion is a
   build-time transform (fetch snapshot → filter to SRD allowlist → map to our
   template model → emit a typed dataset), with **no runtime dependency** on
   dnd5eapi.co uptime.

**Runtime API is rejected for v1** (network dependency, breaks offline, rate-limit
exposure, non-deterministic). Open5e stays a **later option** if we ever want a
"bigger bestiary" premium expansion — but that pulls in mixed-license attribution
and should be its own scoped slice, not the free core.

## 4. Data-model sketch — stat block → `SavedRoll` template

Good news: the **real** `SavedRoll` model (`src/types/savedRolls.ts`) is far richer
than the summary in `docs/guides/saved-rolls.md` (which documents the runtime
`activeSavedRoll` *bonus-tracking* state, not the full template). The full template
is **die-type-aware and supports mixed pools**, so a monster maps cleanly:

```
SavedRoll {
  id, name,               // e.g. "Adult Black Dragon — Bite"
  dice: DiceEntry[],      // each entry: { type: DiceShape, quantity, perDieBonus, ... }
  flatBonus: number,      // e.g. attack bonus, or damage ability mod
  damageType?: string,    // maps to monster damage type: 'piercing' | 'acid' | ...
  tags?: string[],        // ['monster:adult-black-dragon','cr:14','type:dragon']
}
```

Mapping each stat-block roll → a template (a monster becomes a **template pack**):

| Stat-block roll | Source field | Template |
|---|---|---|
| **Initiative** | `dexterity` → DEX mod | `dice:[{type:'d20',quantity:1}], flatBonus: dexMod` |
| **Attack to-hit** | action `attack_bonus` | `dice:[{type:'d20',quantity:1}], flatBonus: attack_bonus` |
| **Attack damage** | action `damage_dice: "2d10+6"` (+ typed second die) | parse → `dice:[{type:'d10',quantity:2}], flatBonus:6, damageType:'piercing'` (+ a second `DiceEntry` `{type:'d8',quantity:1}` for `1d8` acid) |
| **Saving throw** (monster's own) | `saving_throws` mod per ability | `dice:[{type:'d20',quantity:1}], flatBonus: saveMod` |
| **Imposed save DC** | action `dc.dc_value` | **display metadata, not a roll** (it's a target number the *player* rolls against) |

### Dice-expression parsing (the one real build-time task)

The 5e-bits data encodes damage as a **notation string with the bonus embedded**:
`"2d10+6"`, `"1d8"`, occasionally multi-term. Ingestion needs a small parser:

- Parse `XdY`, `XdY+Z`, `XdY-Z`, and multi-term (`2d6+1d8+4`) into
  `{ dieType, count, bonus }[]` → one `DiceEntry` per die group, remainder → `flatBonus`.
- `DiceShape` covers the standard polyhedral set (d4/d6/d8/d10/d12/d20); SRD monster
  damage stays within it. Flag any non-standard die (rare) to skip/log rather than
  mis-spawn.
- **Mixed pools and multiple damage types are representable** (multiple `DiceEntry`
  + `damageType`), resolving the earlier worry that the model was count+flat-only —
  that was the *runtime* shape, not the template.

Physical-table note: executing a damage template spawns **real 3D dice** (a "2d10"
spawns two physical d10s), so templates are naturally capped by how many dice make
sense on the table — fine for individual attacks; a monster's *full* multiattack as
one spawn may be a lot of dice (open question §9).

## 5. UX sketch

1. **Catalogue entry point** — a new panel (sibling to SavedRollsPanel): a
   scrollable list of monsters with a **search box** (name) and **filters** (CR
   range slider, creature type chips: dragon/undead/humanoid/…, size). Each row:
   name, CR, type, and a compact template count ("4 rolls").
2. **Monster detail** — expands to show the stat block's rollable lines as
   **one-tap template chips**: `Initiative +2`, `Bite +11`, `2d10+6 piercing`,
   `DEX save +5`. Imposed DCs shown as read-only badges (`Acid Breath — DC 18 DEX`).
3. **One-tap roll** — tapping a chip **executes it through the existing saved-rolls
   path**: `clearAllDieStates()` + `removeAllDice()` → spawn the template's dice →
   `setActiveSavedRoll(...)` (see `SavedRollsPanel.tsx`). This is the same
   **replace-table semantics** saved rolls already use: the tapped template
   **replaces** whatever is currently on the table.
4. **"Save to my rolls"** — optionally copy a monster template into the user's own
   saved rolls for repeat use.

### Dependency: the in-flight saved-rolls fix

The one-tap roll **rides entirely on the saved-rolls execution path**, so this
catalogue **inherits whatever the in-flight saved-rolls fix changes**, especially
its **replace-table semantics** (how executing a template clears/replaces the
current table dice and reconciles `activeSavedRoll` with the spawned dice count).
**This brief should not ship template execution until that fix lands and its
replace semantics are stable** — otherwise we'd build catalogue UX on a moving
contract. Slice 4 (§8) is explicitly gated on it.

## 6. Free vs monetization — PLACEHOLDER (PO decides)

Two framings:

- **(A) Free utility** — the catalogue is a free DM tool that drives adoption and
  session time. It costs us only build-time ingestion and UI.
- **(B) Premium catalogue** — gate the bestiary (or the "big bestiary" / Open5e
  expansion) behind an entitlement.

**Recommendation: free core (A).** It aligns with the monetization spec's
**"standard-generous"** philosophy ([ADR-017 monetization economy]; the spec keeps
utility generous and puts the revenue dial on *premium collectible dice scarcity*,
not on gating tools). A free SRD catalogue is a **DM acquisition magnet** that feeds
the paid dice-set economy (§7), which is where revenue actually lives. **A later,
optional** paid "expanded bestiary" (Open5e third-party content) could exist as B,
but the SRD core should be free. **Flagged for PO** — this is a positioning call,
not an engineering one.

## 7. Future synergy — monster-themed dice sets (logged idea, NOT committed)

The premium collectible rail (ADR-017) ships **dice sets**; **creature-themed sets**
pair naturally with this catalogue as an **acquisition funnel**:

- A DM browses a monster's stat block (free), and we surface a matching
  **creature-themed dice set** — e.g. roll a dragon's stat block with a
  **dragon-themed d20 set**. Free utility → discover → premium cosmetic.
- This connects the **catalogue (free utility)** to the **premium dice-set economy
  (ADR-017)**: the free template is the hook; the themed set is the sell.

**Licensing boundary (explicit):** themed sets may only use **SRD-safe creature
names/likenesses** for any *named* tie-in. **Generic themes are always safe** —
"dragon", "skeleton", "goblin", "elemental" sets carry no IP risk regardless. A
themed set may **not** invoke **excluded Product Identity** (§2.3): no
"beholder set", no "mind flayer set." Generic-first keeps the funnel clean.

*Status: logged idea with the licensing caveat above — not a plan. Belongs to the
ADR-017 dice-set backlog, referenced here only for the catalogue↔economy link.*

## 8. Phased slices

| Slice | Deliverable | Notes / gate |
|---|---|---|
| **S1 — Dataset ingest** | Build-time transform: snapshot 5e-bits SRD JSON → filter to SRD allowlist → **parse damage notation** → emit typed dataset + assert "subset of known SRD" | Includes the dice-expression parser (§4) and the exclusion allowlist (§2.3). Ship the CC-BY attribution string (§2.2) in the app's legal/credits screen. |
| **S2 — Search UI** | Catalogue panel: scroll list, name search, CR/type/size filters, monster rows | Pure client over the static dataset; no execution yet. |
| **S3 — Template mapping** | Monster detail → template chips (initiative / to-hit / damage / saves), DCs as read-only badges | Maps stat block → `SavedRoll` (§4); "save to my rolls" copy. |
| **S4 — Roll execution** | One-tap chip → spawn via saved-rolls path (replace-table) | **Gated on the in-flight saved-rolls fix + stable replace-table semantics (§5).** |
| **S5 (later, optional)** | Expanded bestiary (Open5e) and/or SRD 5.2 additive set; themed-dice-set funnel hooks (§7) | Mixed-license attribution work; own scoped slice; PO-gated on the free-vs-paid call (§6). |

## 9. Open questions

1. **SRD 5.1 vs 5.2 first?** Recommend 5.1 (broadest compatibility, mature data);
   5.2 as additive later. Confirm with PO.
2. **Multiattack as one action?** Spawn each attack separately, or a combined
   multiattack template (many physical dice at once)? Physical-table dice-count
   limits apply.
3. **Whose saving throw?** Monster's own saves (1d20+mod, easy) vs the
   player-facing "roll against this DC" flow. v1 = monster's own saves + DC as a
   badge; revisit.
4. **Advantage/disadvantage & crits** — the `SavedRoll` model already supports
   keep/drop and could express advantage; do monster templates expose an
   adv/dis toggle, and do we auto-double damage dice on a natural 20?
5. **Static asset size** — ~334 monsters as bundled JSON: acceptable payload, or
   lazy-load the dataset on first catalogue open?
6. **Free-vs-paid positioning (§6)** and **themed-set funnel (§7)** — PO calls.

## Sources

- SRD 5.1 CC-BY legal text (attribution string, exclusions): https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf
- SRD 5.1 re-license under CC + "5E compatible" guidance: https://www.enworld.org/threads/how-to-use-creative-commons.695456/ · https://a5esrd.com/how-to-use-creative-commons
- SRD 5.2 / 5.2.1 (CC-BY, dates, D&D Beyond home): https://www.dndbeyond.com/srd · https://www.dndbeyond.com/posts/1949-you-can-now-publish-your-own-creations-using-the · https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf
- Excluded Product Identity monsters (beholder, mind flayer, etc.): https://www.enworld.org/threads/srd-excluded-monsters.101333/ · https://www.prismaticwasteland.com/blog/no-one-owns-these-monsters
- 5e-bits / 5e-database (SRD, MIT+OGL, JSON, no key): https://github.com/5e-bits/5e-database · https://5e-bits.github.io/docs/ · https://www.dnd5eapi.co/ · monster JSON sample: https://github.com/5e-bits/5e-database/blob/main/src/2014/5e-SRD-Monsters.json
- Open5e (3,541 creatures, SRD + third-party, V2 API): https://open5e.com/ · https://open5e.com/api-docs · https://api.open5e.com/v2/creatures/
- SRD monster count (~334): https://www.openttrpg.com/5e-monsters
- Prior art — VTT monster roll shortcuts (Roll20 click-to-roll NPC lines; Foundry Monster Blocks rollable "+X to hit" / "2d10+10"): https://help.roll20.net/hc/en-us/articles/360037773573-D-D-5E-by-Roll20 · https://github.com/zeel01/MonsterBlocks
</content>
</invoke>
