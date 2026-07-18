-- Close the five unindexed-foreign-key findings introduced by migration 0011.
-- These tables are empty at rollout, so ordinary transactional index creation
-- is the smallest append-only change and does not rewrite frozen pull history.

create index pull_banner_items_tier_fkey_idx
  on public.pull_banner_items using btree
  (banner_version_id, tier_id, tier_rank);

create index pull_guarantee_states_banner_family_id_fkey_idx
  on public.pull_guarantee_states using btree
  (banner_family_id);

create index pull_sessions_account_fkey_idx
  on public.pull_sessions using btree
  (account_id, user_id);

create index pull_sessions_banner_fkey_idx
  on public.pull_sessions using btree
  (banner_version_id, banner_family_id);

create index sealed_pull_results_session_fkey_idx
  on public.sealed_pull_results using btree
  (session_id, account_id, user_id, banner_version_id);
