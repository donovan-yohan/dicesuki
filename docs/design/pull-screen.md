# Design Spec — Gacha Pull Experience (Banner Screen · Pull Flow · Reveal)

> Status: **DESIGN — implementable spec, not committed.** Staged in the
> `slice1-roll-tickets` worktree as a handoff artifact for `ika-frontend`.
> Scope: the **standard** banner pull loop that ships pre-#154 (free tier), with
> the **premium** banner UI designed but rendered dormant/locked (#154-gated).
> Mobile-first, 9:16 portrait, theme-token-only styling.
>
> Author: hotate-design · Date: 2026-07-24

---

## 0. Grounding (what this spec is built on)

Product / economics:
- `docs/exec-plans/active/2026-07-22-monetization-economy-spec.md` §1 (banner
  classes, `standard_roll`/`premium_roll` tickets, 160 Stars = 1 roll, discrete
  copy ownership §1.6), §5 (pity: **premium hard 75 LOCKED**, **soft-pity ramp
  +0.5%/pull from pull 41**; **standard shallow 25–40**).

Backend contract (read directly, not paraphrased):
- `supabase/migrations/0011_earned_pull_preparation.sql:1308` —
  `public.prepare_pull(p_banner_version_id text, p_pull_count smallint,
  p_idempotency_key text)` returns a **result-free** receipt: `session_id`,
  `banner_version_id`, `pull_count`, `held_amount`, `prepared_at`,
  **`expires_at`** (120s TTL), `commitment_scheme`, **`commitment_root`**,
  `rng_scheme`. It **holds** funds; it does **not** debit, grant, or reveal.
- `supabase/migrations/0017_pull_commit_reveal.sql:1027` —
  `public.commit_pull_session(session_id)` → **jsonb reveal**: top-level
  `rng_seed`, `commitment_root`, and `results[]` where each result carries
  `position`, `catalog_item_id`, `tier_id`, `tier_rank`,
  `selected_target_catalog_item_id`, `reason`, pity counters
  (`rare/epic/selected_before/after`), **`is_duplicate`**,
  **`duplicate_dust_amount`**, **`nonce`** (hex), **`commitment`** (sha256)
  (`0017:637`). Commit is the point where tickets actually leave and grants land.
- `public.get_committed_pull_reveal(session_id)` (`0017:1045`) — idempotent
  re-read of a committed reveal (crash/resume path).
- `public.cancel_pull_session(session_id)` (`0017:1063`) — releases the hold;
  reservation release **needs no refund**.
- Auth gate: both `prepare_pull` and `commit_pull_session` call
  `private.require_non_anonymous_user()` — **guests cannot pull.**

**Contract correction (load-bearing).** The task brief states the reveal
includes `is_first_copy`. **It does not.** A grep of
`0017_pull_commit_reveal.sql` finds `is_duplicate` and `duplicate_dust_amount`
but **no** `is_first_copy` / first-copy / ever-owned field. The ever-owned
first-copy latch and the duplicate→**copy + Dust** grant are the **not-yet-built**
discrete-copy rework (spec §6.1 deltas #10–11). Consequences for this design:
- Slice-1 UI derives the "**NEW**" state from **`is_duplicate === false`** (the
  only signal that exists today). This is a serviceable proxy but **not** the
  ever-owned latch — after a future scrap-all-then-re-pull it would mislabel a
  re-acquire as NEW. That's acceptable for slice 1 because scrap doesn't exist
  yet either.
- The full **first-copy ceremony** (§5.3) and the "**+1 copy**" duplicate line
  (§5.2) are **gated on delta #11 landing `is_first_copy` + the copy grant.**
  This spec designs both so the surface is ready; they render behind a flag.

UI idioms this spec reuses (cited per use, not invented):
- `src/components/panels/FlyoutPanel.tsx` — slide-in panel shell, backdrop
  (`rgba(0,0,0,0.6)` + `blur(4px)`), spring in / 0.2s out, header pattern,
  `var(--color-surface)` + `var(--color-accent)` border.
- `src/components/panels/BottomSheet.tsx` — mobile bottom sheet, drag-to-dismiss
  (`velocity.y > 500 || offset.y > 150`), `rounded-t-3xl`, drag handle.
- `src/components/panels/HeroDieInspector.tsx` — **the single-die 3D showcase
  idiom**: `fixed inset-0 z-[70]` full-screen modal, real R3F `<Canvas>` with a
  static-tilt spinning die (`HERO_DIE_ROTATION`, line 20), rarity-colored border
  (line 83), rarity chip (line 96). This is the template for the reveal stage.
- `src/components/panels/SharedInventoryDicePreviewCanvas.tsx` — pooled
  mini-canvas for rendering real dice meshes off the main scene (reuse for the
  10-pull grid thumbnails).
- `src/components/layout/BottomNav.tsx` — 5-slot pill nav (UI toggle · Dice
  Manager · center Roll · History · Motion). Nav is **full**; the center slot is
  the core Roll action. No shop slot exists yet.
- `src/lib/diceSpawner.ts:94` `spawnDiceFromInventory(...)` — the **single source
  of truth** for putting dice on the table; the "Add to table" claim routes here.
- `src/lib/multiplayerMessages.ts:18` `DicePresentationMetadata` — owned-die
  identity carried on spawn (`inventoryDieId`, `displayName`, `setId`, `rarity`,
  `baseColor`, `customAssetId`, …). The reveal's won dice spawn with this block.
- `src/components/panels/InventoryPanel.tsx:709` `getRarityColor()` — the
  established rarity palette (uncommon `#1eff00`, rare `#0070dd`, epic `#a335ee`,
  legendary `#ff8000`, mythic `#e6cc80`; common = `text.secondary`). **Promote
  this to a shared util** (`src/lib/rarityColor.ts`) so banner + reveal + summary
  share one source. See §5.4 for the tier→rarity mapping caveat.
- `src/themes/tokens.ts` — dark-plum default: surface `#2a1a2e`, background
  `#1a101d`, accent brand-pink `#F98797`, secondary lavender `#9C89C4`, cream
  text `#f3ebe2`, signature gradient `linear-gradient(90deg,#f98797,#9c89c4)`.
  **All styling reads tokens** (CSS vars `var(--color-*)` per BottomNav, or
  `theme.tokens.*` per HeroDieInspector). No hard-coded palette.

Architecture constraints honored:
- Shared-ADR-005/007: the room is the single dice primitive; solo = an in-browser
  **wasm room** in a Web Worker; dice are **positioned meshes driven by
  server-authoritative 60Hz snapshots**; face detection is server-side. This
  directly shapes the reveal recommendation (§4).
- Frontend-ADR-001/002: R3F v9, memoized geometries, Zustand per-domain stores.
- ADR-003: theme tokens only; `defaultTheme` always available, `price: 0`.

**Design completeness of the current backend for this UI: 7/10.** Everything the
standard loop needs to *function* (prepare → commit → reveal → cancel) exists and
is well-shaped for a commit-reveal trust story. The −3 is entirely the
**discrete-copy gap**: no `is_first_copy`, duplicates are Dust-only not copy+Dust,
and no ticket-balance read RPC is cited (the UI needs a `roll_ticket_balances`
selector — `0014`). Those are the blocking gaps for the *full* experience; §12
phases around them.

---

## 1. Information Architecture

### 1.1 Where the banner screen lives

The Banner screen is a **full-screen route/destination**, not a flyout. Rationale:
it is a focused, multi-step, immersive surface that wants the entire 9:16 viewport
for a hero featured die and a full-bleed reveal. The flyout/bottom-sheet idioms
(`FlyoutPanel`, `BottomSheet`) are for *reference/management* surfaces (inventory,
history, settings) layered over the live scene — the wrong metaphor for a
ceremony. The **reveal** overlays everything at `z-[70]`, matching the
`HeroDieInspector` modal idiom (`src/components/panels/HeroDieInspector.tsx:71`).

`BottomNav` is already full (5 slots, center = Roll — the app's core action;
`src/components/layout/BottomNav.tsx:80`). Do **not** consume a nav slot for
banners. Instead the banner screen lives **inside the planned auth-gated Shop
hub** as one of its tabs:

```
Shop hub (auth-gated entry)
 ├─ Bundles   (Star packs — #154-gated, dormant pre-launch)
 ├─ Banners   ◀── THIS SPEC (standard ships free; premium locked)
 └─ Themes    (existing cosmetic theme store)
```

Entry points into Banners:
1. **Shop hub → Banners** (primary).
2. **Inventory empty/low state → "Get more dice"** — the natural funnel from the
   collection surface (`InventoryPanel` currently has no such CTA; add one).
3. **New-rotation deep-link** (a "New banner" chip on the Shop entry) when a
   premium featured die rotates (2–3 wk cadence, spec §5.4).

### 1.2 Auth gate

Pulls require a non-anonymous account (`require_non_anonymous_user` in both RPCs).
Guests may **browse** the banner (rates, pity rules, featured die) but the Pull
CTA becomes **"Sign in to pull"** → Discord OAuth (Shared-ADR-006). This is the
"auth-gated shop" behavior referenced for `BottomNav`. Browsing-while-signed-out
is deliberate: it lets the featured die do marketing work before the sign-in ask.

### 1.3 Screen inventory

| Surface | Type | z / shell idiom |
|---|---|---|
| Banner screen | full-screen route | app route, not a flyout |
| Rates & pity detail | expandable in-place + bottom sheet on tap | `BottomSheet` |
| Pull confirm (10-pull spend guard) | bottom sheet | `BottomSheet` |
| Sealing / hold (degraded only) | full-screen overlay | `z-[70]` modal |
| Reveal (single + 10-pull) | full-screen overlay | `z-[70]` per `HeroDieInspector` |
| Insufficient / conversion prompt | bottom sheet | `BottomSheet` |
| Verification detail | expandable within reveal | inline `<details>`-style |

---

## 2. Banner Screen Anatomy

```
┌─────────────────────────────┐  9:16 portrait
│ ‹  Banners             ✓ ⓘ  │  back · title · fairness tick + info
├─────────────────────────────┤
│ ▐ Standard ▌  ○ Premium 🔒  │  segmented tab strip (premium = locked)
├─────────────────────────────┤
│    ╭───────────────────────╮ │
│    │                       │ │
│    │   FEATURED DIE (3D)   │ │  hero stage — real spinning mesh
│    │   slow idle rotation  │ │  (HeroDieStage idiom, reduced-motion safe)
│    │                       │ │
│    ╰───────────────────────╯ │
│    Ember d20 · ◆ Signature  │  featured name + tier chip (rarity color)
│    "Rotates in 6d"          │  cadence / availability (premium only)
│                             │
│  ┌─ Pity ──────────────┐    │
│  │ ▐▓▓▓▓▓▓░░░░░░░ 41/75 │    │  pity meter (see §2.2)
│  │ Guaranteed by 75    │    │
│  │ Rates ▾             │    │  rates disclosure toggle
│  └─────────────────────┘    │
│                             │
├─────────────────────────────┤  ── sticky footer ──
│  🎟 Standard Rolls  12       │  balances strip
│  ★ Stars  480               │
│  ┌───────────────────────┐  │
│  │  Pull ×1        🎟 1   │  │  primary CTA
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │  Pull ×10       🎟 10  │  │  secondary CTA (elevated / accent)
│  └───────────────────────┘  │
│  Provably fair ✓            │  verification affordance (§8)
└─────────────────────────────┘
```

Scan order (billboard test): **featured die (what)** → **pity meter (how close)**
→ **Pull ×1 / ×10 (do it)** → balances (can I) → fairness tick (trust). Everything
above the footer is *desire*; the footer is *transaction*. The footer is sticky so
the CTA never requires scrolling — the whole point is one obvious clickable thing.

### 2.1 Banner card / hero stage

- **Featured die is a real 3D mesh, not art.** Reuse the `HeroDieStage` pattern
  (`HeroDieInspector.tsx`, R3F `<Canvas>` + `HERO_DIE_ROTATION` tilt) with a slow
  idle spin. This is the core differentiation: **dice are the product**, so the
  banner sells the *actual object you can roll*, not a splash illustration. On
  low-tier devices fall back to a static rendered thumbnail (device-tier logic
  already exists: `resolveRenderDeviceTier`, `HeroDieInspector.tsx:44`).
- **Tier chip** uses the shared rarity color (§5.4). Signature/featured tier gets
  the accent treatment; standard-pool commons stay muted.
- **Standard banner** has no "featured die" in the premium sense — its hero is
  the *pool identity* (e.g. the set art / a representative signature die of the
  permanent pool) with copy like "Permanent collection." No countdown.
- **Anti-slop guard:** the hero must **not** become a generic centered-hero card
  with a purple/blue gradient and a die emoji. Use the real mesh on the dark-plum
  tray, brand gradient only as a thin accent (`tokens.effects.gradients.primary`),
  and let the 3D object carry the composition.

### 2.2 Pity progress display

Pity is disclosed differently per banner class (spec §1.4, §5):

**Standard banner (shallow, generous, ships now):**
```
▐▓▓▓▓░░░░░░ 12/40      Rare+ guaranteed by 40
```
- Single shallow meter to the hard floor (25–40). Framed as reassurance
  ("you'll always get something good soon"), not a wall to grind. No soft-pity
  language — standard is shallow and lossless.

**Premium banner (designed now, dormant behind #154):**
```
▐▓▓▓▓▓▓░░░░░░ 41/75    Featured guaranteed by 75
      ▲ soft-pity boost active (rate climbing)
```
- Two-segment disclosure: base region (pulls 1–40) then a visually distinct
  **soft-pity zone from pull 41** where the meter changes fill treatment (e.g.
  accent-gradient fill + a subtle pulse) to communicate "odds are climbing now."
  This maps to the accepted ramp (+0.5%/pull from 41, spec §5.5).
- Hard-75 marker at the end with "Featured guaranteed by 75."
- Tap the meter → `BottomSheet` with the **exact disclosure**: base featured rate
  0.6%, the per-pull ramp schedule, hard-75 guarantee, and the standard tier odds
  table. This is the legally-relevant odds disclosure; keep it exact, not "≈".
- **The pity number itself must come from the contract, not the client.** The
  reveal returns `selected_before/after` and `rare/epic` counters
  (`0017:656-661`); the *displayed* pre-pull counter should be read from a
  server-owned pity/session state, not accumulated client-side (client-side pity
  drifts and becomes a fairness-dispute vector). If no read RPC exists yet, that's
  a backend gap to flag — the meter is **read-only reflection of server truth.**

Reduced-motion: the soft-pity "pulse" is disabled under `shouldReduceMotion()`
(`src/animations/ui-transitions.ts`, used throughout `BottomNav`/`FlyoutPanel`);
the zone still reads via the distinct fill color.

---

## 3. Pull CTA States

The CTA has one job: make the *one obvious next action* unmistakable, and never
lie about cost. States, in priority order:

| # | Condition | ×1 CTA | ×10 CTA |
|---|---|---|---|
| A | Signed out | **Sign in to pull** (accent) | hidden or disabled |
| B | Enough tickets | **Pull ×1 · 🎟 1** | **Pull ×10 · 🎟 10** (elevated) |
| C | Not enough tickets, enough Stars to convert | **Pull ×1 · convert 160★** (secondary framing) | **Pull ×10 · convert 1600★** |
| D | Not enough tickets *and* not enough Stars | **Need 1 more roll** (disabled + helper) | **Need N more rolls** (disabled + helper) |
| E | Live hold in flight (degraded) | replaced by hold overlay (§7) | — |
| F | Premium banner (pre-#154) | **Coming soon** (locked, non-interactive) | locked |

Details:

- **Balances strip** (`🎟 Standard Rolls · ★ Stars`) sits directly above the CTA
  so cost and wallet are read together (don't-make-me-think). Ticket balance reads
  from `roll_ticket_balances` (`0014`). **Available = balance − active same-type
  holds** (reservation semantics, spec §6 delta 3 / `0015`): if a hold is live,
  the strip shows the reserved count so the number never appears to "double spend."

- **State C — Stars fallback via conversion (the interesting one).** When tickets
  are short but Stars cover it, the CTA reframes to show the conversion inline,
  and tapping opens a `BottomSheet` confirm:
  ```
  ┌─────────────────────────────┐
  │ Convert Stars → Rolls        │
  │ You have 480 ★               │
  │ 10-pull needs 10 🎟 (0 held) │
  │ Convert 1600 ★ → 10 🎟 ?     │
  │  ★480  ✗ short by 1120       │  ← if partial, show the shortfall
  │ [ Convert & Pull ]  [ Cancel]│
  └─────────────────────────────┘
  ```
  Conversion is `0016` (Stars→`standard_roll`, 160:1, promotional bucket).
  **Two-step, explicit** — never silently drain Stars. If Stars only partly cover
  the deficit, show the shortfall and fall through to State D messaging for the
  remainder. (Premium's Stars→`premium_roll` conversion is **#154-gated** and does
  not ship here; the premium CTA is locked regardless.)

- **State D — insufficient (terminal, pre-#154).** No paid top-up exists before
  #154 (Star bundles are dormant, spec §1.5). So the honest terminal state points
  at **free faucets**, not a paywall:
  ```
  ┌─────────────────────────────┐
  │ Not enough rolls yet         │
  │ You have 3 🎟 · need 10      │
  │ • Daily login: +1 🎟 tomorrow│  ← faucet cadence (spec §4)
  │ • Weekly budget: 10 🎟/wk    │
  │ [ Pull ×1 instead ]          │  ← offer the affordable action
  │ [ Back ]                     │
  └─────────────────────────────┘
  ```
  Always offer the **largest affordable pull** as an escape hatch rather than a
  dead end. Post-#154, this sheet gains a "Get Stars" bundle route.

- **CTA affordances.** `Pull ×10` is the elevated/accent action (the intended
  primary purchase), `Pull ×1` is the lower-commitment option — but **neither is
  a dark-pattern default**: both are clearly labeled with exact cost. Use
  `buttonPressScale` / `whileTap` from `ui-transitions` for tactile feedback
  (idiom: `BottomNav.tsx:149`). Disabled states use muted text
  (`--color-text-muted`), never a grayed-but-tappable trap.

- **No-double-fire.** The CTA disables immediately on tap and stays disabled until
  prepare resolves or errors (prevents duplicate `prepare_pull` calls; idempotency
  key protects the backend but the UI must not *look* tappable mid-request).

---

## 4. The Reveal Sequence — Concept, Recommendation, and Architecture

This is the load-bearing creative decision. The brief asks whether to **physically
roll the sealed dice in the 3D scene** or run an **overlay sequence**, and to
justify it against the room-first architecture (solo = wasm room).

### 4.1 Recommendation: **overlay reveal that renders real 3D dice, NOT a physics roll in the play room.**

The reveal is a dedicated full-screen overlay (`z-[70]`, `HeroDieInspector`
idiom) that renders the **actual won dice as real 3D meshes** in a self-contained
canvas — then hands the payoff back to the room via a **"Add to table" claim**
that spawns the won dice into the live wasm/native room through `diceSpawner`.

### 4.2 Why not a physics roll in the room (what the architecture forbids)

The seductive idea — "spawn sealed dice in the real scene and let physics tumble
them to reveal the result" — **breaks against the room-first architecture, and
cannot work without engine changes:**

1. **The gacha outcome is sealed server-side and is independent of physics.** The
   result is fixed at `prepare_pull` and disclosed at `commit_pull_session`
   (`0017`) — it is a weighted RNG draw over banner tiers, **not** a die face.
   The room's face detection (Shared-ADR-005: "face detection runs server-side;
   the room emits `die_settled` with the authoritative face value") answers a
   *different question* (which pip is up) than the gacha draw (which die you won).
   A physical tumble therefore **cannot reveal** the sealed tier — the face it
   lands on has nothing to do with the item won.

2. **Forcing the tumble to "land on" the sealed result requires an engine change
   the ADRs prohibit for cosmetics.** To make a physics roll *display* a
   predetermined outcome you'd have to script/rig the simulation to a target
   state. But the room is **server-authoritative at 60Hz** and the client renders
   **only positioned meshes via snapshot interpolation, with no optimistic
   client-side rendering** (Shared-ADR-004/005). There is no client-side physics
   to choreograph (client Rapier is explicitly retired, Frontend-ADR-001), and
   bending core physics to hit a scripted pose is a per-target engine fork — which
   Shared-ADR-007 forbids ("no wasm-specific behavior forks in core; a limitation
   MUST be fixed in core so both targets get it"). The reveal is **not** worth an
   engine change.

3. **The room is one shared primitive for *play*, not a cinematic timeline.**
   Hijacking the live room for a scripted ceremony fights snapshot interpolation
   and would desync solo (wasm room) vs multiplayer (native server) presentation.

**Conclusion — what the reveal can/cannot do without engine changes:**
- **Can (no engine change):** render the won dice as real 3D meshes in a
  standalone overlay canvas (the `HeroDieStage`/`SharedInventoryDicePreviewCanvas`
  idiom already renders inventory dice off the main scene); play scripted
  camera/lighting/particle choreography in that overlay; then **spawn the won dice
  into the real room** on claim via `spawnDiceFromInventory` with
  `DicePresentationMetadata` (`multiplayerMessages.ts:18`) — a payoff that uses the
  existing room path verbatim.
- **Cannot (would need core changes):** use the room's physics tumble/`die_settled`
  face as the reveal mechanism; predetermine a rolled face; run a rigged cinematic
  inside the authoritative room loop.

### 4.3 How the overlay still honors "feel like DICE, not gacha cards"

The anti-goal is a generic gacha card flip. The reveal earns the 3D identity by:
- The reveal object **is a die** — a real mesh with the theme's dice material
  (`tokens.dice.materials`), rarity glow, and the same tilt-and-spin the inspector
  uses. Not a rectangular card with a portrait.
- A **"sealed die" motif** for build-up: an opaque/obsidian die (unlit, no pips)
  tumbling during the prepare→commit beat, which then **"resolves" into the real
  die** — a material/emissive transition, not a card flip.
- The **claim spawns the dice onto your actual table**, so the reward loop closes
  in the product's core verb: *you pulled dice, now roll them.* No other gacha can
  say the reward is immediately the toy. That is the differentiation.

### 4.4 Reveal flow (state machine)

```
   [Pull ×N tapped]
        │  disable CTA
        ▼
   prepare_pull(banner, N, idemKey)  ──error──▶ [Prepare error] (§9)
        │  returns commitment_root + expires_at(120s)
        ▼
   ┌─────────────────────────────┐
   │  SEALING beat (build-up)     │  opaque dice tumble; "Outcome sealed ✓"
   │  shows commitment_root       │  (this beat masks commit latency)
   └─────────────────────────────┘
        │  fire commit_pull_session(session_id)
        │
        ├─ resolves fast ─▶ [RESOLVE] transition sealed→real dice
        │
        └─ stalls > budget ─▶ [HOLD/degraded overlay w/ 120s countdown] (§7)
        ▼
   commit returns rng_seed + results[]
        ▼
   ┌─────────────────────────────┐
   │  REVEAL                      │  N=1 → single stage (§5.1)
   │                              │  N=10 → sequential flourish → summary (§6)
   └─────────────────────────────┘
        │
        ├─ [ Add to table ] ─▶ spawnDiceFromInventory(...) → close overlay
        └─ [ Continue/Done ] ─▶ close overlay, pity meter reflects new counters
```

**Timing budgets (tunable):**
- SEALING beat: min ~800ms so the seal reads even if commit is instant; extend to
  cover commit latency up to ~2s, then escalate to the HOLD overlay.
- Single reveal: ~1.2s spin-in + settle; user can **tap to skip** to the resolved
  state (respect impatience — satisficing users).
- 10-pull: staggered ~120ms per die into the grid, **skippable** with one tap to
  jump to the full summary.

**Reduced motion:** all of the above collapse to cross-fades (no spin/tumble)
under `shouldReduceMotion()`; results still fully disclosed. Never gate the
*information* behind an animation.

---

## 5. Per-Result Presentation

### 5.1 Single reveal (N=1, NEW copy)

```
┌─────────────────────────────┐
│                             │
│        ✦  N E W  ✦          │  first-copy banner (see §5.3 gating)
│    ╭───────────────────────╮ │
│    │                       │ │
│    │   3D DIE (real mesh)  │ │  rarity-tinted rim light + glow
│    │   spin-in → settle    │ │
│    │                       │ │
│    ╰───────────────────────╯ │
│    Ember d20                │  displayName
│    ◆ Signature              │  tier chip (rarity color, §5.4)
│    from Ember Rotation      │  setId / source line
│                             │
│  ┌───────────────────────┐  │
│  │   Add to table        │  │  → spawnDiceFromInventory (claim)
│  └───────────────────────┘  │
│  Continue                   │
│  Provably fair ✓            │  verification tick (§8)
└─────────────────────────────┘
```
- `catalog_item_id` (`0017:651`) resolves to the inventory die for `displayName`,
  `setId`, geometry, and material.
- Rarity/tier from `tier_rank` (`0017:653`) → §5.4 mapping → glow + chip color.

### 5.2 Single reveal (duplicate)

```
│    Ember d20                │
│    ◆ Signature  ·  DUPLICATE│  tier chip + dup tag (muted, not shaming)
│    ＋25 ✦ Dust              │  duplicate_dust_amount (0017:663)
│    ＋1 copy  (owned ×2)     │  ← GATED on delta #11 (copy grant). Hidden now.
│  [ Add to table ]  Continue │
```
- **Today (as-built `0017`):** duplicate grants **Dust only**; show
  **`+{duplicate_dust_amount} Dust`** read straight from the reveal
  (`0017:663`). The Dust value animates into the Dust balance.
- **After delta #11 (copy + Dust):** add the **`+1 copy (owned ×N)`** line and a
  live copy-count. This line renders behind a capability flag until the copy grant
  and a copy-count read exist. Do **not** fabricate a copy count from client state.
- **Tone:** a duplicate is still an additive, positive event (spec §1.6). Frame it
  as "+Dust" gain, not "you already have this" loss. The `DUPLICATE` tag is a small
  muted chip, never a red error. Avoid goodwill-draining "wasted pull" affect.

### 5.3 First-copy ceremony (special treatment — gated)

The brief calls out `is_first_copy` for special treatment and notes the
first-copy celebration is a **planned later slice**. Design it, gate it:

- **Trigger (future):** the reveal's `is_first_copy` flag = the **ever-owned
  latch** (spec §1.6 / §6.1 delta #11) — first-ever acquisition of a catalog die,
  never re-fires after scrap-all-then-re-pull. **This field does not exist in the
  `0017` payload yet** (§0 correction).
- **Slice-1 proxy:** treat `is_duplicate === false` as "NEW" for the ✦NEW✦ badge
  (simple label, no full ceremony). This is honest for slice 1 (no scrap exists,
  so first-non-duplicate ≈ first-ever).
- **Full ceremony (later slice, behind `is_first_copy`):** the sealed die
  "cracks" with a brighter emissive burst, a one-time "New die unlocked" title,
  and a stronger particle beat than a repeat NEW — reserved for the genuine
  ever-owned first copy so it stays special. Signature-tier first copies get the
  biggest moment (screen-wide accent-gradient wash using
  `tokens.effects.gradients.primary`, still theme-token bounded).
- Keep the ceremony **skippable** and reduced-motion-safe.

### 5.4 Tier → rarity mapping (a real gap to close)

The economy uses tier names **standard / rare / epic / signature** (+ mythic
community; spec §5), while inventory rarity is **common / uncommon / rare / epic /
legendary / mythic** (`getRarityColor`, `InventoryPanel.tsx:709`). The reveal
gives `tier_rank` + `catalog_item_id`; the die's own `rarity` comes from the
catalog. **Resolve color from the die's catalog `rarity`, not from `tier_rank`
directly**, and document the mapping (e.g. signature→legendary/mythic visual
band) in the shared `rarityColor` util so banner, reveal, and inventory agree.

Aesthetic note: the current WoW-style palette (blue/purple/orange/gold) is a
generic MMO idiom and sits slightly off the dark-plum brand. It's the *established*
idiom, so reuse it for consistency in slice 1 — but push the rarity *drama* into
the **3D glow/material and particle intensity**, not louder card borders. Colored
card borders as the only rarity signal is on the AI-slop list; let the object glow.

---

## 6. 10-Pull Summary

Two beats: an optional **sequential flourish** (dice land one by one, skippable),
then a **persistent grid summary**.

```
┌─────────────────────────────┐
│  Your 10-pull        ✓ ⓘ    │  title + fairness tick + info
├─────────────────────────────┤
│  ┌──┐┌──┐┌──┐┌──┐┌──┐        │  5×2 grid of real dice thumbnails
│  │◆ ││  ││✦ ││  ││  │        │  (SharedInventoryDicePreviewCanvas idiom)
│  └──┘└──┘└──┘└──┘└──┘        │  per-cell: rarity glow border, NEW/×n badge
│  ┌──┐┌──┐┌──┐┌──┐┌──┐        │
│  │  ││  ││  ││  ││  │        │  tap a cell → single-die inspect (§5.1/5.2)
│  └──┘└──┘└──┘└──┘└──┘        │
├─────────────────────────────┤
│  1 Signature · 2 Epic · …   │  highlights (best tiers first)
│  ＋58 ✦ Dust from duplicates │  summed duplicate_dust_amount
│  3 new · 7 duplicates       │  new vs dup count
│  ┌───────────────────────┐  │
│  │   Add all to table    │  │  batch spawn (all, or new-only toggle)
│  └───────────────────────┘  │
│  Pull again ×10  🎟 10       │  re-pull affordance (if affordable)
│  Done                       │
└─────────────────────────────┘
```

- **Grid ordering:** preserve draw order by default (users recognize "the 4th one
  was the big one"), but surface the **best tier** in the highlights line so the
  win is legible at a glance (billboard test) without hunting the grid.
- **Per-cell badges:** `NEW` (is_duplicate=false) or `×n`/`+Dust` (duplicate).
  Rarity glow via §5.4. Real dice meshes via the pooled preview canvas
  (`SharedInventoryDicePreviewCanvas.tsx`) so the summary still *shows dice*, not
  icons — but budget-guard: 10 live canvases is heavy on low-end; fall back to
  pre-rendered thumbnails per device tier (`resolveRenderDeviceTier`).
- **Add all to table:** batch `spawnDiceFromInventory`. Offer "new only" when the
  batch is mostly duplicates (avoid dumping 10 identical d6s on the tray
  unexpectedly). Respect arena capacity; if the batch exceeds it, spawn what fits
  and toast the remainder ("added 6, rest are in your inventory").
- **Pull again** reflects live balance/hold state (§3); hidden if unaffordable.

---

## 7. Cancel / Expiry UX (120s hold)

The 120s hold (`prepare_pull.expires_at`, `0011:1308`) is an **error-recovery
surface, not a normal step.** In the happy path the user never sees a countdown —
the SEALING beat masks the sub-second prepare→commit window and commit resolves.
The hold UI appears only when commit stalls, the app is backgrounded mid-flow, or
the user explicitly backs out after prepare.

```
┌─────────────────────────────┐  (degraded-only overlay)
│      Finishing your pull…    │
│    ╭───────────────────────╮ │
│    │  sealed dice (opaque) │ │  hold visual = the sealed motif, paused
│    ╰───────────────────────╯ │
│    Outcome sealed ✓          │  commitment_root shown (nothing lost)
│    Hold expires in 1:58 ⏳   │  live countdown from expires_at
│  ┌───────────────────────┐  │
│  │   Reveal now (retry)  │  │  re-fire commit_pull_session
│  └───────────────────────┘  │
│  Cancel pull                │  cancel_pull_session → release hold
└─────────────────────────────┘
```

- **Reveal now / retry** re-calls `commit_pull_session(session_id)` (idempotent
  for a committed session; safe to retry). If already committed, fetch via
  `get_committed_pull_reveal` (`0017:1045`) and jump to reveal.
- **Cancel** calls `cancel_pull_session` (`0017:1063`) → hold released, **no
  refund needed** (reservation, not debit). Return to banner; balances restore to
  pre-hold. Copy: "No rolls spent." (Reassure — nothing was charged.)
- **Expiry (countdown hits 0):** the hold auto-releases server-side; the overlay
  swaps to a gentle "Hold expired — no rolls spent. Try again?" with a single
  **Pull again** CTA. Never strand the user on a dead session.
- **Resume on reload:** if the app reopens with a live/committed session id
  (persist minimally), rehydrate via `get_committed_pull_reveal` (committed) or
  offer Reveal/Cancel (live) — don't lose a paid-but-unrevealed commit.
- **Idempotency:** the same `p_idempotency_key` must back a given user intent so a
  ret+retry of prepare doesn't create a second hold.

---

## 8. Verification Affordance ("provably fair")

A **subtle trust tick**, not crypto noise. Default: a small `Provably fair ✓`
label (accent tick + muted text) on the banner footer, reveal, and 10-pull
summary. Tap → expandable detail (inline, `<details>`-style; no separate route):

```
Provably fair ✓  ▾
──────────────────────────────
Before your pull, the outcome was sealed:
  commitment  0x9f3a…c21        [copy]   ← commitment_root (from prepare)
After reveal, we published the key:
  seed        0x77b2…0e         [copy]   ← rng_seed (from commit)
  #1  nonce 0x…  →  commitment 0x…  ✓    ← per-result nonce+commitment (0017:664-665)
  #2  …
Anyone can recompute each result from the seed
and confirm it matches the sealed commitment.
[ How verification works ]                        ← link to explainer
```

- Values map exactly: `commitment_root` (shown **before** results exist, during
  SEALING — this is the honest "we committed before you knew"), then `rng_seed`
  and per-result `nonce`/`commitment` (`0017:646,664-665`) after commit.
- **Slice 1 discloses; it does not need to compute.** Showing the values +
  copy-to-clipboard + an explainer link is enough for the trust affordance. A
  client-side recompute/verify (`sha256(nonce…) == commitment`, commitments →
  root) is a polish enhancement (§12), rendered as a green ✓/✗ per row when built.
- Tone: calm, one line collapsed, expandable for the curious. **Never** a wall of
  hashes in the user's face during the celebration — the tick sits quietly and
  the detail is opt-in.

---

## 9. Loading / Error / Retry States

First-class, per the "every state is real UX" rule. Each maps to a concrete
failure of the contract calls.

| State | Trigger | Presentation | Recovery |
|---|---|---|---|
| **Balance loading** | fetching `roll_ticket_balances` | balances strip skeleton (shimmer on the number only, not layout shift) | auto |
| **Banner loading** | banner/pity fetch | hero stage skeleton (dark-plum block, no spinner-in-a-circle) + disabled CTA | auto |
| **Prepare error** | `prepare_pull` fails (network, banner inactive, insufficient at server) | toast + CTA re-enabled; if server says insufficient, route to §3 C/D sheet | tap Pull again |
| **Sealing stall** | prepare ok, commit slow | escalate to HOLD overlay (§7) with countdown | Reveal/Cancel |
| **Commit error** | `commit_pull_session` fails after prepare | HOLD overlay, "Couldn't finish — your hold is safe (1:58)"; retry re-calls commit | Reveal now / Cancel |
| **Commit succeeded, reveal fetch lost** | commit ok but client dropped the payload | `get_committed_pull_reveal` re-read; "Restoring your pull…" | auto |
| **Expired** | 120s elapsed pre-commit | "Hold expired — no rolls spent" | Pull again |
| **Auth lost mid-flow** | token invalid | "Signed out — sign in to continue"; a *committed* session is safe and re-readable after re-auth | re-auth |
| **Spawn/claim failure** | `spawnDiceFromInventory` returns `success:false` (`diceSpawner.ts:78`) | die stays in inventory; toast "Saved to inventory — add from your collection" | open Inventory |
| **Offline** | no network | disable Pull, "You're offline"; do not fake a pull | auto on reconnect |

Principles:
- **Never lose a committed pull.** Once commit returns, the grant is durable
  server-side; the client re-reads via `get_committed_pull_reveal`. UI errors
  after commit are *presentation* problems, framed as "restoring," never "lost."
- **Skeletons over spinners** for structural loads (perceived speed; no
  spinner-in-circle slop). Reserve motion for the celebration, not the wait.
- **No layout shift** when balances/pity resolve — reserve the space.
- Toasts for transient, sheets for actionable, overlay for the hold.

---

## 10. Motion, Accessibility, Performance

- **Reduced motion:** every spin/tumble/particle path has a cross-fade fallback
  via `shouldReduceMotion()` (established: `BottomNav`, `FlyoutPanel`,
  `BottomSheet`). Information is never animation-gated.
- **Touch targets:** CTAs and nav-style buttons ≥ 44px (matches `BottomNav`'s
  44px `NavButton`). 10-pull grid cells ≥ 44px tap area even if visually smaller.
- **Contrast:** all text on `--color-surface`/`--color-background` uses the token
  text ramp (cream `#f3ebe2` 13.84:1 on surface, per `tokens.ts` notes). Rarity
  colors are decorative accents, **never** the sole carrier of meaning — pair
  rarity color with the tier **label** (colorblind-safe).
- **Focus/ARIA:** reveal + sheets are `role="dialog" aria-modal="true"` with
  labels (idiom: `HeroDieInspector.tsx:76-79`); focus trap; Esc/back closes to a
  safe state (mirrors the hold "Cancel" semantics — never abandons a live commit
  silently). Announce the result to screen readers ("You won Ember d20, Signature,
  new").
- **Performance is design:** the reveal canvas and 10-pull thumbnails reuse the
  pooled preview canvas and device-tier LOD (`resolveDiceRenderLod`,
  `resolveRenderDeviceTier`) — do not stand up 10 full `<Physics>`-grade scenes.
  Preload the featured die mesh on banner open so the reveal doesn't pop. Cap
  concurrent live canvases; degrade to static renders on low tier. Font/skeleton
  quality per the perceived-speed rule.
- **Haptics:** a light tap on Pull, a stronger pulse on a signature/first-copy
  reveal (haptic thresholds already centralized, `docs/guides/haptic-feedback.md`).
- **Anti-slop checklist for the implementer:** no purple/blue gradient hero, no
  icon-in-circle "feature cards," no emoji-as-currency (use theme-token glyphs/
  text for Rolls/Stars/Dust), no uniform bubbly radii on the dice themselves, no
  colored-border-only rarity. Let the 3D dice and the dark-plum tray carry it.

---

## 11. Contract → UI Mapping (implementer reference)

| UI moment | RPC / field | Notes |
|---|---|---|
| Ticket balance | `roll_ticket_balances` (`0014`) | available = balance − live same-type holds |
| Pity meter | server pity/session state | **read-only**; needs a read RPC (gap, §12) |
| Pull tap | `prepare_pull(banner, N, idemKey)` (`0011:1308`) | holds, result-free; returns `commitment_root`, `expires_at` |
| SEALING seal shown | `commitment_root`, `commitment_scheme` | shown before results exist |
| Reveal fire | `commit_pull_session(session_id)` (`0017:1027`) | debits + grants + returns `results[]`, `rng_seed` |
| Per-die identity | `results[].catalog_item_id`, `tier_rank` | → inventory die + rarity color |
| NEW vs dup | `results[].is_duplicate` (`0017:662`) | NEW = `false` (proxy for is_first_copy, §5.3) |
| Dust gain | `results[].duplicate_dust_amount` (`0017:663`) | animate into Dust balance |
| First-copy ceremony | `is_first_copy` — **NOT PRESENT** | gated on delta #11 |
| Copy count line | copy-count read — **NOT PRESENT** | gated on delta #10/#11 |
| Verification | `commitment_root`, `rng_seed`, `results[].nonce/commitment` | disclose + copy (§8) |
| Claim to table | `spawnDiceFromInventory(...)` (`diceSpawner.ts:94`) + `DicePresentationMetadata` | closes the loop into the room |
| Stars→rolls | `0016` conversion (160:1) | State C fallback |
| Cancel | `cancel_pull_session` (`0017:1063`) | release hold, no refund |
| Resume | `get_committed_pull_reveal` (`0017:1045`) | re-read committed reveal |
| Auth gate | `require_non_anonymous_user` | guest → "Sign in to pull" |

---

## 12. Implementation Phasing

**Slice 1 (UI) — ships with the standard banner, free tier, pre-#154:**
- Banner screen (standard tab), hero stage with real featured/pool die mesh,
  shallow pity meter (read-only), rates disclosure sheet.
- Balances strip + Pull ×1 / ×10 CTA states A–D, Stars→`standard_roll` conversion
  sheet (`0016`).
- Full flow: `prepare_pull` → SEALING beat → `commit_pull_session` → reveal.
- Single + 10-pull reveal with real 3D dice; NEW badge via `is_duplicate=false`;
  duplicate `+Dust` from `duplicate_dust_amount`; 10-pull grid + summary.
- "Add to table" / "Add all" claim via `diceSpawner`.
- Cancel/expiry hold overlay (degraded path); all §9 error/loading states.
- Verification tick that **discloses** commitment_root/seed/nonces + copy +
  explainer link (no client recompute yet).
- Premium tab present but **locked** ("Coming soon"), premium card + soft-pity/
  hard-75 meter designed and rendered dormant.

**Backend gaps that block parts of slice 1 (flag to route work):**
- **Pity read RPC** — the meter needs server-owned pre-pull pity; if absent, ship
  the meter as "reflects your last pull" from reveal counters and flag for a read
  path. Do not accumulate pity client-side.
- **Ticket balance selector** — confirm a client-readable `roll_ticket_balances`
  view/RPC (`0014`); required for the balances strip and CTA states.

**Polish / later slices (explicitly deferred):**
- **First-copy ceremony** + **`+1 copy` / owned-×N** lines — gated on §6.1 delta
  #11 (`is_first_copy` ever-owned latch + duplicate copy grant).
- **Client-side fairness verification** (recompute nonce→commitment→root, per-row
  ✓/✗).
- **Premium banner activation** — soft-pity ramp live meter, Stars→`premium_roll`
  conversion, premium reveal — all **#154-gated** (spec §1.5).
- **Sealed-die "crack open" material transition** and signature screen-wash — the
  premium-tier flourish; slice 1 can ship the simpler spin-in/cross-fade.
- **Star bundle top-up** in the insufficient sheet (post-#154).

---

## 13. Design Completeness Rating

**This spec vs a 10/10 implementable pull experience: 8.5/10.**

What's solid (blocks nothing): IA + entry points, banner/pity anatomy per class,
all CTA/insufficient/conversion states, a reveal recommendation that is
architecturally correct and needs zero engine changes, full dupe/Dust/first-copy
(gated) treatment, 10-pull summary, cancel/expiry/error matrix, verification
affordance, phasing.

What keeps it from 10/10 (the gaps a build will hit):
1. **Pity read source** — the meter's pre-pull number needs a server-owned read
   RPC that isn't cited; without it the meter is retrospective only. *(backend)*
2. **Ticket-balance read path** — needs a confirmed client selector on `0014`.
   *(backend)*
3. **`is_first_copy` + copy-count** — absent from `0017`; the first-copy ceremony
   and owned-×N lines are designed but un-buildable until delta #11. *(backend)*
4. **Tier→rarity mapping + shared `rarityColor` util** — a real refactor
   (`getRarityColor` is currently private to `InventoryPanel`), and the tier
   vocabulary (standard/rare/epic/signature) ≠ rarity vocabulary must be pinned.
   *(frontend)*
5. **Currency glyphs** — no Stars/Dust/roll icon tokens exist; slice 1 needs
   theme-token text/glyph treatments (not emoji) added to the token set.
   *(design + frontend)*

None of 1–5 block the *core standard loop* shipping; 1–2 are the only ones that
degrade a slice-1 surface (the meter/balances), and both have honest fallbacks.

---

## 14. Non-Goals, Risks, Handoff

**Non-goals (this spec):** premium activation, paid Star bundles, scrap/craft UI,
minigame faucets, subscription/Lunar Pass surfaces, the fairness *math* engine
(disclosure only), multiplayer-room reveal choreography.

**Risks:**
- **Reveal-vs-room desire.** Stakeholders may push for "roll the dice in the
  scene to reveal." §4.2 is the standing rebuttal: it's architecturally impossible
  without an engine fork the ADRs forbid, and the face has nothing to do with the
  draw. Hold the line; the *claim-to-table* payoff is the correct 3D differentiator.
- **Slop drift.** Under deadline this collapses into a card-flip gacha with gradient
  cards. The §10 anti-slop checklist and the "real mesh, not art" rule are the guard.
- **Pity trust.** Client-accumulated pity is a dispute vector; keep the meter
  server-sourced (gap #1).
- **Duplicate framing.** If duplicates read as "wasted pull," goodwill drains;
  the +Dust-forward framing (and future +copy) is deliberate.

**Handoff:** route implementation to `ika-frontend` with this spec as acceptance
criteria. Acceptance = the §12 slice-1 list renders with the §11 contract wiring,
all §9 states reachable, §10 reduced-motion/contrast/44px targets met, and the
§10 anti-slop checklist clean. Open the two backend gaps (pity read, ticket
balance selector) as blocking questions before the CTA/meter are wired.
