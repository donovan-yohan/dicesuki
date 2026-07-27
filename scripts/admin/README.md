# Dicesuki admin / support CLI

Operator tooling for the production Supabase project: look a player up, grant or
correct currency, grant a die, read the ledgers, inspect payments, and diagnose a
stuck pull session.

Every mutation goes through a trusted `SECURITY DEFINER` RPC. **This tool never
writes a table directly** — it cannot, because no API role holds DML on the
economy tables (see [Why RPCs, not tables](#why-rpcs-not-tables)).

```
node scripts/admin/dicesuki-admin.mjs <command> [options]
npm run admin -- <command> [options]
```

---

## Setup

### 1. Get the service-role key

Supabase dashboard → your project → **Project Settings → API Keys → `service_role`**
(labelled "secret" / "This key has the ability to bypass Row Level Security").

The service-role key is a **secret**. Per Shared-ADR-006 it must never be
committed, must never appear in `.env.example`, and must never be pasted into a
client-side `VITE_*` variable. The CLI redacts it from every line it prints, but
that is a backstop, not permission to be careless.

### 2. Export it for the shell session only

```bash
export SUPABASE_URL='https://nksxdfcjabgbxeefwkdc.supabase.co'
read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY
```

`read -rs` keeps the key out of your shell history. Alternatively keep it in an
untracked `.env.admin.local` and `set -a; . ./.env.admin.local; set +a`.

Accepted variable names (first present wins):

| Purpose | Variables |
|---|---|
| Project URL | `SUPABASE_URL`, then `VITE_SUPABASE_URL` |
| Service-role key | `SUPABASE_SERVICE_ROLE_KEY`, then `SUPABASE_SECRET_KEY` |

The CLI refuses to start without both, and refuses a non-`https` URL unless it
points at `localhost`/`127.0.0.1`.

### 3. Verify

```bash
node scripts/admin/dicesuki-admin.mjs --help
node scripts/admin/dicesuki-admin.mjs user someone@example.com
```

The first line of output names the project and which env var the key came from
(never the key itself).

---

## Safety model

| Rule | Behaviour |
|---|---|
| Audit trail is mandatory | Every `grant-*` requires `--operator <name>` and `--note <why>`; both land in the row's `provenance` alongside `source: "admin-grant"`. |
| Nothing fires silently | Every mutating command prints the resolved target, the full RPC name, the provenance, and the exact SQL **before** doing anything. |
| Interactive confirm | Mutations prompt `Type "yes" to continue:` unless `--yes` is passed. A non-TTY stdin without `--yes` is refused, not auto-approved. |
| Dry-run by default where it matters | `grant-die` and `cancel-session` are `--dry-run` by default; they need `--no-dry-run` to act. Both write append-only rows that can never be corrected. |
| Idempotent by construction | Keys are auto-derived as `admin-grant:<YYYY-MM-DD>:<slug>`. Re-running with the same `--key` and the same `--operator`/`--note` replays safely and returns the original row. |
| The database is the arbiter | The CLI never pre-computes a balance. Floors, holds, overflow, and idempotency drift are all decided server-side. |
| No paid-Stars path | `grant-stars` only ever touches `stars`/`promotional`. The `paid` bucket is purchase-backed; refunds go through `refund_payment_order`, never a manual append. |

### Why provenance carries no timestamp

Both ledger RPCs treat an idempotency replay as a **drift error** unless *every*
argument — including `provenance` — is byte-identical
(`supabase/migrations/0028_sku_fulfillment.sql:508-521`,
`0014_roll_ticket_ledger.sql:173-183`). A wall-clock value inside `provenance`
would turn a safe `--key` retry into a `22023`. The date already lives in the
idempotency key, and `created_at` is written by the database.

### Reason codes

Support writes use a dedicated `support.manual.*` namespace:

| Command | Positive delta | Negative delta |
|---|---|---|
| `grant-stars` | `support.manual.stars.credit` | `support.manual.stars.debit` |
| `grant-dust` | `support.manual.dust.credit` | `support.manual.dust.debit` |
| `grant-tickets` | `support.manual.<roll_type>.credit` | `support.manual.<roll_type>.debit` |

There is no reason-code enum or lookup table — only a format check
(3-128 chars, `^[a-z][a-z0-9_.:-]+$`, `0009_earned_economy_ledger.sql:116-120`).
Reusing an automated code would be accepted by the database and would corrupt
the reconciliations built on top of it (e.g. `purchase.refund` is gated on a
matching refund intent at `0028_sku_fulfillment.sql:454-478`;
`dice.scrap.dust.credit` is re-derived at `0022_scrap_craft_economy.sql:335`).
`--reason-code` can override the default, but stay inside `support.*`.

---

## Commands

### `user <query>`

Find a player by email, Discord display name, or auth uuid, and print
everything support usually needs in one screen: identity, wallet balances, roll
tickets, dice-copy counts, both ledger tails, and any live pull hold.

```bash
node scripts/admin/dicesuki-admin.mjs user someone@example.com
node scripts/admin/dicesuki-admin.mjs user 'Ada' --limit 25
node scripts/admin/dicesuki-admin.mjs user 3f4a2b10-... --json
```

If the query matches more than one player the CLI lists the candidates and exits
rather than guessing — re-run with the uuid.

> Identity comes from the GoTrue admin API, not from Postgres. `auth.users` is
> not reachable over PostgREST (no view or accessor function exists in
> `supabase/migrations/`) and `public.profiles` has no email column
> (`0001_profiles.sql:15-23`). The display name comes from `public.profiles`, and
> the two halves are merged on `id`.

### `grant-stars <user> <amount>`

Credit or correct **promotional** Stars via
`public.append_wallet_ledger_entry` (`0028_sku_fulfillment.sql:401-417`).

```bash
node scripts/admin/dicesuki-admin.mjs grant-stars someone@example.com 20000 \
  --operator donovan --note 'ticket 1284: launch goodwill'
```

Prints the plan, prompts, then executes:

```
Planned call
============
  command: grant-stars
  rpc:     public.append_wallet_ledger_entry
  effect:  credit
  summary: Credit 20000 Stars (stars/promotional) to 3f4a...

  provenance: {"source":"admin-grant","tool":"scripts/admin/dicesuki-admin.mjs",
               "command":"grant-stars","operator":"donovan","note":"ticket 1284: launch goodwill"}

select * from public.append_wallet_ledger_entry(
  p_user_id => '3f4a...'::uuid,
  p_currency_id => 'stars'::text,
  p_balance_bucket => 'promotional'::text,
  p_delta_amount => 20000::bigint,
  p_reason_code => 'support.manual.stars.credit'::text,
  p_idempotency_key => 'admin-grant:2026-07-27:0a1b2c3d'::text,
  p_economy_edition_id => 'earned-collection@1'::text,
  p_provenance => '{"source":"admin-grant",...}'::jsonb
);
```

Corrections use a negative amount:

```bash
node scripts/admin/dicesuki-admin.mjs grant-stars someone@example.com -5000 \
  --operator donovan --note 'ticket 1284: reversing duplicate grant'
```

The RPC enforces both floors: the balance may not go below zero, **and** it may
not dip below what a live pull hold has reserved
(`0028_sku_fulfillment.sql:536-566`). Either raises `22003`.

### `grant-dust <user> <amount>`

Same RPC, pinned to `dust`/`earned`.

```bash
node scripts/admin/dicesuki-admin.mjs grant-dust someone@example.com 250 \
  --operator donovan --note 'ticket 1291: scrap credited twice, restoring'
```

### `grant-tickets <user> <amount>`

Roll tickets via `public.record_roll_ticket_ledger_entry`
(`0014_roll_ticket_ledger.sql:110-121`). Defaults to `standard_roll`.

```bash
node scripts/admin/dicesuki-admin.mjs grant-tickets someone@example.com 3 \
  --operator donovan --note 'ticket 1305: pull lost to a network drop'

node scripts/admin/dicesuki-admin.mjs grant-tickets someone@example.com 1 \
  --roll-type premium_roll --operator donovan --note 'ticket 1305: premium comp'
```

### `grant-die <user> <catalog_item_id>`

Mint one live copy of a specific die. **Dry-run by default.**

```bash
# 1. see the plan (no writes)
node scripts/admin/dicesuki-admin.mjs grant-die someone@example.com \
  'adventurer-starter/d20/common@1' --operator donovan --note 'ticket 1312: lost on rollback'

# 2. apply it
node scripts/admin/dicesuki-admin.mjs grant-die someone@example.com \
  'adventurer-starter/d20/common@1' --operator donovan --note 'ticket 1312: lost on rollback' \
  --no-dry-run
```

The CLI validates the catalog item first (exists, `item_kind = 'die'`, has at
least one asset version) and warns if a pull hold is live before it tries.

### `ledger <user> [--limit N]`

Wallet and roll-ticket ledger tails, newest first.

```bash
node scripts/admin/dicesuki-admin.mjs ledger someone@example.com --limit 25
```

### `orders <user> [--limit N]`

Payment orders plus their Xsolla events, joined on `payment_events.order_id`
(`0013_paid_checkout_foundation.sql:123`).

```bash
node scripts/admin/dicesuki-admin.mjs orders someone@example.com --limit 20 --json
```

### `cancel-session <user>`

Inspect pull sessions and, with `--confirm`, print the manual cancellation SQL.
See [Stuck pull session](#stuck-pull-session).

```bash
node scripts/admin/dicesuki-admin.mjs cancel-session someone@example.com
node scripts/admin/dicesuki-admin.mjs cancel-session someone@example.com --confirm \
  --operator donovan --note 'ticket 1330: hold stuck after a crash'
```

`--operator` / `--note` are optional here (inspection writes nothing); when
`--confirm` renders the manual SQL they are stamped into its `provenance`.

### Global options

| Option | Meaning |
|---|---|
| `--json` | machine-readable output on stdout (human text suppressed; warnings still go to stderr) |
| `--yes` | skip the interactive confirmation — **required** with `--json` for a real mutation |
| `--dry-run` / `--no-dry-run` | force dry-run on/off (mutating commands only) |
| `--key <k>` | override the auto-derived idempotency key (8-200 chars) |
| `--reason-code <c>` | override the default `support.manual.*` reason code |
| `--limit <n>` | tail size for read commands (1-200, default 10) |
| `--help` | usage, optionally for one command |

Exit codes: `0` success, `1` operation failed, `2` usage or environment error.

### Error codes you will see

| SQLSTATE | Meaning | Fix |
|---|---|---|
| `55000` | A prepared pull hold is live; grants are paused (`0021_pull_copy_grant_rework.sql:968-981`) | Run `cancel-session` to see `expires_at`, wait, retry with the **same** `--key` |
| `22023` | An argument was rejected, or this key was already used with different arguments (`0028_sku_fulfillment.sql:508-521`) | Re-send byte-identical `--operator`/`--note`, or use a fresh `--key` |
| `22003` | Balance floor or overflow (`0028_sku_fulfillment.sql:536-566`) | Reduce the debit, or wait out the pull hold reserving the funds |
| `23503` | Unknown economy edition or catalog item | Check the id |
| `42501` | Permission denied | The key in use is not a service-role key |

---

## Die-grant design note

**A support die grant writes exactly one row: a `public.dice_copies` row, via
`public.record_dice_copy_grant(...)` with `p_source_kind = 'reward'`. Nothing
else — in particular, not `user_entitlements`.**

Why:

1. **`dice_copies` is the authoritative inventory surface.** The client reads it
   directly at `src/lib/diceCopies.ts:66-69` (`select id, catalog_item_id,
   grant_idempotency_key, source_kind, acquired_at, is_first_copy, scrapped_at`,
   scoped by the RLS SELECT policy at
   `supabase/migrations/0020_dice_copy_inventory.sql:374-378`), filters live
   copies on `scrapped_at === null` (`src/lib/diceCopies.ts:114-123`), and hands
   the result to `useInventoryStore.syncServerCopies` (`src/lib/dataSync.ts:335-338`).
2. **`user_entitlements` is a dead compatibility surface.** `dataSync` fetches it
   at `src/lib/dataSync.ts:319` and explicitly discards the result at
   `src/lib/dataSync.ts:329` (`void entitlementsResult`), with the comment at
   `:312-315` naming `dice_copies` as authoritative. Granting an entitlement
   would not make a die appear. It is also impossible: `service_role`'s INSERT
   and UPDATE on the table were revoked in
   `0010_earned_reward_claims.sql:28-30`.
3. **`record_dice_copy_grant` is the only service-role-callable mint path.**
   Signature at `0020_dice_copy_inventory.sql:125-136`, granted to `service_role`
   only at `:385-390`. It validates the catalog item is a die (`:146-154`),
   validates `source_kind` (`:155-159`), computes `is_first_copy` server-side
   (`:210-216`), and is replay-safe on `(user_id, grant_idempotency_key)`
   (`:21-22`, `:182-197`).
   The alternatives do not work for support:
   - `public.craft_dice_copy` is `authenticated`-only, self-scoped, and requires
     an existing live copy (`0022_scrap_craft_economy.sql:657-666, 711-738`);
   - `private.commit_pull_session_for_user` is not `SECURITY DEFINER` and is
     revoked from every role (`0021_pull_copy_grant_rework.sql:727-734, 943-944`);
   - `public.fulfill_payment_order` needs a real `payment_orders` row, writes
     `user_entitlements` rather than `dice_copies`, and raises `55000` for
     registry-die SKUs (`0028_sku_fulfillment.sql:923-951`).
4. **`source_kind = 'reward'`** is the honest label from the allowed set
   `('pull','craft','purchase','reward')` (`0020_dice_copy_inventory.sql:11-13`).
   Using `pull` or `purchase` would corrupt acquisition analytics.
5. **`source_reference`** is set to `admin-grant:<operator>:<note>` (1-512 chars,
   `0020_dice_copy_inventory.sql:23-24`) so a copy can be explained without
   joining anything.

Two failure modes to know:

- **`55000` while a pull hold is live.** The trigger
  `dice_copies_preserve_pull_snapshot` (`0021_pull_copy_grant_rework.sql:993-995`,
  function at `:949-985`) raises `'Collectible grants are paused while a prepared
  pull hold is active'` for any grant while the player holds a prepared,
  unexpired, untransitioned pull session. **Wait for `expires_at` and retry with
  the same `--key`.**
- **A die with no asset version will not render.** `fetchCatalogSnapshot` drops
  catalog items that have no `catalog_asset_versions` row
  (`src/lib/collectibleCatalog.ts:259-260`). The grant would succeed and the die
  would still be invisible, so the CLI warns before executing.

### Why RPCs, not tables

`force row level security` is set on every economy table, and although
`service_role` carries `BYPASSRLS` in Supabase, the **grants** are the real gate.
`service_role` holds `SELECT` only:

| Table | service_role |
|---|---|
| `wallet_balances`, `wallet_ledger_entries` | SELECT (`0009_earned_economy_ledger.sql:656-657`) |
| `roll_ticket_balances`, `roll_ticket_ledger_entries` | SELECT (`0014_roll_ticket_ledger.sql:267-268`) |
| `dice_copies` | SELECT (`0020_dice_copy_inventory.sql:382`) — **no INSERT for any role** |
| `pull_sessions` | SELECT (`0011_earned_pull_preparation.sql:1588`) |
| `pull_session_transitions` | SELECT (`0017_pull_commit_reveal.sql:55`) |
| `payment_orders` / `payment_events` | SELECT (`0013_paid_checkout_foundation.sql:564-565`) |
| `profiles` | SELECT + DML (`0005_security_hardening.sql:37`) |

`supabase/tests/0030_admin_support_cli.test.mjs` asserts this boundary against a
real Postgres instance, so a migration that widens it fails CI.

---

## Support runbook

### Refund / chargeback lookup

1. **Find the player and the order.**
   ```bash
   node scripts/admin/dicesuki-admin.mjs orders someone@example.com --limit 20
   ```
   Order `status` is one of `pending | paid | fulfilled | canceled | refunded`
   (`0013_paid_checkout_foundation.sql:50-51`). `dry_run = yes` means the Xsolla
   sandbox, not real money.
2. **Read the event trail.** The `Payment events` table lists every Xsolla
   notification for those orders: `payment | order_paid | refund | chargeback`
   (`0013_paid_checkout_foundation.sql:125-126`), deduplicated by
   `(xsolla_transaction_id, event_type)` (`:131`). If a `refund` or `chargeback`
   event exists but `status` is still `fulfilled`, the webhook did not complete —
   escalate; do **not** hand-correct the wallet.
3. **Confirm the money movement.**
   ```bash
   node scripts/admin/dicesuki-admin.mjs ledger someone@example.com --limit 25
   ```
   A fulfilled Star bundle appears as `purchase.star_bundle` into
   `stars`/**`paid`** (`0028_sku_fulfillment.sql:782`); a completed refund appears
   as `purchase.refund` out of `stars`/`paid` (`:1214`).
4. **Do not reverse a purchase by hand.** `append_wallet_ledger_entry` rejects any
   negative on `stars`/`paid` whose reason code is not exactly `purchase.refund`
   **and** whose idempotency key is not `star-bundle-refund:<orderId>` matching a
   real refund intent (`0028_sku_fulfillment.sql:443-478`). The only correct path
   is `public.refund_payment_order`, driven by the Xsolla webhook. This CLI
   deliberately exposes no command for it.
5. **Goodwill compensation** (as opposed to a refund) is a promotional-Stars
   grant, which is fully in scope:
   ```bash
   node scripts/admin/dicesuki-admin.mjs grant-stars someone@example.com 1600 \
     --operator donovan --note 'ticket 1420: goodwill for delayed refund txn 928000123'
   ```
   Put the Xsolla transaction id in the note — it becomes permanent provenance.

### Stuck pull session

A pull hold is **live** when `prepared_at <= now < expires_at` and no row exists
in `pull_session_transitions` for it — the same predicate the wallet RPC uses to
compute reserved funds (`0028_sku_fulfillment.sql:547-561`). While it is live the
player's Stars are reserved and **all collectible grants raise `55000`**.

1. **Look.**
   ```bash
   node scripts/admin/dicesuki-admin.mjs cancel-session someone@example.com
   ```
   The output shows every recent session with its transition (`committed`,
   `cancelled`, or `none`) and, for a live hold, `expires in Ns`.
2. **Prefer waiting.** `hold_ttl_seconds` is 30-600
   (`0011_earned_pull_preparation.sql:188`) and `expires_at = prepared_at +
   hold_ttl_seconds` exactly (`:230-231`). A live hold self-clears with **no write
   at all**. In almost every ticket this is the right answer: wait, then retry the
   grant with the same `--key`.
3. **Or ask the player to retry in-app.** `public.cancel_pull_session(uuid)` is
   granted to `authenticated` and self-scoped, so the player's own client can
   release it.
4. **Manual cancellation is a last resort and cannot run from this CLI.**
   ```bash
   node scripts/admin/dicesuki-admin.mjs cancel-session someone@example.com --confirm
   ```
   prints the exact `insert into public.pull_session_transitions (...) values
   (..., 'cancelled', ...)` statement, then refuses to run it. There is no
   service-role path:
   - `public.cancel_pull_session(uuid)` is `SECURITY DEFINER` but revoked from
     `service_role` and takes no user argument — it reads `auth.uid()`
     (`0017_pull_commit_reveal.sql:1063-1090`);
   - `private.cancel_pull_session_for_user(uuid, uuid)` is not `SECURITY DEFINER`
     and is revoked from every role (`0017_pull_commit_reveal.sql:931-938,
     1024-1025`);
   - `service_role` holds `SELECT` only on `pull_session_transitions`
     (`0017_pull_commit_reveal.sql:53-58`).

   Run the printed statement from the Supabase dashboard SQL editor (a Postgres
   owner connection). **It is append-only and can never be corrected**
   (`0017_pull_commit_reveal.sql:36-42`), one transition per session
   (`:19`), and cancellation releases the reservation **without a refund**
   (`:1015-1016`) — so if the player also deserves their Stars back, follow it
   with an explicit `grant-stars`.

### Lost items / rollback compensation

1. `user <query>` to confirm what they actually own now.
2. `grant-die` (dry-run first) for a specific die, or `grant-stars` /
   `grant-tickets` if the fair remedy is another pull rather than a specific item.
3. Always reference the ticket id in `--note` — it is the only durable link
   between a support conversation and a ledger row.

---

## Development

```bash
npx vitest run scripts/admin/admin-cli.test.ts   # pure logic: parsing, keys, provenance, plans
npm run test:db:supabase                         # live proof against a real Postgres + all migrations
```

`supabase/tests/0030_admin_support_cli.test.mjs` imports the **same** plan
builders the CLI uses and replays the SQL that `--dry-run` prints through
`set role service_role`. If a future migration changes an argument name, a value
domain, or a grant, that suite fails — the dry-run preview and the real call can
never drift apart.

Layout:

| File | Role |
|---|---|
| `dicesuki-admin.mjs` | entrypoint: argv, env, IO, prompting, redaction, exit codes |
| `lib/args.mjs` | pure: command table, flag parsing, dry-run defaults |
| `lib/plans.mjs` | pure: validation, provenance, idempotency keys, RPC call plans, SQL rendering |
| `lib/supabase.mjs` | env resolution, service client, GoTrue admin search, secret redaction |
| `lib/queries.mjs` | read surfaces |
| `lib/commands.mjs` | command orchestration and SQLSTATE guidance |
| `lib/report.mjs` | pure: table/key-value formatting |

`lib/supabase.mjs` explains why the tool uses `@supabase/supabase-js` (already a
repo dependency, mirrors `supabase/functions/_shared/supabaseClient.ts`, surfaces
the Postgres SQLSTATE in `error.code`) with one raw `fetch` to
`GET /auth/v1/admin/users?filter=` — `@supabase/auth-js`'s `admin.listUsers()`
accepts only `{ page, perPage }`, so searching by email through the client
library would mean paging the whole user table.
