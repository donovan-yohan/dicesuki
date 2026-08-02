# Saved Rolls Bonus System

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed saved rolls guidance.

## Overview
The saved rolls feature allows users to save dice roll configurations with bonuses (flat bonuses and per-die bonuses) and advanced mechanics (keep/drop, exploding, reroll, min/max clamps, success counting). The system intelligently manages bonus state to ensure bonuses only apply when appropriate.

## Architecture

### Core Components
1. **`useDiceStore.ts`**: Manages `activeSavedRoll` state with bonus + plan tracking
2. **`savedRollPlan.ts`**: Maps a roll's mechanics onto physical room dice, and scores them
3. **`savedRollExecution.ts`**: Runs the roll as spawn waves over the room protocol
4. **`SavedRollsPanel.tsx`**: Thin wrapper — latch, inline errors, panel close
5. **`useMultiplayerStore.ts`**: Owns authoritative room dice and protocol acknowledgements
6. **`Scene.tsx`**: Reads room dice and displays results with bonuses and kept/dropped state
7. **`diceHelpers.ts`**: Formats saved roll formulas, badges and ranges

### Bonus State Structure
```typescript
activeSavedRoll: {
  name: string
  flatBonus: number                    // Flat bonus added to total (e.g., +4)
  perDieBonuses: Map<string, number>   // Per-die bonuses (dice ID → bonus), group roots only
  plan?: SavedRollPlan                 // Advanced mechanics, mapped to room dice ids
} | null
```

## Bonus Lifecycle

### 1. Execute Saved Roll
When user executes a saved roll (e.g., "6d6 + 4"):
- Clears the local player's current room dice and waits for the exact removals
- Expands saved-roll sources in order; owned sources use `addDie(type, inventoryDieId)` so presentation metadata flows, while anonymous sources use `addGenericDie(type)`
- Waits for `dice_spawned` to contain every exact client request ID for the local owner; response arrival order does not matter
- Reconciles each confirmed room die ID to its requested per-die bonus
- Sends `roll`, waits for the matching local `roll_started`, then marks the saved roll used and closes the panel
- Leaves the panel open with an inline error if clear, spawn, or roll fails or times out

### 2. Result Display
Shows total with bonuses:
- **Grand Total**: `diceSum + perDieBonusesTotal + flatBonus`, or the plan's aggregate when the roll uses advanced mechanics
- **Individual Dice**: Shows the reconciled per-die bonus next to each face value
- **Flat Bonus**: Shows a separate bonus chip when non-zero (hidden in success-counting mode, which ignores it)
- **Dropped dice**: Dimmed and struck through, with an `N dropped` hint
- **Roll notice**: A transient line for follow-up waves that ran out of table

## Advanced Mechanics (physical execution)

There is no server-side notion of a saved roll. `roll_player_dice` (`server/core/src/room.rs`) applies an impulse to **every** die the player owns, and `roll_complete.total` is a plain face sum. So every mechanic is orchestrated client-side as physical spawn waves over the existing protocol — this slice added **no** server, core or protocol changes.

### Waves (`savedRollExecution.ts`)

1. **Base** — clear our dice, spawn `rollCount` dice per entry, send `roll`, wait for all to settle. This is the **only** wave that sends `roll`; a second `roll` would re-roll the dice that already landed.
2. **Reroll** — dice matching the condition are `remove_dice`d and respawned. A spawned die falls from `SPAWN_HEIGHT` and settles on its own, so **for follow-up waves the spawn IS the roll**. Once only: the replacement's face is final. Owned dice are respawned as themselves (removal is awaited first, or `addDie` refuses the duplicate).
3. **Explosions** — each die showing the trigger face spawns one more die whose face **adds** to it. Repeats while dice keep exploding, bounded by `MAX_EXPLOSION_WAVES` (3) and by free room capacity.

> **Known divergence.** `ExplodingConfig.limit` is honoured verbatim by the virtual `rollEngine.ts` (`limit ?? Infinity`), but the physical path uses `min(limit ?? 3, 3)` — every explosion costs a real room slot. An entry with `limit: 10` therefore chains up to 10 times virtually and at most 3 times on the table. `rollEngine.ts` has no production consumers, so this only matters if it ever gains one; the builder never offers a limit above the cap.

The panel closes as soon as the base wave starts rolling, which splits error handling in two:
- **Before** that point → the promise rejects and `SavedRollsPanel` renders its inline alert.
- **After** → `useDiceStore.rollNotice`, rendered by the result HUD (the panel is gone).

