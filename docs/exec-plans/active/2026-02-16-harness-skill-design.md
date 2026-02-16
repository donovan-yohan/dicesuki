# Harness Documentation Skill Suite — Design

> **Status**: Approved | **Created**: 2026-02-16

## Goal

Build a global Claude Code skill suite (`harness:*`) that transforms monolithic CLAUDE.md files into a structured documentation-as-system-of-record approach. Based on the OpenAI harness engineering article's "give the agent a map, not a 1,000-page manual" principle.

## Architecture

The skill suite lives in `~/.claude/skills/harness/` as a global skill available across all repositories. It provides 4 commands: `init`, `plan`, `complete`, `garden`. It delegates to existing skills (superpowers:brainstorming, superpowers:writing-plans, adr:init) rather than duplicating their logic.

## Directory Structure (after init)

```
CLAUDE.md                          # ~80-120 line map (table of contents)
docs/
├── guides/                        # Extracted topic guides
│   ├── index.md                   # Guide directory with descriptions
│   ├── testing.md                 # TDD workflow, patterns, coverage
│   ├── git-workflow.md            # Commit strategy, branching, PR process
│   ├── debugging.md               # Common issues, solutions, debug tools
│   ├── patterns.md                # Code patterns, performance, conventions
│   └── {custom}.md                # Project-specific topics
├── exec-plans/                    # Execution plans (versioned in git)
│   ├── active/                    # In-progress plans
│   └── completed/                 # Finished plans with decision logs
├── adrs/                          # Architecture Decision Records (via /adr:init)
├── references/                    # External docs, llms.txt files
└── generated/                     # Auto-generated docs (schemas, etc.)
```

## CLAUDE.md Map Template

After init, CLAUDE.md follows the claude-md-improver recommended sections:

```markdown
# {Project Name}

> One-line description.

## Commands

| Command | Description |
|---------|-------------|
| `{test cmd}` | Run tests |
| `{build cmd}` | Production build |
| `{dev cmd}` | Start dev server |

## Architecture

{2-5 line overview + key directory listing}

## Documentation Map

| Topic | Location |
|-------|----------|
| Testing & TDD | [docs/guides/testing.md](docs/guides/testing.md) |
| Git Workflow | [docs/guides/git-workflow.md](docs/guides/git-workflow.md) |
| Debugging | [docs/guides/debugging.md](docs/guides/debugging.md) |
| Code Patterns | [docs/guides/patterns.md](docs/guides/patterns.md) |
| Architecture Rules | [.claude/rules/architecture.md](.claude/rules/architecture.md) |
| ADRs | [docs/adrs/](docs/adrs/) |
| Active Plans | [docs/exec-plans/active/](docs/exec-plans/active/) |

## Gotchas

- {Critical non-obvious items only}

## Workflow

- {3-5 key workflow rules}
```

Target: 40-120 lines. Actionable commands, copy-paste ready. Every line earns its place.

## Skill Commands

### harness:init

**Trigger**: "set up docs", "initialize harness", first-time repo setup

**Workflow**:
1. Read existing CLAUDE.md, measure line count
2. Analyze sections — identify extractable topics (testing, debugging, patterns, git, etc.)
3. Propose extraction plan to user (what goes to guides, what stays in map)
4. Create `docs/guides/{topic}.md` files with extracted content
5. Create `docs/guides/index.md` with guide directory
6. Create `docs/exec-plans/active/` and `docs/exec-plans/completed/`
7. Create `docs/references/` and `docs/generated/`
8. Rewrite CLAUDE.md as map (~80-120 lines)
9. If `docs/adrs/` doesn't exist → delegate to `/adr:init`
10. Update `~/.claude/CLAUDE.md` with harness routing instructions

### harness:plan

**Trigger**: "let's plan a feature", "I want to build X", creative/design work

**Workflow**:
1. Invoke `superpowers:brainstorming` — explore idea, clarify requirements
2. Invoke `superpowers:writing-plans` — create execution plan
3. Save to `docs/exec-plans/active/{date}-{name}.md` with plan metadata header
4. Update `docs/guides/index.md` with link to active plan

**Plan template wrapper**:
```markdown
# {Plan Title}

> **Status**: Active | **Created**: {date} | **Author**: {name}

## Goal

{One paragraph}

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|

{superpowers:writing-plans output follows}
```

### harness:complete

**Trigger**: "plan is done", "move to completed", "archive plan"

**Workflow**:
1. List active plans in `docs/exec-plans/active/`
2. User selects which plan to complete
3. Append completion summary to the plan's decision log
4. Move file to `docs/exec-plans/completed/`
5. Update status in plan header to "Completed"
6. Consider extracting ADRs from decisions (`/adr:init` or manual)

### harness:garden

**Trigger**: "docs feel stale", "CLAUDE.md too long", "audit docs"

**Checks**:
- Guide files not referenced in CLAUDE.md documentation map
- CLAUDE.md map links pointing to missing files
- Guide files not modified in 90+ days (staleness warning)
- CLAUDE.md exceeding 120 lines
- Active plans older than 30 days (stale plans)
- Missing `docs/guides/index.md` entries
- Broken cross-references between guide files

**Output**: Report with issues found + suggested fixes. Optionally apply fixes.

## Global CLAUDE.md Routing

`harness:init` adds to `~/.claude/CLAUDE.md`:

```markdown
# Harness Documentation System

For projects with a Documentation Map in CLAUDE.md:
- New features/creative work → `harness:plan` (brainstorm + plan + save to exec-plans/)
- Plan finished → `harness:complete` (archive with decision log)
- Docs feel stale/bloated → `harness:garden` (audit and fix)
- Adding project docs → update `docs/guides/*.md`, NOT CLAUDE.md
- CLAUDE.md is a map, not a manual — keep under 120 lines
```

## Skill File Structure

```
~/.claude/skills/harness/
├── skill.md              # Main skill (harness:init)
├── plan.md               # harness:plan subcommand
├── complete.md           # harness:complete subcommand
└── garden.md             # harness:garden subcommand
```

## Integration Points

- **ADR plugin**: `harness:init` delegates to `/adr:init` for ADR setup
- **superpowers:brainstorming**: `harness:plan` invokes for ideation
- **superpowers:writing-plans**: `harness:plan` invokes for plan creation
- **claude-md-management**: `harness:init` follows improver's quality criteria for the map

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-16 | Combine ADRs + exec-plans (not one or the other) | ADRs capture decisions, exec-plans capture execution context and progress |
| 2026-02-16 | Extract from existing CLAUDE.md (not empty templates) | Preserves existing knowledge, reduces manual effort |
| 2026-02-16 | Skill suite (not hooks or background agents) | Modular, focused commands; no magic; can evolve toward automation later |
| 2026-02-16 | Delegate to ADR plugin (not standalone) | Avoids duplicating ADR logic; keeps both skills focused |
| 2026-02-16 | harness:plan delegates to superpowers | Reuses proven brainstorming + planning workflow instead of reinventing |
| 2026-02-16 | Global CLAUDE.md routing | Ensures all Claude sessions know to route through harness commands |
