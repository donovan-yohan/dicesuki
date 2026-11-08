# Themed Dice Worlds

## Outcome

Deliver three coordinated worlds through the existing Dicesuki interface:

- **Sunlit Glade · Cel:** sculpted Woodland dice, layered canopy and responsive grass.
- **Cyberpunk CUTLINE:** six distinct graphic dice and the LAST BOWL neon service lane.
- **Monster Dungeon:** motif-based dice, animated eyes, translucent slime and naturally varied candlelit paving.

Classic remains available. Existing HUD/navigation layouts and native room gameplay remain the baseline; this work styles them rather than replacing their interaction model.

## State and authority

Personal interface, shared room environment and personal dice are separate authorities. A host's environment setting does not change another player's interface, loadout or ownership.

Shape-only standard toolbar actions resolve the current personal theme when invoked. They select a trusted bundled presentation pinned to its catalog revision, without fabricating inventory ownership. Previously spawned dice keep their presentation when the theme changes. Explicit inventory/favorite choices and generic saved-roll/percentile paths retain their existing selection behavior.

Selectable themes are Classic, Sunlit Glade Cel, Cyberpunk CUTLINE and Monster Dungeon. Retired theme identifiers resolve compatibly without deleting stored ownership or preference history.

## Solo loadout

Fresh solo play starts with the personal theme's standard D20. A bounded, versioned, account-scoped localStorage record instead restores an existing accepted table, including a deliberately empty table. Only shapes/counts and validated pinned presentations are remembered—not positions, rotations, results, history, recipes or grants.

Restoration uses ordinary room spawn admission and acknowledgements. Persistence arms only after all bootstrap echoes arrive. Scope, socket and inventory-generation fences reject stale continuations.

Owned restoration waits for accepted account-generation copies/catalog hydration, not cached account identity. Failed/offline or deadline-expired reads are unresolved rather than proof of missing ownership. A playable basic stand-in retains its original saved owned descriptor through unrelated edits/reload; late hydration never reskins an already spawned die. Deliberate removal retires that slot.

## Rendering contracts

- All dice retain canonical colliders, face mappings and authoritative results.
- Compact pending/settled/history labels show shapes such as D6, D12 and D20. Full names remain inventory/detail metadata.
- The original eyes D6 asset remains unchanged. The adapter plays 21 nonoverlapping authored idles across six faces and excludes the overlapping generic clip. Reduced motion, independent instances and resource retirement remain supported.
- Night diffuse shading responds to incident light color without a bright artificial floor. Original daytime behavior, authored emission and native gel transmission/IOR are preserved.
- Cyberpunk alone owns the HDR bloom pass. Other worlds retain native rendering. Procedural surface pixels are prepared in a bounded module worker with readable pending/error fallback and cancellation/retirement fencing.
- Dungeon readability comes from actual ambient fill and local warm lights, not emissive dice or an exposure lift. Individually chipped floor slabs vary dimensions, joints, wear and coherent mineral/damp fields; the original textures and physics remain intact.
- Woodland public models use an explicitly declared metadata-only privacy derivation; original authoring bytes are retained separately. Geometry, embedded images, materials and animation payloads must not change during that publication step.

## Verification

The local integration has exercised build/lint, full unit suites, real Chrome/WebGL rendering, native WASM roll settlement, canonical result checks, theme switching, responsive HUD flows and loadout reload/empty-table behavior. Focused independent reviews cover rendering lifecycle repairs, theme spawning, eye/floor changes and the authenticated hydration data-loss repair.

Exact publication-head commands, hosted CI, reviewer findings and screenshots belong in the PR's verification evidence. Historical prototype measurements in the Woodland guides describe their original snapshots, not the current published candidate. A local preview or synthetic authenticated fixture is not production-account or deployment evidence.

## Delivery and remaining qualification

The catalog appends edition `0007-sculpted-worlds.json` and migration `0036_catalog_sculpted_worlds.sql`; existing catalog history remains immutable. These additions do not grant inventory or change banner membership. Production database application requires the existing migration rollout process and separate live proof.

Keep public source-archive publication, sustained physical-phone frame pacing/thermal qualification, full offline execution, real remote two-client acceptance and universal tiny/oblique marking readability distinct from source integration and merge acceptance. Encoded footage, viewport emulation, draw counts and short shared-host timing samples do not establish physical-device performance.

Rollback should revert the frontend feature commit without rewriting immutable catalog editions or migrations. Preserve account-local loadout records; do not discard user data as a rollback mechanism.