Either way `executingRef` is held for the whole sequence, so a second roll can never interleave with a half-finished plan.

**Releasing `savedRollWavesPending` is the sequence's hard obligation.** `beginSavedRollWaves(baseIds)` is claimed *before* `roll` is sent (so the settle handler already knows to hold the history row open), which means every path from that point on has to close it:
- the follow-up waves run inside `try/finally`, so they release it however they end;
- the base roll's `publishPlan` → `roll()` → ack window is wrapped in its own `try/catch` that releases it and rethrows.

That second guard is not theoretical: an ack timeout, a socket drop (`SEND_FAILED`), a room rejection, or a spawn-id mismatch all abort between "claimed" and "waves running". A flag left set there is a session-wide lockout — every saved roll and the HUD's Roll button stay disabled and `recordDieSettled` never closes a cycle, until the page is reloaded.

While `savedRollWavesPending` is true:
- the HUD's Roll button is disabled (`roll` impulses **every** die the player owns, so it would re-roll dice that already landed and invalidate the plan);
- reopening the saved-rolls panel shows "Still rolling — waiting for the follow-up dice to land" and its roll buttons are disabled, because the execution latch would silently reject them;
### One history row per roll (issue #211)

`roll_complete` is the single history writer for an ordinary roll; `recordDieSettled` closes the settle cycle but records nothing. A wave sequence is the one exception, and it **claims** the roll rather than relying on the latch being up when the message lands:

- `beginSavedRollWaves(baseIds)` stores those dice ids in `useDiceStore.suppressedRollDiceIds`. The `roll_complete` handler drops the message whose result set matches, whenever it arrives, and consumes the claim.
- **Why identity, not timing.** A roll that configures `reroll`/`exploding` but triggers neither has no follow-up wave to run, so the sequence finishes in the same task the base dice settle in — *before* `roll_complete` crosses the socket. A `savedRollWavesPending` check finds the latch already down and writes a second row. Only the base wave is ever an explicit roll, so at most one message per saved roll is dropped.
- The claim is dropped when a new cycle opens (`markDiceRolling` on a fresh cycle), so re-rolling an unchanged table cannot inherit it.
- `finishSavedRollWaves` writes the row, carrying the same player attribution `roll_complete` would have. If dice are still in the air it records **what has settled** rather than nothing; if nothing settled at all it releases the claim so `roll_complete` still writes the row. Either way the roll is never lost.

### A removal mid-roll (issues #226 + #221)

**The room shrinks the roll; it does not cancel it.** Removing a die the room is tracking for an explicit roll drops that id from `pending_roll.dice_ids` (`remove_dice`, `server/core/src/room.rs`) and the roll still completes from its **survivors**. If they have all already settled, the removal wakes the sim so the completion drains through the one path that broadcasts *and* reports it. Removing the roll's last tracked die ends it silently — nothing to report. Dropping the ids is also what keeps a *reused* die id (they are client-supplied) from satisfying a roll it never joined, which is what cancelling the whole roll used to guarantee.

The client's own compensation therefore writes a **provisional** row, not the final one:

- The whole `dice_removed` message is applied in **one** store update (`applyDiceRemoval`), which takes both decisions once for the entire id set: does this shrink the open roll, and is the roll now over. The cycle is *marked* (`orphanedCycle`) rather than recorded there and then; the row is written when our roll next goes still — by the settle drain, or by the removal itself if it took the last die out of the air — so it contains everything that *eventually* landed.
- When the room's `roll_complete` for those survivors arrives a frame later, `recordRoomCompletedRoll` **replaces that row in place** (same row id, same position in history) instead of appending a second one. The room is authoritative; the client's row was a stand-in.
- The provisional row stands as written only where no completion follows: a room old enough to still cancel `pending_roll` on removal. That is the fallback the orphan path exists for, and it degrades to exactly one row.
- The mark is scoped to one cycle — dropped when a fresh cycle opens, on clear and on reset — because re-rolling an unchanged table presents the *same dice ids*, and that roll's completion must join history rather than overwrite the older row.

Applying the message one die at a time got this wrong twice over. Recording at removal time took the total at the wrong moment: a removal that beat every die to the table found nothing settled and recorded nothing, and dice still tumbling when the message arrived (the normal case, since a removal races the physics) were dropped. And evaluating the close per id made the outcome depend on the order the ids happened to arrive in — sweeping a two-die roll with one die settled recorded a row when the airborne id came first and nothing when the settled id did.

