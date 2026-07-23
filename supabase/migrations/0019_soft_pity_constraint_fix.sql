-- Migration: 0019_soft_pity_constraint_fix
-- Repair the merged soft-pity all-or-none CHECK without rewriting 0018.
--
-- Audit: pull_banner_versions_soft_pity_model is safe. Its explicit IS NULL
-- arm intentionally permits the dormant state; every non-NULL value must equal
-- the sole supported model.
-- Audit: pull_banner_versions_soft_pity_all_or_none has a real three-valued
-- logic hole. Its configured arm compared a nullable model without first
-- proving it non-NULL.
-- Audit: soft_pity_per_pull_increment bounds are safe. The configured arm
-- proves the increment is non-NULL before evaluating both > 0 and the
-- non-finite-value NOT IN check.
-- Audit: pull_banner_versions_soft_pity_before_hard_guarantee has a
-- constraint-local three-valued logic hole when a configured model has a NULL
-- start. The repaired all-or-none constraint rejects that row too, but this
-- constraint is repaired independently; the nullable hard-guarantee value was
-- already explicitly guarded.
-- Audit: sealed_pull_results_resolution_reason_check is safe because
-- resolution_reason is NOT NULL, so its allowlist comparison cannot pass as
-- UNKNOWN.

alter table public.pull_banner_versions
  drop constraint pull_banner_versions_soft_pity_all_or_none,
  add constraint pull_banner_versions_soft_pity_all_or_none
    check (
      (
        soft_pity_model is null and
        soft_pity_start_pull is null and
        soft_pity_per_pull_increment is null
      ) or (
        soft_pity_model is not null and
        soft_pity_model = 'linear-rate-ramp' and
        soft_pity_start_pull is not null and
        soft_pity_start_pull > 1 and
        soft_pity_per_pull_increment is not null and
        soft_pity_per_pull_increment > 0 and
        soft_pity_per_pull_increment not in (
          'NaN'::numeric,
          'Infinity'::numeric,
          '-Infinity'::numeric
        )
      )
    );

alter table public.pull_banner_versions
  drop constraint pull_banner_versions_soft_pity_before_hard_guarantee,
  add constraint pull_banner_versions_soft_pity_before_hard_guarantee
    check (
      soft_pity_model is null or (
        selected_hard_guarantee_pull is not null and
        soft_pity_start_pull is not null and
        soft_pity_start_pull < selected_hard_guarantee_pull
      )
    );
