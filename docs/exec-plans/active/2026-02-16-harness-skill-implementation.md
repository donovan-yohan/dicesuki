# Harness Skill Suite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a global Claude Code skill suite that transforms monolithic CLAUDE.md files into structured documentation-as-system-of-record, then apply it to the daisu-app project.

**Architecture:** A single SKILL.md in `~/.claude/skills/harness/` containing all 4 subcommands (init, plan, complete, garden). User skills use argument-based subcommands (e.g., `/harness init`), not colon-separated namespacing (which is a plugin feature). The skill delegates to existing superpowers and ADR skills rather than duplicating their logic.

**Tech Stack:** Claude Code skills (Markdown), Bash for directory creation, Glob/Grep/Read for analysis.

**Design Doc:** `docs/plans/2026-02-16-harness-skill-design.md`

---

### Task 1: Create Skill Directory

**Files:**
- Create: `~/.claude/skills/harness/SKILL.md`

**Step 1: Create directory**

```bash
mkdir -p ~/.claude/skills/harness
```

**Step 2: Write SKILL.md with YAML frontmatter and overview**

The skill file must follow these conventions (from writing-skills guidelines):
- YAML frontmatter with `name` and `description` (description starts with "Use when...")
- Description only says WHEN to use, never summarizes workflow
- Keep under 500 lines total
- Progressive disclosure pattern
- Quick reference table for commands

Write `~/.claude/skills/harness/SKILL.md` with this content:

