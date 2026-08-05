# Slice 19 FIX 3 — 0028 suite temp-table role ACL

Your 0028 behavioral suite (now unblocked and running for the first time)
fails: ERROR: permission denied for table order_ctx. A temp table created
under one role is being read under another (temp tables carry owner ACLs;
API roles cannot read owner-created temp tables without a grant).
Fix the suite's role discipline around EVERY temp table it uses: either
grant select on the temp table to the reading role at creation, or
restructure so each temp table is created and read under the same role
(the 0025 suite's pg_temp handoff pattern reads as owner after reset role
— prefer that). Sweep the whole 0028 suite for the class, not just
order_ctx. Do not weaken any assertion. Run npm test -- 0028 (paste
lines); orchestrator runs the full harness.
