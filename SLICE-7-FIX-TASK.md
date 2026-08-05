# Slice 7 FIX — batched review findings (0020 files only)

All in your three new 0020 files; 0020 is unmerged so edit it directly.

1. Indexes (🟡): add a non-partial `catalog_item_id`-leading index and a
   non-partial `(user_id, catalog_item_id)` covering index on
   public.dice_copies — both partial indexes lead with user_id and cannot
   serve the FK RESTRICT checks or catalog-keyed scans (repo precedent: 0012
   exists to close exactly this advisor lint). Static-test the new indexes.
2. Irreversibility exercised behaviorally (🟡): in
   supabase/tests/0020_dice_copy_inventory.test.sql, as owner (reset role, so
   the trigger — not privileges — is what fires): attempt
   `update ... set scrapped_at = null` on a scrapped copy, an update of
   `is_first_copy`, an update of `user_id`, and a `delete` — each must raise
   sqlstate 55000; assert each. Also exercise UPDATE/DELETE denial for the
   authenticated role behaviorally (not just has_table_privilege).
3. Key hygiene (🔵): mirror 0017's idempotency-key format regex
   (^[A-Za-z0-9][A-Za-z0-9._:-]+$) on grant + scrap key constraints; pin in
   static tests.

Run: `npm test -- 0020_dice_copy_inventory`, `npm test -- supabase/migrations`
(paste exact lines). No docker. Update SLICE-7-REPORT.md as rev 2 (keep rev 1).