```markdown
---
name: harness
description: Use when initializing structured documentation for a repository, when planning new features or work, when completing execution plans, when auditing docs for staleness, or when CLAUDE.md exceeds 120 lines. Also use when user says "set up docs", "let's plan", "plan is done", "docs feel stale", or "initialize harness".
---

# Harness Documentation System

Transform monolithic CLAUDE.md files into a structured documentation-as-system-of-record. CLAUDE.md becomes a ~100-line map; detailed content lives in `docs/guides/`.

> "Give the agent a map, not a 1,000-page manual."

## Commands

| Command | Purpose |
|---------|---------|
| `/harness init` | Analyze CLAUDE.md, extract into docs/guides/, rewrite as map |
| `/harness plan` | Create execution plan via brainstorming + planning skills |
| `/harness complete` | Archive an active plan to completed with decision log |
| `/harness garden` | Audit docs for staleness, broken links, bloat |

---

## /harness init

**IMMEDIATELY execute this workflow:**

### Phase 1: Analyze

1. Read the project's `CLAUDE.md` and count lines
2. If under 120 lines and already has a "Documentation Map" section, report "Already initialized" and stop
3. Identify extractable sections by scanning for H2/H3 headers. Common extractions:

| Section Pattern | Extracts To |
|----------------|-------------|
| Testing, TDD, Test Strategy | `docs/guides/testing.md` |
| Git, Commit, Branch, PR | `docs/guides/git-workflow.md` |
| Debug, Common Issues, Troubleshoot | `docs/guides/debugging.md` |
| Pattern, Convention, Style, Performance | `docs/guides/patterns.md` |
| Haptic, Physics, Theme, specific features | `docs/guides/{feature-name}.md` |
| Recent Updates, Changelog | `docs/guides/changelog.md` |
| Technology Stack, Dependencies | `docs/guides/tech-stack.md` |

4. Present the extraction plan to the user:
   ```
   ## Extraction Plan

   CLAUDE.md is {N} lines. Proposing to extract into:

   | Guide File | Sections to Extract | ~Lines |
   |------------|--------------------| -------|
   | docs/guides/testing.md | "TDD", "Writing Tests", "Test Coverage" | ~150 |
   | ... | ... | ... |

   Remaining in CLAUDE.md map: ~{N} lines

   Proceed? (y/n)
   ```

### Phase 2: Create Structure

5. Create directories:
   ```bash
   mkdir -p docs/guides docs/exec-plans/active docs/exec-plans/completed docs/references docs/generated
   ```

6. For each extraction target, create the guide file with the extracted content. Preserve the original markdown formatting. Add a header to each guide:
   ```markdown
   # {Topic Title}

   > Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed {topic} guidance.

   {extracted content}
   ```

7. Create `docs/guides/index.md`:
   ```markdown
   # Documentation Guides

   | Guide | Description | Last Updated |
   |-------|-------------|--------------|
   | [testing.md](testing.md) | TDD workflow, test patterns, coverage targets | {date} |
   | [git-workflow.md](git-workflow.md) | Commit strategy, branching, PR process | {date} |
   | ... | ... | ... |
   ```

### Phase 3: Rewrite CLAUDE.md

8. Rewrite `CLAUDE.md` as a map following this template:
   ```markdown
   # {Project Name}

   > {One-line project description}

   ## Commands

   | Command | Description |
   |---------|-------------|
   | `{test cmd}` | {description} |
   | `{build cmd}` | {description} |
   | `{dev cmd}` | {description} |

   ## Architecture

   {2-5 lines: tech stack, key directories, high-level structure}

   ## Documentation Map

   | Topic | Location |
   |-------|----------|
   | {topic} | [{path}]({path}) |
   | ... | ... |
   | Architecture Rules | [.claude/rules/architecture.md](.claude/rules/architecture.md) |
   | ADRs | [docs/adrs/](docs/adrs/) |
   | Active Plans | [docs/exec-plans/active/](docs/exec-plans/active/) |
   | Completed Plans | [docs/exec-plans/completed/](docs/exec-plans/completed/) |

   ## Gotchas

   - {Only critical, non-obvious items that prevent wasted time}
   - {Max 5-7 items — if more, create a guide}

   ## Workflow

   - {Key workflow rules, e.g., "Do NOT commit unless explicitly asked"}
   - {Max 5 items}
   ```

   Target: 40-120 lines. Every line earns its place in the context window.

### Phase 4: Integrate

9. Check if `docs/adrs/` exists. If not, inform user and suggest running `/adr:init`.

10. Read `~/.claude/CLAUDE.md`. If it does not contain a "Harness Documentation System" section, append:
    ```markdown

    # ═══════════════════════════════════════════════════
    # Harness Documentation System
    # ═══════════════════════════════════════════════════

    **IMPORTANT**: For projects with a Documentation Map in their CLAUDE.md:
    - New features/creative work → use `/harness plan` (brainstorm + plan, saves to exec-plans/)
    - Plan finished → use `/harness complete` (archive with decision log)
    - Docs feel stale/bloated → use `/harness garden` (audit and fix)
    - Adding project knowledge → update the appropriate `docs/guides/*.md` file, NOT CLAUDE.md
    - CLAUDE.md is a **map**, not a manual — keep under 120 lines
    ```

### Phase 5: Report

11. Output summary:
    ```
    ## Harness Initialized

    - Extracted {N} guide files from {M}-line CLAUDE.md
    - New CLAUDE.md: {K} lines (map)
    - Created: docs/guides/, docs/exec-plans/, docs/references/, docs/generated/
    - Global routing: {installed|already present}
    - ADRs: {already exist|suggest running /adr:init}

    Files created:
    - docs/guides/index.md
    - docs/guides/testing.md
    - docs/guides/git-workflow.md
    - ...
    ```

---

## /harness plan

**IMMEDIATELY execute this workflow:**

1. Verify the project has been initialized (check for "Documentation Map" in CLAUDE.md). If not, suggest running `/harness init` first.

2. **Invoke `superpowers:brainstorming`** with the user's arguments. Follow the brainstorming skill's full process (explore context, clarify questions, propose approaches, present design).

3. When brainstorming completes and transitions to writing-plans, **invoke `superpowers:writing-plans`**. Follow its full process.

4. After the plan is written, wrap it with the harness exec-plan header and save to `docs/exec-plans/active/{YYYY-MM-DD}-{kebab-name}.md`:
   ```markdown
   # {Plan Title}

   > **Status**: Active | **Created**: {date}

   ## Decision Log

   | Date | Decision | Rationale |
   |------|----------|-----------|
   | {date} | {decisions made during brainstorming} | {rationale} |

   ---

   {superpowers:writing-plans output}
   ```

5. Report:
   ```
   Plan saved to: docs/exec-plans/active/{filename}.md

   To execute: use superpowers:executing-plans or superpowers:subagent-driven-development
   To complete: use /harness complete when finished
   ```

---

## /harness complete

**IMMEDIATELY execute this workflow:**

1. List files in `docs/exec-plans/active/`:
   ```bash
   ls docs/exec-plans/active/
   ```

2. If multiple plans exist, ask user which to complete. If only one, confirm it.

3. Read the selected plan. Review its task list for completion status.

4. Ask user for a brief completion summary (what was accomplished, any deviations from plan).

5. Append to the plan's Decision Log:
   ```markdown
   | {date} | Plan completed | {user's summary} |
   ```

6. Change the status line from `Active` to `Completed | **Completed**: {date}`.

7. Move the file:
   ```bash
   mv docs/exec-plans/active/{file} docs/exec-plans/completed/{file}
   ```

8. Check if any decisions in the Decision Log should become ADRs. If significant architectural decisions were made, suggest running `/adr:init` or creating an ADR manually.

9. Report:
   ```
   Plan archived: docs/exec-plans/completed/{file}
   Status: Completed
   Decisions logged: {N} entries
   ADR candidates: {list or "none"}
   ```

---

## /harness garden

**IMMEDIATELY execute this workflow:**

1. Verify the project has been initialized (check for "Documentation Map" in CLAUDE.md). If not, suggest `/harness init`.

2. Run all checks and collect issues:

   **a. CLAUDE.md size check:**
   ```bash
   wc -l CLAUDE.md
   ```
   Flag if > 120 lines.

   **b. Broken map links:**
   Parse the Documentation Map table in CLAUDE.md. For each link, verify the target file exists using Glob.

   **c. Orphaned guides:**
   List all files in `docs/guides/`. Check each is referenced in the CLAUDE.md Documentation Map table. Flag unreferenced files.

   **d. Stale guides:**
   For each file in `docs/guides/`, check git last-modified date:
   ```bash
   git log -1 --format="%ci" -- docs/guides/{file}
   ```
   Flag files not modified in 90+ days.

   **e. Stale active plans:**
   For each file in `docs/exec-plans/active/`, check creation date from filename or git log. Flag plans older than 30 days.

   **f. Missing index entries:**
   Compare files in `docs/guides/` against entries in `docs/guides/index.md`. Flag any missing.

3. Output report:
   ```
   ## Documentation Garden Report

   ### Issues Found: {N}

   | Severity | Issue | Location | Suggested Fix |
   |----------|-------|----------|---------------|
   | warn | CLAUDE.md is {N} lines (limit: 120) | CLAUDE.md | Extract sections to guides |
   | error | Broken link | CLAUDE.md:L{n} → {path} | Update link or create file |
   | info | Stale guide (95 days) | docs/guides/testing.md | Review and update |
   | warn | Orphaned guide | docs/guides/old-feature.md | Add to map or delete |
   | warn | Stale plan (45 days) | docs/exec-plans/active/... | Complete or update |

   ### Summary
   - Errors: {n} (broken links, missing files)
   - Warnings: {n} (stale, orphaned, oversized)
   - Info: {n} (freshness notices)
   ```

4. Ask user: "Would you like me to fix the errors and warnings automatically?"

5. If yes, apply fixes (update links, add index entries, suggest extractions for oversized CLAUDE.md).

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Putting detailed docs in CLAUDE.md | Extract to docs/guides/, keep CLAUDE.md as map |
| Forgetting to update the Documentation Map | Run `/harness garden` to catch orphans and broken links |
| Leaving plans in active/ indefinitely | Run `/harness complete` when done, or garden flags stale plans |
| Skipping the Decision Log in plans | Always log key decisions — they inform future ADRs |
| Editing guide files without checking CLAUDE.md links | Garden catches broken links, but check after renames |
```

**Step 3: Verify the skill loads**

Run: `/harness` in a Claude Code session.
Expected: Skill content loads, shows overview with 4 commands.

Run: `/harness init` in any project.
Expected: Skill content loads, begins Phase 1 analysis.

---

### Task 2: Apply harness:init to Daisu Project

This task is the real test — applying the skill to the daisu-app project's 1,080-line CLAUDE.md.

**Files:**
- Modify: `CLAUDE.md` (rewrite as ~100-line map)
- Create: `docs/guides/index.md`
- Create: `docs/guides/testing.md`
- Create: `docs/guides/git-workflow.md`
- Create: `docs/guides/debugging.md`
- Create: `docs/guides/patterns.md`
- Create: `docs/guides/haptic-feedback.md`
- Create: `docs/guides/custom-dice.md`
- Create: `docs/guides/saved-rolls.md`
- Create: `docs/guides/changelog.md`
- Create: `docs/guides/tech-stack.md`
- Create: `docs/exec-plans/active/` (directory)
- Create: `docs/exec-plans/completed/` (directory)
- Create: `docs/references/` (directory)
- Create: `docs/generated/` (directory)
- Modify: `~/.claude/CLAUDE.md` (add routing section)

**Step 1: Analyze current CLAUDE.md**

Read the full 1,080-line CLAUDE.md. Identify sections and their line ranges:

| Section | Lines | Extract To |
|---------|-------|-----------|
| Development Philosophy + TDD | ~1-100 | `docs/guides/testing.md` |
| Git Workflow | ~101-220 | `docs/guides/git-workflow.md` |
| Development Workflow | ~221-310 | `docs/guides/patterns.md` (merge with Code Quality) |
| Code Quality Guidelines | ~311-400 | `docs/guides/patterns.md` |
| Debugging Strategies | ~401-470 | `docs/guides/debugging.md` |
| Haptic Feedback System | ~471-650 | `docs/guides/haptic-feedback.md` |
| Technology Stack | ~651-680 | `docs/guides/tech-stack.md` |
| Server Gotchas | ~681-720 | `docs/guides/server.md` |
| File Organization + Naming | ~721-810 | `docs/guides/patterns.md` (append) |
| Saved Rolls Bonus System | ~811-890 | `docs/guides/saved-rolls.md` |
| Custom Dice Persistence | ~891-990 | `docs/guides/custom-dice.md` |
| Recent Updates | ~991-1080 | `docs/guides/changelog.md` |

These are approximate — read the actual file and adjust line ranges.

**Step 2: Create directory structure**

```bash
mkdir -p docs/guides docs/exec-plans/active docs/exec-plans/completed docs/references docs/generated
```

**Step 3: Extract each guide file**

For each section identified in Step 1, create the corresponding guide file. Example for testing.md:

Read CLAUDE.md lines covering TDD/Testing. Write to `docs/guides/testing.md`:

```markdown
# Testing Guide

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed testing guidance.

{extracted TDD and testing content from CLAUDE.md}
```

Repeat for all guide files. Preserve original markdown formatting, code blocks, and structure.

**Step 4: Create docs/guides/index.md**

```markdown
# Documentation Guides

| Guide | Description |
|-------|-------------|
| [testing.md](testing.md) | TDD workflow, test structure, R3F mocking, async patterns |
| [git-workflow.md](git-workflow.md) | Commit strategy, branching, message format |
| [debugging.md](debugging.md) | Common issues, debug tools, dice physics troubleshooting |
| [patterns.md](patterns.md) | Code conventions, R3F optimizations, naming, imports |
| [haptic-feedback.md](haptic-feedback.md) | Vibration system, collision detection, thresholds |
| [custom-dice.md](custom-dice.md) | GLB persistence, IndexedDB, blob URL lifecycle |
| [saved-rolls.md](saved-rolls.md) | Bonus system, formula display, state lifecycle |
| [server.md](server.md) | Rust/Axum gotchas, axum version, server architecture |
| [tech-stack.md](tech-stack.md) | Dependencies, React 19, R3F versions |
| [changelog.md](changelog.md) | Recent updates and changes |
```

**Step 5: Rewrite CLAUDE.md as map**

Write the new CLAUDE.md (~80-120 lines). Must include:
- Project name and one-line description
- Commands table (npm test, npm run build, npm run dev, cargo test)
- Architecture overview (2-5 lines + key dirs)
- Documentation Map table linking to all guides + ADRs + exec-plans
- Gotchas (only critical items: haptic throttle test failures, cargo PATH, axum param syntax, Zustand Map/Set gotcha, build validation after selective commits)
- Workflow rules (don't commit unless asked, use /adr for decisions, use harness commands, keep CLAUDE.md under 120 lines)

**Step 6: Update global ~/.claude/CLAUDE.md**

Read current `~/.claude/CLAUDE.md`. Append the harness routing section if not already present.

**Step 7: Verify**

Run: `wc -l CLAUDE.md`
Expected: 40-120 lines

Run: Verify all Documentation Map links resolve to real files (glob each path)

Run: `npm run build` (ensure no CLAUDE.md-related build issues — it's just docs)

---

### Task 3: Move Existing Plans to exec-plans

**Files:**
- Move: `docs/plans/*.md` → `docs/exec-plans/completed/` (past plans) or `docs/exec-plans/active/` (current)

**Step 1: Categorize existing plans**

The `docs/plans/` directory is gitignored but has local files. Check which are active vs completed:

```bash
ls docs/plans/
```

- `2026-02-16-harness-skill-design.md` → `docs/exec-plans/active/` (current work)
- `2026-02-16-harness-skill-implementation.md` → `docs/exec-plans/active/` (this plan)
- Multiplayer plans → `docs/exec-plans/completed/` (that work is done)
- Other plans → categorize by status

**Step 2: Copy files to new locations**

```bash
cp docs/plans/2026-02-16-harness-skill-design.md docs/exec-plans/active/
cp docs/plans/2026-02-16-harness-skill-implementation.md docs/exec-plans/active/
# Move completed plans
cp docs/plans/2026-02-15-multiplayer-*.md docs/exec-plans/completed/
```

**Step 3: Add plan metadata headers**

For each moved file, prepend the status header if missing:
```markdown
> **Status**: Active | **Created**: {date}
```
or
```markdown
> **Status**: Completed | **Created**: {date} | **Completed**: {date}
```

**Step 4: Update .gitignore**

The current `.gitignore` has `docs/plans/`. Since exec-plans are versioned, ensure `docs/exec-plans/` is NOT gitignored. The old `docs/plans/` can remain gitignored for backwards compatibility.

Verify `.gitignore` does not block `docs/exec-plans/`.

---

## Execution Summary

| Task | What | Files |
|------|------|-------|
| 1 | Create SKILL.md | 1 new file |
| 2 | Apply to daisu-app | ~12 new files, 2 modified |
| 3 | Migrate existing plans | ~12 files moved/updated, 1 modified |
| **Total** | | ~25 files |
