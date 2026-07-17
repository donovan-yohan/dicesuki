# ADR 013: Versioned Economy Simulation Contracts

**Status:** Accepted

## Context

Economy hypotheses need exact, reproducible comparison before Dicesuki issues
currency or randomized rewards. Mutable configuration would let later catalog
or tuning edits silently change prior simulations and disclosures. Putting the
first hypothesis in client runtime code would also blur the trust boundary
before a server-authoritative pull design exists.

## Decision

Store economy hypotheses as contiguous, append-only JSON editions with explicit
canonical catalog item ids and fixed-scale integers. Generate one immutable,
machine-readable disclosure per edition using reduced rational probabilities.
Compare all files that existed at the pull-request merge base and reject edits
to either source or disclosure.

Guarantee replacement distributions and exact counter triggers are part of the
contract. A threshold without its resolution rule is not sufficient simulator
input. The ten-pull guarantee is an isolated purchased batch: singles do not
participate, batches do not roll across purchases, and state resets after each
batch resolution.

Keep these files outside application runtime roots and fail validation if
production TypeScript/JavaScript or Rust source references their contract or
disclosure paths. This slice is simulation-only; it creates no wallet, RNG,
debit, pull, checkout, or grant path.

## Consequences

- Old simulations and public disclosures remain reproducible as the catalog
  grows.
- Changing any hypothesis requires a new contract/disclosure pair, so diffs
  show exactly which economics changed.
- Explicit item ids are verbose, but prevent future catalog entries from
  silently entering historical pools.
- Display percentages may be rounded, while exact rational values remain the
  authoritative simulator input.
- A later simulator and a later server-authoritative production service must
  each be designed and reviewed separately.
