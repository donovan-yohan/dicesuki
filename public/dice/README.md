# Production Dice Assets

This directory contains operator-controlled runtime assets for Dicesuki's
catalog and shop. It is not a customer upload surface.

New dice are authored through the controlled
[Dice Set Authoring guide](../../docs/guides/dice-set-authoring.md), promoted
through an append-only catalog edition, and delivered from immutable versioned
GLB paths. Do not add an unreviewed model directly to this directory or replace
bytes at a published path.

Verify changes with `npm run check:runtime-dice-assets`,
`npm run check:collectible-catalog`, and the catalog-edition workflow before
release.

Legacy device-local dice use IndexedDB compatibility code elsewhere in the app;
they are not production assets and must not be copied into this directory.
