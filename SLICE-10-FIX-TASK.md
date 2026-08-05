# Slice 10 FIX — batched review findings (0023 files only)

1. (🟡) Document the identity boundary in the SQL: comment on the RPC and the
   user_id FK stating p_user_id is the ALREADY-RESOLVED Supabase auth uid —
   Xsolla `user.id` → auth uid resolution happens upstream in the webhook
   handler (slice B). Static-test pin the comment.
2. (🟡) `is_lunar_pass_active`: add an optional `p_product_id text default
   null` filter — NULL = any subscription (current behavior), non-NULL
   restricts to that product_id. Comment: the Lunar Pass daily-claim gate
   (slice C) MUST pass the Lunar product id once the SKU exists, so a future
   second subscription product cannot leak entitlement. Extend the behavioral
   truth-table suite with product-filter cases (match, mismatch, NULL).
3. (🔵) Mirror the `excluded >= existing` date-regression guard on the
   active→non_renewing branch (~L388) so a non_renewal carrying an earlier
   date cannot shorten entitlement; comment the sequential-delivery reliance
   it defends against. Behavioral case: non_renewal with stale earlier date →
   projection keeps the newer date.
4. (🔵) Comment near the projection columns that `is_gift`/`trial` stay in
   raw_payload only (deliberate; future gift logic reparses jsonb).

Run: `npm test -- 0023`, `npm test -- supabase/migrations` (paste exact
lines). No docker — orchestrator reruns harness. SLICE-10-REPORT.md rev 2
(keep rev 1). Note: the behavioral suite DID run live already (harness 23
migrations/19 suites green) — keep it green.
