# Slice 15 Report — Pity-read surface

## Outcome

Implemented the server-owned pity read surface and its client reader within the
binding slice boundary.

- `public.get_my_pull_pity(p_banner_family_id text)` is an authenticated,
  non-anonymous, self-only, `STABLE` `SECURITY DEFINER` wrapper.
- `private.get_pull_pity_for_user(uuid, text)` is revoked from every API role,
  uses `search_path = ''`, performs only unlocked reads, and never creates a
  wallet account.
- The active configuration is the single row at the family's greatest
  `banner_version`. Missing/unversioned families and ambiguous same-maximum
  versions fail closed with SQLSTATE `22023`.
- Missing guarantee state returns zero counters plus the active hard-guarantee
  and nullable soft-pity thresholds.
- The client performs one injected-client RPC call, maps the 13-column row into
  a typed camelCase snapshot, and fails closed on invalid input, non-singleton
  response shape, incoherent banner identity, unsafe counters, malformed
  thresholds, and partial/unsupported soft-pity configuration.
- No store or UI was added.

## Files

Created exactly the five implementation/test artifacts permitted by the task,
plus this required report:

1. `supabase/migrations/0025_pity_read.sql`
2. `supabase/migrations/0025_pity_read.test.ts`
3. `supabase/tests/0025_pity_read.test.sql`
4. `src/lib/pullPity.ts`
5. `src/lib/pullPity.test.ts`
6. `SLICE-15-REPORT.md`

No existing file was modified. No commit was created.

## Behavioral coverage

The PostgreSQL behavioral suite covers:

- zero state for a caller with no wallet account, including proof that the read
  does not create one;
- zero counters plus configured soft-pity thresholds from the highest banner
  version;
- all-null soft-pity fields for an unconfigured family;
- prepare/commit lifecycle projection reflected in all four counters;
- cross-user isolation before and after the caller's commit;
- unknown and unversioned families rejected with `22023`;
- competing rows at the maximum family version rejected with `22023`;
- unauthenticated `anon` and authenticated anonymous-user rejection;
- runtime function privilege assertions.

The repository's PostgreSQL harness requires Docker. The task forbids Docker,
and no local `initdb`, `pg_ctl`, `postgres`, or `psql` executable is installed,
so `supabase/tests/0025_pity_read.test.sql` was not runtime-executed in this
worktree. The required Vitest migration gate structurally validates that suite,
but this report does not misrepresent that as PostgreSQL execution.

## Adversarial review

One broad adversarial review found no P0/P1 issues and two valid P2 issues:

1. The client initially accepted a bare object for a `RETURNS TABLE` RPC.
2. The engine initially chose lexically between same-maximum family versions.

Both were fixed in one batch. The focused changed-hunk re-review passed:

- the client now requires an array containing exactly one row;
- ambiguous maximum family versions fail closed with `22023`;
- no remaining P0/P1 or P2 finding exists in the reviewed scope.

## Required gate evidence

The repository-mandated `rtk` wrapper transparently executed these exact task
commands at HEAD `611aa4c55324a2bf8cab53d9683fc8c8db540b15`.

```text
npm test -- 0025
```

```text
Test Files  1 passed (1)
     Tests  5 passed (5)
Exit: 0
```

```text
npm test -- pullPity
```

```text
Test Files  1 passed (1)
     Tests  34 passed (34)
Exit: 0
```

```text
npm test -- supabase/migrations
```

```text
Test Files  19 passed (19)
     Tests  156 passed (156)
Exit: 0
```

```text
npm run build
```

```text
Verified 69 collectible catalog items
Verified 1 immutable economy contract edition(s)
Verified 1 immutable economy simulation scenario(s)
Verified 1 immutable production economy edition(s)
Verified dice manifest: 4 sets, 19 dice
✓ 1212 modules transformed.
✓ built in 5.91s
Exit: 0
```

The build emitted the existing advisory that some minified chunks exceed
500 kB; it did not fail.

## Repository state

- Branch: `econ/15-pity-read`
- Base/HEAD: `611aa4c55324a2bf8cab53d9683fc8c8db540b15`
- Commits created: none
- Docker used: no
- Out-of-scope files changed: none

## Provenance

Binding runtime provenance:

```toml
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
```

Implementation and adversarial review workers used exact model id
`gpt-5.6-terra`. Their reasoning-effort setting was not exposed by the worker
runtime, so no unverified worker effort value is claimed.