**Full clear records nothing.** A message that removes the roll *entirely* — Clear All — closes the cycle silently: the player swept the table, so there is no roll to report, which is what the settle-drain always did, and what the room now does with the emptied roll. Only a roll with survivors is written.

**The cycle is the LOCAL player's roll.** Only our own `roll_started` opens or extends it (issue #221); a rival's dice are marked rolling — the HUD has to drop their stale faces while they tumble — but never join it, and the cycle closes when *its own* dice have landed rather than when the table is empty. Folding every player's roll in meant a rival rolling mid-sequence reset the cycle, carrying off the dice our wave row is built from and the claim that stops it being written twice, and left their dice sitting in our cycle to be orphaned by the next bit of tidying up. Their roll is recorded by its own `roll_complete`, attributed to them — a different path entirely, unaffected by any of this.

A wave sequence's own claimed dice are exempt from the mark, since that is the reroll wave discarding its dice and `finishSavedRollWaves` owns that row.

### Invariant: the backend clears the saved-roll context on every spawn
`useMultiplayerDiceBackend.addDie`/`addGenericDie` call `clearActiveSavedRoll()` as their first act — including the executor's own follow-up-wave spawns. Therefore:
- `clearActiveSavedRoll` **must not** touch `savedRollWavesPending`; that flag is owned solely by `beginSavedRollWaves`/`finishSavedRollWaves`. (It did once, which tore down wave tracking on the first reroll or explosion spawn and split one roll across several history rows.)
- every wave **must** re-`publishPlan` after its spawns and **before** `markDiceRolling`, so nothing can observe a settle while the plan is missing.

Both are pinned by `src/lib/savedRollExecution.test.ts`: the fake room's spawn reproduces the `clearActiveSavedRoll` side effect, and one test drives the real `useMultiplayerDiceBackend` with only the protocol send stubbed.

**Error scoping is per wave, not per wait.** Each wave opens with `beginWave()`, which clears `roomActionError`; every wait then fails on any error it sees, because that error can only have been raised by the wave in flight. Scoping *inside* the wait instead — ignoring an error that was already present when the wait began — looks equivalent but is not: an action and the error it raises are synchronous, so `backend.roll()` sets `roomActionError` *before* the ack wait starts, and such a wait would be blind to the very rejection it is waiting on.

### Capacity budgeting
`getRollDiceCount` counts `rollCount` (not `quantity`) toward the 30-die cap, so keep/drop is pre-validated in the builder and re-checked at execution. **Exploding is deliberately not pre-counted** — its worst case is unbounded. Each explosion wave is budgeted against whatever is actually free at that moment; anything that does not fit is skipped and reported through `rollNotice`.

### Scoring (`savedRollPlan.ts`)
A plan groups room dice into **chains** whose faces sum into one logical die result (an explosion joins its parent's chain; a reroll replaces the chain's member). Order of operations matches `rollEngine.ts`: clamp the chain total → add the per-die bonus → keep/drop on those values → sum, or count successes. A roll with any success-counting entry ignores the flat bonus. Dice that have not settled are ignored rather than counted as zero, so a partially settled table shows a running total.

`keepMode` is optional on `DiceEntry` and nothing validates it at runtime, so it defaults to `KEEP_MODE_DEFAULT` (`'highest'`) in one place — `diceHelpers.ts` — and the notation, badges, `rollEngine` and the plan all read that same default.

### Notation
`formatDiceEntry` appends in a fixed order: exploding binds to the die (`4d6!`, `4d6!5`), then ` kh2`/` kl2`, ` r≤2`, ` ≥5`, ` [2 specific]`. Min/max clamps are a badge, not notation. `calculateDiceEntryRange` returns `{ min, max, open? }`; `open` marks an exploding entry, rendered as `Range: 4 - 12+`.

### Composing an entry: pinned vs auto slots (`RollDicePicker.tsx`)
The builder assembles the **roll**; which physical dice fill it is decided per entry in a dialog opened from the entry card (the die preview / formula / source chips are one `aria-haspopup="dialog"` button). There is no standing grid of owned dice in the builder, and no inventory drop zone — PO decision (g), 2026-07-28.

