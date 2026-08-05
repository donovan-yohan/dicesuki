# Slice 13 — Client economy data layer (frontend slice 1, [free])

## Context
Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets,
branch `econ/13-client-economy-data` (off main, migrations 0014–0024 merged).
TypeScript/React data layer ONLY — no UI components, no screens.

Read FIRST: src/lib/paymentsOrders.ts + src/hooks/useCheckoutStatus.ts (the
fetch + Realtime `postgres_changes` + polling-backoff + TTL pattern to
clone), src/lib/earnedEconomy.ts (RPC conventions, injected client, strict
validators, typed errors), src/lib/collectibleCatalog.ts
(fetchMyEntitlements/fetchCatalogSnapshot — built, UNWIRED),
src/lib/dataSync.ts (sync orchestration, where ensureStarterEntitlements is
wired at :255), src/store/useInventoryStore.ts (persist v3 + migrate +
partialize; local Currency stub at :260 is localStorage-only — NOT the
server wallet), src/lib/diceSpawner.ts + src/lib/dicePresentation.ts (the
consumer contract that must stay untouched), .claude/rules/architecture.md
Frontend-ADR-002 section (store rules: version+migrate, partialize, new
Map/Set instances, no per-frame Context).

Server surface (RLS-readable by the authenticated owner):
- public.wallet_balances (0009): user_id, currency_id 'stars'|'dust',
  balance_bucket 'promotional'|'earned' (+'paid' domain, inert), amount.
- public.roll_ticket_balances (0014): user_id, roll_type
  'standard_roll'|'premium_roll', current_quantity.
- public.dice_copies (0020): per-copy rows, live = scrapped_at is null,
  is_first_copy latch, catalog_item_id, source_kind, acquired_at.
- public.user_subscriptions (0023, Realtime-published): status, plan_id,
  product_id, date_next_charge, date_end.
- RPC convert_stars_to_standard_roll (0016, self-only wrapper).

## Task
1. **src/lib/walletBalances.ts** (new): typed readers
   `fetchWalletBalances(client?)` → {stars: {promotional, paid?}, dust:
   {earned}} and `fetchRollTicketBalances(client?)` → {standard_roll,
   premium_roll}; `subscribeWalletBalances(userId, onChange, client?)` —
   Realtime watcher cloning the paymentsOrders/useCheckoutStatus pattern
   (initial fetch, postgres_changes on both tables filtered to the user,
   poll backoff, TTL, unsubscribe). Strict row validators + typed errors per
   earnedEconomy conventions. Injected client for tests.
2. **src/lib/diceCopies.ts** (new): `fetchMyDiceCopies(client?)` → live
   copies grouped per catalog_item_id with {liveCount, firstCopyAcquiredAt,
   copies: [{id, sourceKind, acquiredAt, isFirstCopy}]}; include everOwned
   flag derivation. Validators + typed errors.
3. **src/store/useWalletStore.ts** (new, Frontend-ADR-002 compliant): holds
   wallet + ticket balances + subscription snapshot + loading/stale flags;
   NOT persisted (server-authoritative — document why partialize excludes
   everything or skip persist entirely per ADR); actions: refresh, applyRealtime,
   reset-on-signout. Wire subscription status via user_subscriptions
   Realtime (0023) with the product filter for lunar (product_id
   'lunar-pass' constant single-sourced client-side too).
4. **Server-copies-backed inventory:** extend useInventoryStore (bump
   persist version + migrate) with a server-copies slice: action
   `syncServerCopies(copies)` mapping dice_copies → the store's dice list
   shape consumed by diceSpawner/spawnSpecificDie and
   createDicePresentationMetadata — spawner and presentation files must NOT
   change; catalog metadata (name/rarity/colors) joined from
   fetchCatalogSnapshot. Local legacy dice remain (guest mode); server
   copies take precedence when signed in — document the merge rule. Also
   WIRE the existing unwired fetchMyEntitlements/fetchCatalogSnapshot into
   the dataSync sign-in flow alongside the new copies+balances fetch
   (follow how ensureStarterEntitlements is invoked at dataSync.ts:255).
5. **Conversion action:** `convertStarsToStandardRoll(count, client?)` lib
   wrapper for the 0016 RPC (typed receipt, error mapping) + store action
   that optimistically refreshes balances on success. No UI.
6. **Tests** (colocated, injected mock clients, existing patterns):
   walletBalances reader/watcher (mock Realtime channel like
   useCheckoutStatus.test), diceCopies grouping + everOwned/firstCopy
   derivation, useWalletStore actions + signout reset, inventory
   syncServerCopies merge rule + persist migrate (old persisted v3 payload →
   new version), conversion wrapper success/error/insufficient (SQLSTATE →
   typed error mapping), subscription snapshot product filter.

## Boundaries
New files + useInventoryStore.ts + dataSync.ts edits only. Do NOT touch
diceSpawner.ts, dicePresentation.ts, any component/panel/UI file, edge
functions, or migrations. No commits. Run: `npm test -- walletBalances`,
`npm test -- diceCopies`, `npm test -- useWalletStore`,
`npm test -- useInventoryStore`, `npm test -- dataSync`, then `npm test`
full + `npm run build` (typecheck — the store/type changes must compile).
Paste exact result lines.

## Report
`SLICE-13-REPORT.md`: summary, files+lines, merge-rule and persistence
decisions with ADR citations, test output incl. build, risks, provenance
(EXACT model id + effort from runtime config).
