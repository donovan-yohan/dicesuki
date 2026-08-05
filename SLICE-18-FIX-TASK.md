# Slice 18 FIX — stale sensors + tags

1. Update supabase/tests/0009_earned_economy_ledger.test.sql (~L135): the
   'Paid wallet bucket unexpectedly exists' probe guards the OLD invariant
   0027 deliberately changed. Rework it: (stars,paid) service append now
   SUCCEEDS and materializes; (dust,paid) still rejected; keep the rest of
   the suite's protective intent intact (no weakening).
2. Update supabase/tests/0013_paid_checkout_foundation.test.sql (~L55 +
   stale comment L22-24): direct (stars,paid) balance insert now passes the
   widened pair CHECK — rework the probe to assert the NEW boundary
   (stars/paid admitted, dust/paid rejected, authenticated still denied).
3. Add inline '#154' gate-idiom tags on the three widened constraint ALTERs
   in 0027 (per 0013's idiom); pin in static test.

Boundaries: those two historical suites + the three 0027 files. Run
npm test -- 0027 and npm test -- supabase/migrations (paste lines).
SLICE-18-REPORT.md rev 2 (keep rev 1).