An entry of N dice has **N slots**, one per die (`expandDiceEntrySources`). Each slot is either:
- **pinned** — a `specific` source naming one `InventoryDie` by id, or
- **auto** — an `anonymous` source, filled owned-first at execution and falling back to a basic die once the player's dice of that type run out (`spawnEntry`).

`pinDieToEntry` / `unpinDieFromEntry` move a slot between the two and **never change N**. That is the load-bearing invariant: the room-capacity validation (`getRollDiceCount`) and the executor's spawn loop both key off the dice count, so the picker cannot move it underneath them. With every slot pinned the remaining tiles go `disabled` rather than growing the entry. `collapseRollSources` merges adjacent auto slots back into one group afterwards, so pinning does not persist a row of "1 generic" sources.

One inventory die is one physical die, so a die pinned by another entry of the same roll is shown disabled ("In another entry") rather than hidden — `spawnDice` marks it pending on send, and a second claim would silently spawn a basic.

**Percentile entries are pickable.** The tens half is always a plain engine die (nobody can own a `d10tens`), but the ONES half is an ordinary owned d10 and carries the entry's source, so pinning applies to it; the dialog says so inline.

Tiles reuse the inventory's presentation — the real animated 3D previews — through a **single** `SharedInventoryDicePreviewCanvas` scissored across the grid. Do not mount a canvas per tile; a large collection would exhaust the browser's WebGL contexts. Tiles are also batched at `VISIBLE_DICE_BATCH_SIZE` (24, matching `InventoryPanel`) behind a "Show More": every visible preview is transformed and scissor-rendered every frame, and an unbounded grid measured single-digit fps at 60 tiles. Only the visible batch is handed to the canvas, since it builds a geometry + material entry per die it receives.

Dragging a die out of the inventory into the builder is **gone** — the picker replaced it, `src/lib/inventoryDrag.ts` is deleted, and the inventory cards are no longer `draggable`.

### The nested-dialog contract (`useNestedDialog`)

The dialog is `fixed inset-0 z-[70]`, the same band as `HeroDieInspector`, so it sits above the `z-50` sheet that hosts it. Layering alone is not enough, because `BottomSheet` runs its own Escape and focus trap on `document`:

- `BottomSheet` **yields** both while any nested `[role="dialog"][aria-modal="true"]` is mounted. Without that, one Escape dismissed two dialogs.
- The nested dialog **must then do the job itself**, via `useNestedDialog` (`src/hooks/useNestedDialog.ts`): focus into the dialog on open and back to the opener on close, a Tab trap, and Escape — with Tab and Escape *stopped* so the sheet's handlers never see them.

Both halves are required. Declaring `aria-modal` without handling anything makes the sheet yield to a dialog that then handles nothing: Escape does nothing and Tab walks out onto the HUD. `HeroDieInspector` shipped in exactly that state and is now on the same hook; `HeroDieInspector.test.tsx` mounts it inside a **real** `BottomSheet` and is the regression gate for both halves (`InventoryPanel.test.tsx` mocks the sheet away, which is why this went unnoticed).

Backdrop dismissal requires the press **and** the release on the backdrop. Checking the click target alone is not enough: the browser fires `click` on the nearest common ancestor of press and release, so a gesture starting on the backdrop and ending inside the dialog would dismiss it — as would a click the backdrop merely inherits when pinning re-renders the tile under the cursor.

### Percentile (d100) entries
A d100 is a `d10tens` + `d10` PAIR combined into one 1-100 result, which changes what the mechanics can mean:

- **Gated off in the builder**: exploding and reroll are hidden for a percentile entry, with an inline explanation — you cannot reroll or explode half a pair. `createSavedRollPlan` strips both, `formatDiceEntry`/`getDiceEntryBadges` omit them, and `selectRerollTargets`/`selectExplosionTargets` skip percentile groups, so a legacy row carrying those configs is dropped rather than half-applied or falsely advertised. The reroll-based quick presets (Great Weapon Fighting, Halfling Luck) are hidden for the same reason.
- **Keep/drop IS supported**: keep/drop operates on whole pairs, which the plan expresses natively (each pair is one group), so the section and the Advantage / Disadvantage / Elven Accuracy presets stay available and `2d100 kh1` scores correctly.
- **Still available**: min/max clamps and success counting, applied to the **combined** value. Their ceiling is `getEntryMax` (100), not the 90 of the tens half.
- **One plan group per pair**, `memberIds: [tensDieId, onesDieId]`, flagged `percentile`. The group's value is `combinePercentile(tens, ones)` — `00 + 0` is 100 — not a sum. A half-settled pair scores nothing rather than reporting the tens face alone.
- **The per-die bonus rides on the ones die** (`bonusMemberId`): the tens half is anonymous engine scaffolding that can never be an owned die.
- **Capacity**: `getRollDiceCount` counts physical dice via `expandDiceEntrySpawns`, so 15 d100s is exactly the 30-die cap and 16 is refused.
- **`percentileSumCorrection` is applied only to dice the plan does NOT own.** The plan combines its own pairs; correcting them again would double-count. Both the plan branch and the raw branch of `buildCycleSnapshot` and of `roll_complete` handle this.
- **The HUD** renders a pair as ONE `D100` chip carrying the same `data-testid="result-die-chip"` / `data-dropped` contract as any other chip, so keep/drop dimming and the e2e assertions work unchanged.

