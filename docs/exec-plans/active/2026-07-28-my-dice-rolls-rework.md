# My Dice Rolls Rework — Program Brief

Status: PO-directed 2026-07-27 (night-shift program), decisions locked as noted
Owner: PO (Donovan); orchestrated autonomously overnight
Ground truth mapped from origin/main 9155e26 (post-#208).

## PO decisions (2026-07-27)

a. **Implement the "Advanced Options" mechanics** currently listed as "coming soon" in `DiceEntryCard` (advantage/disadvantage keep-highest/lowest, exploding, re-roll, success counting, min/max). Types, formula suffixes, and result badges already exist (`src/types/savedRolls.ts:45-99`, `diceHelpers.ts`); only builder UI and physical-execution semantics are missing.
b. **Free dice count.** Remove the discrete 1/2/4/6/8/10 buttons (`DiceEntryCard.tsx:175`). Any count allowed, clamped to the engine room cap (MAX_DICE = 30, `server/core/src/room.rs:115`) across the whole roll. Keep the +/- stepper; add a numeric input.
c. **Notation.** Per-die bonus renders the die inside the parens with the count outside: `4(d4+1) + 1` — count × (die + per-die bonus), then flat bonus. NOT `4d(4+1)`. No-bonus form stays `4d4`. Keep ` khN`/` klN` and ` [N specific]` suffixes. New unit tests must lock the format (none exist today).
d. **Infinite basic default dice.** A plain die — white body, black numbers, bare minimal font — that every player has in unlimited quantity. Never appears in inventory. It is the universal auto-fill: if a roll wants 6 d4 and the player owns 4 styled d4, the remaining 2 spawn as basic dice. Toolbar never disables a die type; beyond owned dice it spawns basics. Adventurer Starter (blue set) and the rest of the seeded 23-row local starter inventory get cleaned out of the default inventory — default inventory becomes empty; basics are the floor. (Server entitlements/pull pools untouched; legacy rows harmless.)
e. **Choose-your-starter** on first sign-in: pick one of three sets — cyberpunk, cozy, fantasy. Grant: 2×d4, 2×d6, 2×d10, 1× each of d8/d12/d20 (9 `dice_copies`, source `reward`). Cozy (`cozy-forest-imagegen-set`) and cyberpunk (`cyberpunk-imagegen-set`) are complete live GLB sets (migrations 0006/0007). Fantasy needs a full mint via the preserved ImageGen-UV workshop (commit `7393d112`, tags `imagegen-*-authoring-v1`); the albedo art pass is manual — kits will be prepped, art pass flagged to PO. Until fantasy is minted, the picker ships behind config with a PO-decided stand-in or two-choice mode.
f. **d100.** Proper percentile: a tens die (faces 00–90, reusing d10 geometry/colliders/contract) paired with a standard ones d10 (physical faces 0–9). Combined result `tens + ones`, with 00+0 = 100. One core, both targets (Shared-ADR-007). Builder gains a d100 entry that expands to the pair.
g. **Composition UX.** The builder stays focused on assembling the roll: remove the top-12 owned-dice grid; dice selection happens by clicking into the entry/preview, opening a picker that reuses the inventory presentation (3D previews) with a clear selected state (highlighted/bolded outline). Fix `DiceIcon.tsx` shapes to accurate silhouettes (d20 is currently a circle, d10 an elongated hex, d4 a bare triangle) and use theme tokens, not hardcoded slate hexes. Roll name/description must look like real text fields (proper field chrome, focus states; description = textarea; inline validation instead of alert()).
h. **Mobile-first, desktop-enhanced.** All roll menus keep working ≥360×640; on desktop, actually use the space (e.g. two-column builder with sticky preview, larger picker grids).

## Slice plan (each: Opus owner → adversarial review → fix batch → focused re-review → PR → CI → merge → deploy smoke)

- S1 `feat/roll-builder-core` — (b) free count + 30-cap validation, (c) notation + new diceHelpers tests, (g-part) field styling + inline validation, (h) desktop builder layout.
- S2 `feat/roll-advanced-mechanics` — (a) UI + physical execution: keep/drop spawns rollCount and keeps quantity; exploding/re-roll chain follow-up physical rolls after settle; success counting and min/max applied in aggregation. After S1.
- S3 `feat/basic-default-dice` — (d): basic-die presentation (white/black, displayName "Basic dN"), toolbar + saved-roll auto-fill beyond owned, empty default inventory (stop seeding STARTER_DICE), store migration normalizing dangling specific sources to anonymous, starter-parity test rework. After S2.
- S4 `feat/roll-composition-ux` — (g): picker reuse with selected outlines, owned-grid removal, DiceIcon redraw, desktop pass. After S3.
- S5 `feat/d100-percentile` — (f): core tens-die + client + builder pair entry. Parallel-safe with S1 (disjoint).
- S6 `feat/starter-picker` — (e): migration 0031 `choose_starter_set` (once per user, 9 copies), first-sign-in picker UI, config for the three sets; fantasy authoring kit prep. After S3.

## Known constraints (from the map)

- Room cap 30 dice; spawn grid holds 45/layer; saved-roll execution clears the table first, so the full 30 is available to a roll.
- `clampQuantity` currently has no upper bound; server rejects over-cap spawns with DICE_LIMIT.
- Physical d10 faces read 0–9 (engine) while the virtual roll engine treats d10 as 1–10 — S5 must not change existing d10 semantics.
- CLAUDE.md's `src/lib/diceSpawner.ts` note is stale: the spawn path is `DiceBackendContext` → `useMultiplayerDiceBackend.addDie/addGenericDie` → room `spawn_dice`.
- Presentation-less generic dice currently render in the owner player's color — basic dice must carry an explicit presentation block instead.
- ROOM_DICE_CAPACITY=30 is mirrored by hand in `PullRevealOverlay.tsx:13` (drift-prone; S1 may centralize).

## Open items for PO (morning)

1. Fantasy set art pass: ImageGen albedo edits are a manual step; kits will be ready. Approve doing the art pass, or pick a stand-in third set (nearest existing: dragon-jade) so the picker can ship as cyberpunk/cozy/fantasy-standin.
2. Legacy accounts: existing signed-in users keep their adventurer-starter entitlements/copies; new-user experience changes to empty-inventory + basics + starter pick. Confirm no retro-grant needed.
3. d100 convention locked as 00+0 = 100 (1–100 range); flag if 0–99 preferred.
