# Retired Customer Dice Uploads and Legacy Local Dice

> Part of the [Harness documentation system](../../CLAUDE.md). This is the
> current product boundary; completed plans and the changelog intentionally
> retain their historical upload details.

## Product boundary

Customers cannot upload dice models. The former Artist Testing Platform and its
client-side metadata authoring tools were retired when Dicesuki moved to a
controlled shop/catalog model.

New dice are authored and promoted by operators through the
[Dice Set Authoring](dice-set-authoring.md) pipeline, then released as immutable
catalog assets following the [Collectible Catalog](collectible-catalog.md)
workflow. Runtime GLB paths are versioned catalog delivery paths, never
customer-supplied URLs.

## Retained compatibility path

Do not remove the following merely because Settings has no upload entry point:

1. `src/lib/customDiceDB.ts` retains GLB bytes stored by the retired upload
   flow on a customer's device.
2. `useInventoryStore.regenerateCustomDiceBlobUrls()` recreates session-scoped
   blob URLs for retained legacy inventory records at application startup.
3. `src/hooks/useCustomDiceLoader.ts` renders both those legacy records and
   operator-promoted bundled catalog GLBs through the shared `CustomDiceAsset`
   contract.
4. The `custom-artist` set remains a local compatibility identity only. It is
   neither a catalog item nor entitlement evidence.

This is a read-and-render compatibility commitment, not a way to create new
local assets. Existing devices can still use already-stored dice; a legacy
record whose IndexedDB bytes are missing remains unavailable and is surfaced by
`customDiceLoadErrors`.

## Data and sync caveat

Legacy GLB binaries stay device-local in IndexedDB. Inventory metadata may sync
with the existing inventory blob, but the binary model does not; therefore a
legacy local die may be usable on its original device and unavailable on another
device. This behavior predates upload retirement and is intentionally preserved
to avoid invalidating local data.

## Verification when changing adjacent code

For a change touching inventory migration, catalog asset loading, or this
compatibility path:

1. Run the targeted inventory and catalog tests.
2. Confirm bundled catalog assets still resolve through
   `getBundledCustomDiceAsset()` and `useCustomDiceLoader()`.
3. Confirm `regenerateCustomDiceBlobUrls()` remains safe when no legacy dice or
   no IndexedDB bytes are present.
4. Run `npm test` and `npm run build` before merge.