### Known limitation — remote viewers
The plan is **client-side only** and never crosses the wire. A remote viewer in a multiplayer room sees each die's raw face and a raw face sum: no keep/drop, clamps, success counting or bonuses. Their history row is attributed (`displayName`) and carries no saved-roll name, so nothing they see is a mislabelled combined total — it is simply the unadorned dice. Correcting remote totals would need the plan on the protocol, which is out of scope for this slice.

### 3. Clear Bonuses
`activeSavedRoll` is automatically cleared when:
- The user manually adds dice through the room backend
- A saved-roll clear/spawn/roll phase fails
- The unified dice result state is reset

## Formula Formatting

The `formatSavedRoll()` function properly handles operators:
- **Positive bonus**: `6d6 + 4` (not `6d6 + +4`)
- **Negative bonus**: `6d6 - 4` (not `6d6 + -4`)

## Percentile (d100) Entries

A d100 is **not** a hundred-sided die. It is a pair of physical dice:

| Half | Engine shape | Faces |
|------|--------------|-------|
| Tens | `d10tens` | `00, 10, … 90` |
| Ones | `d10` | `0 … 9` |

The result is `tens + ones`, with `00 + 0` reading **100** — so the range is
1–100. Per-die bonus applies once, to the combined value.

### Entry model

A percentile entry keeps `type: 'd10'` (the ones half) and adds one additive
marker, `DiceEntry.percentile?: true` (`src/types/savedRolls.ts`).

`'d100'` is deliberately **not** a `DiceShape`. Keeping `type` a real shape means
persistence, `rollSources` normalization, per-die bonus and keep/drop all keep
working untouched, and a roll saved before d100 shipped (no flag) still means
"an ordinary d10 entry" — so **no store migration is required**. Notation renders
`1d100` via `formatDiceEntry`; range math goes through `getEntryMin`/`getEntryMax`.

`d10tens` is an **engine-only** shape: it is never minted, owned, pulled, themed,
or offered in the dice picker. Anything that must be player-ownable uses
`INVENTORY_DICE_SHAPES` / `isInventoryDiceShape` from `src/types/diceShape.ts` —
that predicate is the boundary, and `percentileRolls.test.ts` asserts against it
directly.

### Pairing lives on the dice, not on the roll

At spawn, both halves get the same `presentation.percentilePairId` with opposite
`presentation.percentileRole` (`'tens'` / `'ones'`). `presentation` is the
client→server display channel of Shared-ADR-005, echoed back on `dice_spawned`
and `roll_complete.results[].presentation`; the room never interprets it.

This is load-bearing. Pairing kept in local roll state (`activeSavedRoll`) would
be lost the moment the table is edited — adding a die clears the saved-roll
context — would never reach **remote** players, and would not survive a refresh
or reconnect. In each of those cases the pair silently degrades into two
uncorrected halves. Because the pairing travels with the dice, every client that
can see the dice reconstructs it via `derivePercentilePairs`.

