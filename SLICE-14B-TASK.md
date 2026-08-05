# Slice 14B — Amended boundary: proceed with slice 14

Your blocker report is accepted — the stop was correct. The boundary is
AMENDED as follows; everything else in SLICE-14-TASK.md stands verbatim:

- You MAY make a minimal ADDITIVE extension to the slice-13 data layer
  strictly to carry per-die first-copy metadata into the server-copies
  inventory view: optional fields (e.g. firstCopyAcquiredAt, hasLiveFirstCopy
  — pick precise names) threaded from diceCopies grouping through
  useInventoryStore's server-copy mapping to whatever InventoryPanel reads.
  Optional/typed so no existing consumer breaks; extend the slice-13
  colocated tests for the new fields (grouping derivation + mapping + persist
  untouched since the view is ephemeral).
- No other store/lib changes. If the 24h window needs a clock, take it as a
  parameter defaulting to Date.now-equivalent per existing test-mock idioms.

Then complete ALL of SLICE-14-TASK.md (WalletHud, badges incl. the now-
unblocked first-copy marker, ShopPanel v1, nav entry, full test matrix).
Same verification: targeted tests + `npm test` + `npm run build`, paste exact
lines. Report: SLICE-14-REPORT.md rev 2 (keep the rev 1 blocker note —
it is good evidence).
