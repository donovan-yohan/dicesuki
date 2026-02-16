# Git Workflow

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed git workflow guidance.

## Initial Setup
```bash
# Initialize repository
git init

# Add .gitignore
# (Already present - covers node_modules, dist, .env, etc.)

# Initial commit
git add .
git commit -m "Initial commit: Project setup with Vite + React + TypeScript"
```

## Commit Strategy

### Commit Types
- `feat:` New feature
- `fix:` Bug fix
- `test:` Add or update tests
- `refactor:` Code refactoring
- `perf:` Performance improvement
- `docs:` Documentation updates
- `chore:` Maintenance tasks
- `style:` Code style/formatting

### Commit Message Format
```
type(scope): short description

- Detailed change 1
- Detailed change 2
- Why this change was needed

Refs: #issue-number (if applicable)
```

### Examples
```bash
# Feature commit
git commit -m "feat(dice): Add D6 component with physics integration

- Created D6.tsx with RigidBody and mesh
- Implemented imperative handle for applyImpulse
- Added memoization for geometry and callbacks
- Integrated with useFaceDetection hook

Tests: 6 tests passing for D6 component"

# Bug fix commit
git commit -m "fix(physics): Prevent dice 'pop' after result registration

- Deferred onRest callback with requestAnimationFrame
- Added double-check verification before notification
- Separated physics loop from React state updates

Issue: Dice would move slightly when result was displayed"

# Test commit
git commit -m "test(hooks): Add tests for useDiceRoll hook

- 22 tests covering roll mechanics
- Roll state management tests
- Impulse generation tests
- Roll history tracking tests"
```

## Branching Strategy

### For Solo Development
```bash
# Work directly on main for small features
git checkout -b feature/device-motion
# ... make changes ...
git commit -m "feat(input): Add device motion support"
git checkout main
git merge feature/device-motion
git branch -d feature/device-motion
```

### For Larger Features
```bash
# Create feature branch
git checkout -b feature/multiple-dice

# Make incremental commits
git commit -m "feat(dice): Add d8 geometry"
git commit -m "test(dice): Add tests for d8 face detection"
git commit -m "feat(dice): Integrate d8 into DiceManager"

# Merge when complete
git checkout main
git merge feature/multiple-dice
```

## Commit Frequency

### When to Commit
- After completing a test + implementation cycle
- After fixing a bug with verification
- After completing a sub-feature
- Before attempting risky refactoring
- At natural stopping points (end of session)

### Commit Checklist
Before committing, ensure:
- [ ] All tests pass (`npm test`)
- [ ] No linting errors (`npm run lint` if configured)
- [ ] Code builds successfully (`npm run build`)
- [ ] **Cross-reference check**: When selectively staging files, verify committed files don't import/reference uncommitted files or APIs (use `git diff --cached` to review staged changes against unstaged modifications)
- [ ] **Post-commit build verification**: After committing, run `npm run build` to confirm the committed state builds (not just the working tree)
- [ ] No console errors in dev environment
- [ ] Related documentation updated (if needed)
- [ ] **CLAUDE.md reviewed and updated** (on feature completion or when asked to commit)
