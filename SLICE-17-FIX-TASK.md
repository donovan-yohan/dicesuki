# Slice 17 FIX — two review items

1. sku_class immutability: extend the 0026 retune trigger to reject
   new.sku_class is distinct from old.sku_class (same pattern as the sku_id
   guard, 55000). Behavioral probe: service reclass attempt fails.
2. Exercise the REAL create_payment_order RPC in the behavioral suite:
   create a die order through public.create_payment_order(...) post-0026 and
   assert it succeeds with sku_id NULL and satisfies the exactly-one
   constraint (proves the widened rowtype + RPC path, not just raw insert).

Boundaries: the three 0026 files only. Run npm test -- 0026 and
npm test -- supabase/migrations (paste lines). SLICE-17-REPORT.md rev 2.
