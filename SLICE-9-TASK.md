# Slice 9 — Scrap Dust credit + craft RPC (spec §6.1 deltas 12–13)

## Context
Worktree /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets,
branch `econ/09-scrap-craft` (off main; merged: 0020 copy inventory PR #186,
0021 copy-grant rework PR #187 — copy grants/scraps already blocked during
live pull holds).

Read FIRST: spec §1.6 + §6.1 deltas 12–13 + the scrap/craft PROPOSED value
table with binding inequalities (§ added by the dust-sizing PR #185:
dupe 1/4/10/25, scrap 1/4/10/25, craft 210/220/615/2500, mythic scrap 50,
mythic non-craftable); economy/drafts/monetization/DUST-SIM-REPORT.md rev 2;
migrations 0020 (scrap wrapper is currently MARKER-ONLY, no Dust), 0009
(earned-bucket Dust ledger path), 0004 (catalog rarity), 0021.

## Task
`supabase/migrations/0022_scrap_craft_economy.sql` + colocated static
`.test.ts` + behavioral `supabase/tests/0022_scrap_craft_economy.test.sql`.
Spec wins over this summary.

### Requirements
1. **Value table as DATA:** `dice_economy_values` (or spec's name if it names
   one): one row per rarity tier: scrap_yield, craft_cost (craft_cost NULL =
   non-craftable), versioned/append-only or updatable-by-service per repo
   idiom — the POINT is that PO retuning is a data change, not schema. Seed
   the PROPOSED values (status-comment: PROPOSED/PO-pending, cite the spec
   table + DUST-SIM-REPORT rev 2). Constraints: scrap_yield > 0;
   craft_cost NULL or > scrap_yield (fail-closed floor on the pump).
   Map tier from the catalog's rarity field (read 0004 for the actual
   values incl. the community/mythic rarity).
2. **Scrap credits Dust:** extend the 0020 scrap path (CREATE OR REPLACE the
   wrapper/engine): atomically with the marker, credit the tier's scrap_yield
   to earned-bucket Dust via the canonical 0009 append (idempotency key
   derived from the scrap key, distinct prefix). Existing guards preserved
   (live-hold block, owner-only, once-only). Receipt returns dust credited.
3. **Craft RPC:** self-only wrapper + private engine: requires ≥1 LIVE copy
   of the target die (owned-only per PO — live, not merely ever-owned; cite
   spec), craft_cost non-NULL, sufficient earned Dust; atomically debits Dust
   (canonical append, negative) and grants a copy via
   `record_dice_copy_grant` (acquired_via 'craft'); wallet-first lock; the
   0021 hold-freeze automatically blocks crafting during live holds — assert,
   don't re-implement. Idempotent replay returns original receipt; drift
   fails closed. Mythic (craft_cost NULL) rejected.
4. **No pull-path changes.** Nothing in prepare/commit/seal moves. Dormant
   frontend-wise; pure backend rail.
5. **Behavioral suite:** scrap → marker + exact tier Dust in earned bucket
   (each tier incl. mythic 50); scrap replay once-only; craft happy path
   (Dust down by craft_cost, live count +1, acquired_via craft, is_first_copy
   false); craft with zero live copies rejected; craft of never-owned
   rejected; insufficient Dust rejected; mythic craft rejected; craft during
   live hold blocked (55000, via the 0021 freeze); craft-then-scrap nets
   negative (assert scrap_yield < craft_cost from the LIVE table values);
   RLS on the value table (public read is fine if spec allows — decide, cite);
   privileged-table assertions follow the reset-role discipline (your slice-8
   lesson — no API-role reads of privileged tables).

## Boundaries
Only the three new 0022 files. No edits to merged migrations, harness, CI,
suites of other slices. No commits. No docker — orchestrator runs the
harness. Run: `npm test -- 0022`, `npm test -- supabase/migrations` (paste
exact lines).

## Report
`SLICE-9-REPORT.md`: summary, files+lines, spec citations per decision, test
output, risks, provenance with EXACT model id + effort from runtime config.
