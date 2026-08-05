# Slice PS FIX — batched review findings (all polish-class; money path cleared)

1. Focus-trap bounce (BottomSheet ~L90 + PullProgressOverlay ~L77): hold the
   onClose/onCancel callbacks in refs and drop them from the effect deps so
   parent re-renders cannot re-run the trap and yank focus mid-interaction.
2. SR announcement (PullRevealOverlay ~L229): mount the live region EMPTY,
   set the result text in a post-mount effect (live regions populated at
   insertion are unreliably announced).
3. Reveal assembly degradation (pullFlow.ts ~L489): never abort the whole
   reveal on a copy-join miss — degrade per-item to best-effort identity
   (catalog metadata w/o copy count; omit the owned-xN line for that item;
   log). A committed reveal must always render. Tests: single stale item
   still renders the other results.
4. Dead link (PullRevealOverlay ~L373): drop the /docs/fair-pulls anchor;
   replace with the inline expandable explainer text (one short paragraph
   in the disclosure) until a real route exists.
5. Capacity constant (~L12): source the 30-dice cap from the engineConfig
   arena/room config the client already receives (check
   src/config/engineConfig.ts — if the cap is not in EngineConfig, keep a
   named constant but comment the server source and drift risk; do NOT add
   an engine change).
6. Aria clamp (PullBannerScreen ~L478): clamp aria-valuenow to valuemax.
7. Pity refetch (~L103): refetch only on terminal flow transitions
   (revealed/canceled/expired), not every status change.
Run targeted vitest + npm test + build + report SLICE-PS-REPORT.md rev 2.
