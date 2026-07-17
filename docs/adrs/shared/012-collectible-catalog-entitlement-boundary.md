# ADR 012 - Collectible Catalog and Entitlement Boundary

* Date: 2026/07/17
* Status: Accepted
* Deciders: Donovan, Development Team
* Builds on: [ADR 006 - Supabase Hybrid Backend](006-supabase-hybrid-backend-architecture.md)

## Context

The local-first inventory predates authentication and monetization. Its Supabase
row is one JSON blob that authenticated clients may replace wholesale. It mixes
render configuration, player customization, roll statistics, loadout instance
ids, acquisition labels, and placeholder currency. That remains useful for
offline solo play, but none of those client-authored fields can safely prove a
purchase or valuable collectible grant.

## Decision

Supabase owns three additive, normalized contracts:

* `catalog_items` stores immutable versioned collectible identities. A stable
  `catalog_key` may gain a new contract row, but an existing row is never edited.
* `catalog_asset_versions` stores immutable render-asset snapshots and integrity
  hashes. Replacing bytes requires a new version.
* `user_entitlements` stores one server-authoritative ownership row per user and
  catalog item, with initial-grant provenance and revocation. Entitlements are
  not tray or saved-loadout instances.

Catalog and asset rows are public read-only. A signed-in user may read only their
own entitlements. Normal clients have no direct catalog or entitlement DML. The
only client-callable grant function is the no-argument,
`auth.uid()`-scoped, idempotent fixed starter bundle; it cannot accept an item,
count, user id, or provenance.

Existing and future authenticated users may receive the fixed 8-item starter
ownership set. The 23 starter tray dice remain independent local instances
backed by those 8 catalog items. The backfill never reads `inventory.data`.
Custom/dev dice and any valuable-looking legacy local row remain playable local
content but do not mint an entitlement.

The local inventory remains the runtime source for guest/offline play,
customization, tray instances, multi-die loadouts, saved-roll assignment, and
custom dice. Any later wallet, checkout, gacha, crafting, transfer, or paid grant
must authorize against active server entitlements and must not trust a client
inventory row or catalog reference.

## Consequences

Guest and offline solo behavior does not depend on Supabase, while future
economic operations have a narrow server-owned boundary. Existing synced data is
preserved without laundering it into ownership. Catalog changes become append-
only migrations and asset bytes gain integrity identities.

This slice deliberately does not add paid currency, checkout, randomized pulls,
grant administration, or gameplay entitlement gating. The current repository
has a static Vitest migration guard but no local Supabase/pgTAP harness, so live
role-by-role RLS execution remains a deployment verification step.
