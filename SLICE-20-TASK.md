# Slice 20 — Standard banner activation (migration 0029, [free])

Branch econ/20-banner-activation (off main, through 0028). THE slice that
lights the pull screen: seed a standard-class, standard_roll-bound banner
version so fetchActiveStandardPullBanner returns a row and the free-tier
pull loop goes live end-to-end.

Read FIRST: how the client selects the active standard banner
(src/lib/pullRpc.ts fetchActiveStandardPullBanner — match its exact query
shape); 0011's seeded earned-collection banner family (family id, tiers,
weights, guarantees, offers — the 8/25/20 shallow pity pool); 0015 (class/
roll_type binding + pairing constraints; ticket-funded offers must satisfy
target_cost == pull_count); 0025 (pity read takes max(banner_version) per
family — a NEW VERSION of the SAME family carries players' family-scoped
pity forward and becomes the active/threshold source; confirm identical
thresholds keep the meter continuous); spec §1.4/§1.5 (standard =
permanent pool, generous, standard_roll-funded, [free]).

Task: supabase/migrations/0029_standard_banner_activation.sql (+static
test + behavioral suite):
1. New banner_version of the EXISTING earned-collection family: identical
   tiers/weights/guarantees to the current version (byte-copy semantics —
   pity continuity), banner_class='standard', roll_type='standard_roll',
   offers for 1-pull and 10-pull with target_cost==pull_count (1 and 10
   tickets). No soft-pity columns (NULL — standard stays shallow/simple).
2. Prove in the behavioral suite: fetch-shape query returns exactly this
   version as active; prepare_pull against it reserves TICKETS (not Stars);
   full prepare->commit lifecycle grants copies + advances the family
   guarantee counters CONTINUOUSLY from the old version's counters (seed
   pity on the old version, pull on the new, counters carry); pity read
   (get_my_pull_pity) reflects the new version's thresholds; old
   Stars-funded version remains preparable-or-not per your reading of the
   binding rules (state what the schema permits and assert the actual
   behavior); premium fail-closed untouched.
3. NULL-hole audit on anything touched; no CREATE OR REPLACE of engine
   bodies expected — this is DATA + offers; if you find engine changes
   needed, STOP and report.
Run npm test -- 0029 and npm test -- supabase/migrations (paste lines).
Report SLICE-20-REPORT.md with provenance (exact model id + effort).