All three aggregation paths derive pairs from the dice themselves:
`ResultDisplay` (HUD), `useDiceStore.recordDieSettled` (history snapshot) and
`useMultiplayerStore` `roll_complete` (including other players' rolls).

### Deliberate server-total divergence

`RollComplete.total` (`take_completed_rolls`, `server/core/src/room.rs`) is a
**plain sum of raw face values** and stays that way — the server must not need to
know which dice were paired. For every percentile outcome except `00 + 0` that
plain sum already equals the combined value.

Only `00 + 0` diverges: the **server reports 0** while the **client displays
100**. The `+100` correction lives in `percentileSumCorrection`
(`src/lib/percentileRolls.ts`) and is applied client-side only. Do not "fix" the
server total to match — it is intentional, and both values are correct for their
own purpose.

## Cross-Device Persistence

Guests keep their rolls in `localStorage` (`dicesuki-saved-rolls`, the
`useSavedRollsStore` persist layer). Signed-in players additionally sync through
`src/lib/dataSync.ts` to the per-user `saved_rolls` jsonb row
(`supabase/migrations/0002_user_data.sql`, own-row RLS).

### Per-roll merge, not whole-blob LWW

Every other sync target settles conflicts by whole-blob last-write-wins on the
server `updated_at`. Saved rolls do **not**: they merge per roll
(`src/lib/savedRollsMerge.ts`, wired via `SyncTarget.mergePayload`).

Blob LWW is only correct while at most one device has unsynced work, which is not
the normal case. It loses an edit whenever a push does not land before the tab
closes (offline, or just inside the ~1s debounce — the device's stamp still
equals the server's, so the next hydrate replays the server blob over the top),
and it destroys one whole side when two devices each add a *different* roll.

The merge is a union keyed on the stable roll `id`:

| Situation | Result |
|---|---|
| Roll on one side only | Kept — this is what rescues offline work |
| Same roll on both | Higher `SavedRoll.updatedAt` wins; ties go to **remote** so both devices agree |
| Roll deleted on one side | Suppressed by a tombstone (see below) |
| Roll re-created after its delete | Roll wins, tombstone retired |
| Same id twice in one list | Re-keyed, never collapsed (see below) |

Local list order is preserved and remote-only rolls are appended. **Order is
deliberately not part of the convergence contract** — if it were, two devices
would push reordered blobs at each other forever.

**`markRollAsUsed` deliberately does not move the revision.** `lastUsed` is
display/sort metadata, not an edit. If rolling a saved roll bumped `updatedAt`,
merely *using* a roll on one device would beat a rename made later on another —
and could out-rank the roll's own tombstone and bring a deleted roll back.

**Duplicate ids are re-keyed, not collapsed.** Keying a list that repeats an id
would silently drop a roll, and it is reachable: `duplicateRoll` mints
`roll-${Date.now()}` at millisecond resolution. The store now avoids minting a
colliding id in the first place, and the merge re-keys any that arrive anyway
(position-derived, so both devices agree), forcing one heal push.

### Tombstones

A union cannot express a delete: the other device's surviving copy just hands the
roll back. So `deleteRoll` records `deletedRolls[id] = Date.now()`, persisted and
synced alongside the rolls.

Tombstones are GC'd so the blob cannot grow without bound, and **both limits are
honestly lossy**:

- **90-day TTL.** A device that has been offline longer than this re-supplies the
  rolls whose tombstones aged out, and they come back. The TTL is the limit of
  how long a delete is *guaranteed* to stick.
- **200-entry cap.** Past 200 deletes the **oldest tombstones are evicted
  regardless of age**, so the guarantee can lapse much sooner than 90 days for a
  delete-heavy account. Deleting >200 rolls between two syncs of the same device
  is the pathological case this trades against unbounded blob growth.

### Blob versioning

`saved_rolls` blobs are `v2`: `{ v, savedRolls, deletedRolls }`. v2 is purely
additive, so a v1 client still finds `savedRolls` where it expects it and
degrades to the old whole-blob behavior rather than breaking — at the cost of
dropping tombstones when it pushes, which can resurrect a roll once. A v1 blob
read by a current client is rewritten at v2 on sign-in.

### Cache ownership (`dicesuki-sync-meta`)

Sign-out intentionally leaves the local cache in place so a guest keeps playing
with the rolls already on screen. That makes the browser a shared space, so the
meta record is namespaced by user id and also records an `owner` — which account
the local stores currently reflect (`null` = never-signed-in guest):

- **owner is `null` (guest)** → local rolls are merged up. This is the
  `localStorage -> account` migration, and it now works on a *second* device too:
  previously the "push local up" path only fired when no remote row existed, so a
  guest signing into an established account had their work replaced.
- **owner is this user** → merged (own offline edits survive).
- **owner is a different user** → the foreign cache is dropped (every target's
  `resetLocal`, including inventory and settings — guest dice, currency and the
  selected theme survive sign-out too) and the remote row replaces it. If the
  incoming account has no row yet, the local data is dropped rather than
  published. Accepted cost: guest rolls built *after* someone else signed out on
  this browser are not carried into a different account. Leaking one player's
  rolls into another player's account is the worse failure.

**Ownership is claimed before the hydrate, not after it.** A hydrate is one
network round trip per domain, and anything that cuts it short — signing out
mid-flight, closing the tab, a PWA being backgrounded — used to leave `owner`
unset while the cache already held the signed-in user's data. The next account
then read it as a guest cache, merged it, and published it. So the foreign reset
runs synchronously across every target and `owner` is written *before* the first
`await`: a half-hydrated cache is genuinely this user's, because everything
foreign was already cleared. `applyPayload` clears `currentlyEditing` for the
same reason — a wholesale replace means the in-progress edit belongs to the state
being discarded.

A pre-namespacing (flat) meta blob is discarded on read rather than adopted — its
stamps cannot be attributed to an account, and guessing wrong is the
cross-account clobber the shape exists to prevent.

### Timestamps

Row-level stamps used for LWW are **server**-sourced (`updated_at`, returned by
the upsert's `.select('updated_at')`; set by the column default on insert and by
`set_updated_at` on update), so they are comparable across devices.

Per-roll `updatedAt` is necessarily a **client** clock — the server stamps the
row, not the rolls inside it — so a badly skewed device can win a same-roll
conflict it should lose. That only matters when the same roll was edited on two
devices between syncs; rolls only one side touched merge by id and never consult
a clock.

### Dangling die references are handled at roll time, not sync time

A roll can pin a specific die (`{ kind: 'specific', dieId }`). Server dice copies
(`dice_copies` uuids) are stable across devices, but **device-local ids are not**,
so a roll pinned to a guest/local die syncs to another device dangling.

This is deliberately *not* normalized at sync time. Execution already degrades
correctly — `addDie` substitutes a basic die and `savedRollExecution` reports it
("…is no longer in your collection, so a basic die was rolled") — and sync-time
rewriting would be actively wrong: server copies are ephemeral and absent until
the `dice_copies` read lands, so a "is this die in inventory right now?" sweep
during hydration would wipe references to dice the player genuinely owns. That is
why `pruneSavedRollsForRemovedDice` is keyed on the specific ids a migration
removed rather than on the current inventory.

## Common Issues

### Issue: Bonuses Not Displaying
**Symptom**: Roll shows dice sum only, no flat bonus
**Diagnosis**: `activeSavedRoll` is null or cleared
**Check**:
- Did a clear/spawn/roll phase show an inline room error?
- Did the user manually add another die, which intentionally clears the saved-roll context?
- Do the settled result IDs match the acknowledged room IDs stored in `perDieBonuses`?

### Issue: Bonuses Persist After Manual Changes
**Symptom**: Bonuses still showing after adding/removing dice
**Solution**: Ensure manual room-backend dice additions clear `activeSavedRoll`.

### Issue: Saved Roll Does Not Start
**Symptom**: The panel stays open and no roll begins
**Diagnosis**: The room rejected an action or an expected acknowledgement timed out
**Check**:
- The inline alert contains the server failure or timeout
- Specific owned dice still exist in inventory and are not already pending
- The room is connected

## Testing Considerations

When testing saved rolls:
1. Verify bonuses display correctly on first roll
2. Test clear → spawn N → roll ordering through a mocked backend
3. Deliver `dice_spawned` acknowledgements out of order and include an unrelated owner's die; bonuses must still reconcile to exact request IDs
4. Verify spawn and roll failures render inline and prevent false success
5. Test manual add/remove behavior clears bonuses
6. Test formula formatting with positive and negative bonuses
7. Extend the wasm-room browser smoke whenever the execution protocol changes
8. For percentile rolls, cover all three ways the pairing must survive: a table
   edit that clears `activeSavedRoll`, a **remote** player's `roll_complete` with
   no local roll state, and `00 + 0` reading 100 rather than 0
9. Wave orchestration is unit-tested against a fake room with scripted faces
   (`src/lib/savedRollExecution.test.ts`) — real dice are random, so browser
   coverage (`e2e/roll-advanced.spec.ts`, `npm run test:e2e:roll-advanced`)
   asserts relationships that hold for every outcome (the kept d20 is the
   higher of the two) rather than fixed numbers
