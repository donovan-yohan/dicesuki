# Dicesuki Context Map

Use this map to find the authoritative source and its executable backpressure.
Detailed operating notes live in the linked guides and ADRs.

| Domain | Authoritative source | Derived/runtime surface | Harness and delivery path |
|--------|----------------------|-------------------------|---------------------------|
| Collectible identity and assets | `src/config/collectibleCatalogSource.json`, production sidecars, `supabase/catalog/editions/` | `src/generated/collectibleCatalog.json`, Supabase catalog tables | `scripts/generate-collectible-catalog.js`, `scripts/check-immutable-catalog-history.js`, `docs/guides/collectible-catalog.md` |
| Runtime GLB delivery | Release source lock, production sidecars, `runtime-assets.json` | Bounded `/public/dice/` GLBs and thumbnails; lazy local/remote table rendering | `scripts/runtime-dice-assets/`, `npm run check:runtime-dice-assets`, `docs/guides/runtime-dice-assets.md` |
| Economy hypotheses and studies | `economy/contracts/editions/`, `economy/simulations/scenarios/` | Immutable disclosures and fixed-seed reports under `economy/disclosures/` and `economy/simulations/reports/`; no production consumer | `scripts/generate-economy-disclosures.js`, `scripts/economy-simulator.js`, `scripts/check-immutable-economy-history.js`, `docs/guides/economy-contracts.md` |
| Production earned economy and wallet | `economy/production/editions/`, `supabase/migrations/0009_earned_economy_ledger.sql` | Public immutable edition reads; authenticated own-wallet reads; service-role-only ledger appends | `scripts/validate-production-economy.js`, `scripts/test-supabase-postgres.mjs`, `supabase/tests/0009_earned_economy_ledger.test.*`, `docs/adrs/shared/014-earned-economy-ledger-foundation.md` |
| Authoritative earned rewards | `supabase/migrations/0010_earned_reward_claims.sql`, `server/core/src/player.rs`, `server/core/src/room.rs`, `server/src/roll_reporting.rs` | Native authenticated explicit-roll generations feed a bounded privileged RPC reporter; local WASM/guests have no write path; authenticated non-anonymous status/passport/community RPCs retain immutable outcomes | Core/reporter Rust tests, `supabase/migrations/0010_earned_reward_claims.test.ts`, `supabase/tests/0010_earned_reward_claims.test.*`, `src/lib/earnedEconomy.ts`, ADRs 014–015, `docs/guides/deployment.md` |
| Sealed earned pull preparation | `supabase/migrations/0011_earned_pull_preparation.sql` | Authenticated non-anonymous RPC locks the account, resolves an immutable count/price offer, creates one promotional-Star hold, and seals authoritative results; clients receive only a result-free receipt | `supabase/migrations/0011_earned_pull_preparation.test.ts`, `supabase/tests/0011_earned_pull_preparation.test.*`, `scripts/test-supabase-postgres.mjs`, ADR 016 |
| Entitlement authority | `supabase/migrations/0004_collectible_catalog.sql` | `src/lib/dataSync.ts`, local inventory projection | Migration/static tests and hosted role/RLS proof in `docs/guides/collectible-catalog.md` |
| Local inventory and gameplay | `src/store/useInventoryStore.ts`, `src/lib/diceSpawner.ts` | React/R3F solo experience | Co-located Vitest tests, `npm test`, `npm run build` |
| Multiplayer physics and protocol | `server/core/`, `server/src/` | Native Axum server and WASM room worker | Rust tests, WASM build, Playwright solo smoke; see multiplayer ADRs |
| CI and release gates | `package.json`, `.github/workflows/ci.yml` | Pull-request and `main` checks | Global immutable/contiguous migration history runs before sorted real-Postgres suites; domain history, generated-artifact, lint, Vitest, build, and Rust gates follow |

## Economy boundary

Economy contracts, scenarios, and reports are frozen analysis inputs, not
launch rules. Production code
under `src/`, `server/src/`, `server/core/src/`, and `server/wasm/src/` may not
import them or the simulator. A future production pull service requires a
separate server-authoritative design, security review, and delivery slice.

The selected launch rules are copied into a separately validated immutable
production edition. Production validation never imports simulator code. Wallet
entries are currency history only; they do not create, revoke, or replace the
source-specific entitlement-grant history required by future commerce work.

Migration `0010` is the earned-only collectible-grant boundary. It expands the
already-immutable reward pools from `earned-collection@1` into normalized
version/item rows, never another JSON snapshot. An account-first lock
serializes every roll credit and claim. Only trusted room-server completion
events can mint promotional Stars; local WASM solo has no callable path.
Claim outcomes link to exactly one immutable wallet-ledger row or one
`user_entitlements` row, while caller-controlled item, amount, user, and claim
index inputs do not exist.

The native room server is the first producer for the authoritative-roll RPC.
One accepted explicit roll freezes its auth identity, dice set, and monotonic
generation; completion is consumed once. `server/src/roll_reporting.rs` hashes
presentation-free canonical v1 results and applies bounded in-process
at-least-once delivery. PostgreSQL supplies exactly-once application for exact
replays. Process-restart zero loss is not claimed; ADR 015 requires a persistent
outbox before making that guarantee.

Migration `0011` is the append-only sealed preparation boundary. It normalizes
the frozen banner, count/price offers, tiers, items, duplicate-Dust rules,
guarantees, and hold-policy versions instead of rewriting edition JSON or
catalog snapshots. One account-first transaction captures current time after
serialization, reserves available promotional Stars, derives ordered results
from a CSPRNG seed, persists sealed commitments, and returns a result-free
receipt. Grant writers share the account lock, and any nonduplicate
selected-featured award resets selected pity. The 120-second hold TTL is a
versioned migration policy, not an edition-derived rule. Preparation does not
debit, grant, reveal, or advance durable guarantee state; those terminal
transitions require a later append-only commit/reveal migration and narrowly
trusted guard changes.
