# Dicesuki Context Map

Use this map to find the authoritative source and its executable backpressure.
Detailed operating notes live in the linked guides and ADRs.

| Domain | Authoritative source | Derived/runtime surface | Harness and delivery path |
|--------|----------------------|-------------------------|---------------------------|
| Collectible identity and assets | `src/config/collectibleCatalogSource.json`, production sidecars, `supabase/catalog/editions/` | `src/generated/collectibleCatalog.json`, Supabase catalog tables | `scripts/generate-collectible-catalog.js`, `scripts/check-immutable-catalog-history.js`, `docs/guides/collectible-catalog.md` |
| Economy hypotheses | `economy/contracts/editions/` | Immutable machine disclosures in `economy/disclosures/`; no production consumer | `scripts/generate-economy-disclosures.js`, `scripts/check-immutable-economy-history.js`, `docs/guides/economy-contracts.md` |
| Entitlement authority | `supabase/migrations/0004_collectible_catalog.sql` | `src/lib/dataSync.ts`, local inventory projection | Migration/static tests and hosted role/RLS proof in `docs/guides/collectible-catalog.md` |
| Local inventory and gameplay | `src/store/useInventoryStore.ts`, `src/lib/diceSpawner.ts` | React/R3F solo experience | Co-located Vitest tests, `npm test`, `npm run build` |
| Multiplayer physics and protocol | `server/core/`, `server/src/` | Native Axum server and WASM room worker | Rust tests, WASM build, Playwright solo smoke; see multiplayer ADRs |
| CI and release gates | `package.json`, `.github/workflows/ci.yml` | Pull-request and `main` checks | Immutable-history checks, generated-artifact checks, lint, Vitest, build, Rust tests |

## Economy boundary

Economy contracts are frozen analysis inputs, not launch rules. Production code
under `src/`, `server/src/`, `server/core/src/`, and `server/wasm/src/` may not
import contract or disclosure files. A future simulator may consume the
disclosure artifact from test/tooling code; a future production pull service
requires a separate server-authoritative design, security review, and delivery
slice.
