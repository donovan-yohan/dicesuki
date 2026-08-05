# Slice 9 FIX — batched (harness failure + review findings)

1. LIVE HARNESS FAILURE (orchestrator packet error, boundary now lifted):
   `0020_dice_copy_inventory.test.sql failed — "Marker-only inventory
   foundation unexpectedly changed wallet history"`. The 0020 suite's
   wallet-neutral-scrap assertion is stale: 0022 legitimately makes scrap
   credit Dust. You MAY and MUST update supabase/tests/0020_dice_copy_inventory.test.sql:
   replace the wallet-neutrality assertion with the valued-scrap expectation
   (exact tier Dust credited) or scope that scenario's assertions to the
   invariants that still hold (marker/latch/RLS). Do not weaken anything else.
2. Replay-drift provenance gaps (🟡, 0022 ~L289 scrap + ~L562 craft): the
   drift IF validates identity keys but not economy_tier/catalog_rarity/
   economy_value_version, which the replay receipt reads — a ledger row with
   those provenance keys absent returns NULL-fielded receipts. Fail closed:
   include them in the drift check (is distinct from) or reject when any
   receipt-sourced provenance key is missing.
3. Standard-tier divergence (🟡, ~L42): common and uncommon are independent
   rows mapped to the same standard tier with no equality constraint — a
   partial PO retune could split their prices. Add a trigger asserting rows
   sharing an economy_tier carry identical scrap_yield/craft_cost (or re-key
   the table by economy_tier with a rarity→tier lookup — your call, state it).
4. SQLSTATE consistency (🔵): corruption/partial-state raises 55000 in scrap
   (~L306) but 22023 in craft (~L581) — unify on one (55000 matches the
   file family's invariant-violation convention).
5. Hold-block sensor for valued scrap (🔵): behavioral case — scrap during a
   live pull hold raises 55000 AND credits zero Dust (rollback proven), then
   succeeds after the hold terminates.

Run: `npm test -- 0022`, `npm test -- 0020_dice_copy_inventory`,
`npm test -- supabase/migrations` (paste exact lines). No docker —
orchestrator runs the harness. SLICE-9-REPORT.md rev 2 (keep rev 1).
