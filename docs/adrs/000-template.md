# ADR NNN - Title

* Date: YYYY/MM/DD
* Status: Proposed | Accepted | Deprecated | Superseded
* Deciders: <names/teams>

## Context

<!-- What problem are we solving? What constraints exist? What forces are at play? -->

## Decision

<!-- State the decision clearly. Use RFC 2119 keywords (MUST, SHOULD, MAY) for enforceable rules. -->

## Alternatives Considered

<!-- What other options were evaluated? Why were they rejected? -->

## Consequences

### Positive

<!-- Benefits of this decision -->

### Negative / Considerations

<!-- Drawbacks, risks, or tradeoffs -->

---

## Directory Structure

ADRs are organized by domain within this monorepo:

```
docs/adrs/
  000-template.md          # This template (shared)
  frontend/                # React, Three.js, Zustand, UI, testing
    001-*.md
  server/                  # Rust, Axum, Rapier3D, server infra
    001-*.md
  shared/                  # Cross-cutting decisions spanning both
    001-*.md
```

Each directory maintains its own numbering sequence starting at 001.

## Naming Convention

```
NNN-short-kebab-title.md
```

## Status Lifecycle

```
Proposed --> Accepted --> [Deprecated | Superseded]
```

When superseding, update both ADRs with cross-references.
