# Gacha Reveal Minigame — Product Brief

Status: PO-locked design, pre-implementation
Date: 2026-07-27
Owner: PO (Donovan)
Depends on: feat/hud-layout-a (HUD Layout A + full-screen shop overlay)

## Vision

The pull reveal is the emotional core of the gacha and today it is a static overlay — boring. Replace it with a tactile **reveal roll**: for every pull purchased (1 up to 10 at a time), the player receives one special ceremonial die in a dedicated reveal room and physically rolls it. The die carries no numbers and no skill — the outcome was sealed server-side before the player ever touched it — but the player gets the tactile ritual of throwing dice and watching fate land.

On settle, the die glows in its rarity color, then **transforms into the actual die that was unlocked**, sitting there on the table.

## PO-locked decisions (2026-07-27)

1. **Dedicated reveal room** — a full-screen ceremonial arena reached from the shop flow, not the player's normal table. Own lighting/mood; premium banners can later get distinct arena dressing.
2. **10-pulls spawn all N dice; rolling is the player's choice** — throw the whole pile at once, or pick up and roll dice individually. No forced mode.
3. **Staged finale glow** — each die glows its rarity color as it settles, EXCEPT the highest-rarity die of the batch, which holds a neutral shimmer/pulse until all others have settled, then erupts in its color. (Pure presentation ordering; every outcome was already sealed at prepare.)
4. **Always skippable** — a skip control from the very first pull instantly settles all dice and plays the reveals. No forced ceremony, no retention friction.
5. **Glow → morph** — after the rarity glow, the ceremonial die transforms in place into the unlocked collectible die (mesh/material swap with a transition effect). Duplicates morph into the die plus a Dust burst (dupes grant copy + Dust per the economy spec).
6. **Fairness messaging is consolidated, not repeated** — each banner gets a tooltip/info link that opens a modal with that banner's details (odds, pity, pool). No accordions anywhere. The roll result screen carries NO "how we predetermined it" breakdown — all fairness/verification jargon (sealed commit/reveal explanation, seed/nonce disclosure) lives in one single consolidated spot reachable from the banner modal / shop info link. Compliance placement (odds one tap from the pull surface) is satisfied by the banner modal.

## Fairness architecture (why this is safe)

- Outcomes, tiers, duplicates, and guarantee effects are sealed at `prepare_pull` under the CSPRNG commit/reveal scheme (migration 0017, ADR-016/017). `commit_pull_session` debits, advances pity, grants, and returns the reveal payload.
- The physical roll is **pure theater**: the physics face value of a ceremonial die is ignored. Each spawned ceremony die is bound to a sealed result position at spawn time (fixed mapping, e.g. spawn order == result_position). No post-roll assignment.
- The commit → roll → glow order means we can honestly state: "your results were locked and committed before you rolled." The seed + per-result nonces disclosure after reveal (existing) is unchanged.
- Odds disclosure surface and its one-tap-from-pull placement are unchanged.

## Player flow

1. Shop overlay → banner → choose 1x or 10x pull → confirm spend (existing prepare/commit flow).
2. On commit success, transition into the reveal room with N ceremonial dice (fancy-tier visuals for premium banners later — #154-gated; somewhat-fancy for standard now).
3. Player throws the pile or rolls dice one by one (existing drag/throw + shake input paths; the reveal room is a wasm room like any other — one engine everywhere).
4. Each die settles → `die_settled` → rarity glow per the staged-finale rule → morph into the unlocked die (dupe: + Dust burst and Dust counter tick).
5. All revealed → summary (results list only — no fairness/verification breakdown; that lives in the consolidated fairness spot) → inventory refresh (existing pullInventoryRefresh) → back to shop or roll again.
6. Skip at any point: instantly settles remaining dice and plays reveals in sequence.

## Technical shape (guidance, not final)

- **Room**: reuse `dicesuki-core` wasm room in a Web Worker — a solo reveal-room instance with the standard room protocol. No core physics changes expected; ceremony dice can be a standard shape (e.g. d6) whose face detection result is simply unused by the client.
- **Presentation**: ceremony-die presentation metadata (existing presentation block on spawn) marks tier styling; glow = emissive material driven by the client when `die_settled` arrives, colored from the sealed result payload; morph = mesh/material swap with transition.
- **State**: reveal-room flow state lives in the pull flow hook (`usePullFlow`) extension or a dedicated store per Frontend-ADR-002 (own domain if not tightly coupled).
- **No physics-outcome coupling**: client must never read the settled face value for reveal logic.

## Slice plan (each = one reviewable PR, Codex implements)

- S1: Reveal room scene + ceremony dice spawn/throw/settle + instant per-die glow (standard visuals only).
- S2: Staged finale ordering + skip control.
- S3: Glow → morph into unlocked die + duplicate Dust burst.
- S4: Fairness-copy consolidation tie-in (if not already landed via the shop overlay slice).
- S5 (later, #154-gated): premium ceremony visuals + premium arena dressing.

## Open items (not blocking S1)

- Audio + haptics pass for settle/glow/morph.
- Per-banner arena theming.
- Ceremony die asset iteration through the custom-dice pipeline (start with material/emissive treatment on existing geometry).
