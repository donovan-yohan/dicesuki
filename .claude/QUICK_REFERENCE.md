# Context Orchestration Quick Reference

## TL;DR

Use `/orchestrate <request>` for complex multi-agent tasks to save 60-78% tokens.

---

## When to Use

### ✅ Use `/orchestrate` for:
- Multi-file features spanning multiple domains
- Complex tasks requiring coordination (UI + State + Physics)
- Performance-critical work
- Features with cross-cutting concerns

### ❌ Don't use `/orchestrate` for:
- Single-file changes
- Simple bug fixes
- Documentation updates
- Quick experiments

---

## Available Agents

| Agent | Role | Token Budget | Use For |
|-------|------|--------------|---------|
| **orchestrator** | Coordination only | 1000 | Delegates tasks, never writes code |
| **frontend** | UI components, hooks, styling | 2000 | React components, panels, theme integration |
| **physics** | Rapier physics, collisions | 2000 | Dice behavior, collision detection, forces |
| **state** | Zustand stores, data flow | 1500 | Store management, IndexedDB, persistence |
| **performance** | Optimization, profiling | 2000 | React memoization, R3F optimization, FPS improvements |
| **testing** | Test creation, coverage | 1500 | Vitest tests, mocks, coverage analysis |
| **config** | Build, dependencies, tooling | 1000 | Vite config, TypeScript, package.json |

---

## Quick Examples

### Simple UI Change
```bash
/orchestrate Add a button to toggle haptic feedback
```
**Result**: Frontend + Testing agents, 2,570 tokens (68% savings)

### Performance Optimization
```bash
/orchestrate Optimize dice rendering for better FPS
```
**Result**: Performance → Frontend → Testing, 4,460 tokens (63% savings)

### Complex Feature
```bash
/orchestrate Add custom dice upload feature
```
**Result**: State → (Frontend + Physics) → Integration → Testing, 8,480 tokens (61% savings)

---

## Context Layers

### Always-On (450 tokens)
Loaded by ALL agents:
- Project identity (Daisu, React 19, Three.js, Rapier, Zustand)
- Core architecture decisions
- File structure
- Active constraints (TDD, mobile-first, no UI libraries)

### Conditional (400-800 tokens)
Loaded ONLY for relevant domain:
- **frontend_context.md**: Component patterns, styling, theme
- **physics_context.md**: Rapier, collisions, face detection
- **state_context.md**: Zustand stores, data flow, IndexedDB
- **performance_context.md**: React optimization, R3F patterns, profiling

### Task-Specific (150-850 tokens)
From handoff:
- TypeScript interfaces
- File dependencies (max 5)
- Critical notes (max 3)
- Test requirements

---

## Validation Gates

### CRITICAL (Blocks Deployment)
- Type mismatches between agents
- Undefined store properties
- Circular dependencies

### HIGH (Warns)
- Unresolved imports
- Missing tests for hooks

### MEDIUM (Logged)
- Missing tests for components

---

## Performance Agent Patterns

### React Optimization
```typescript
// Memoize geometry
const geometry = useMemo(() => new BoxGeometry(1, 1, 1), [])

// Memoize callbacks
const handleClick = useCallback(() => { ... }, [deps])

// Memoize components
export const Dice = memo(DiceImpl)
```

### R3F Optimization
```typescript
// Reuse materials
const material = useMemo(() => new MeshStandardMaterial(), [])

// Proper disposal
useEffect(() => {
  return () => {
    geometry.dispose()
    material.dispose()
  }
}, [])
```

### Physics Optimization
```typescript
// Early exit patterns (cheap checks first)
if (speed < MIN_SPEED) return
if (forceMag < MIN_FORCE) return
// Expensive checks last
const dot = velocity.dot(force.normalize())
```

---

## File Locations

```
.claude/
├── orchestration/
│   ├── context_hub.py          # Central state
│   ├── agent_comms.py          # Handoff utilities
│   ├── validate.py             # Validation layer
│   ├── always_on_context.md    # Core context (450 tokens)
│   └── conditional_contexts/
│       ├── frontend_context.md
│       ├── physics_context.md
│       ├── state_context.md
│       └── performance_context.md
├── agents/
│   ├── orchestrator.md
│   ├── frontend_agent.md
│   ├── physics_agent.md
│   ├── state_agent.md
│   ├── performance_agent.md
│   ├── testing_agent.md
│   └── config_agent.md
└── commands/
    └── orchestrate.md          # /orchestrate command
```

---

## Common Workflows

### UI Feature
```
Orchestrator → Frontend → Testing
```

### Performance Issue
```
Orchestrator → Performance (profile) → Frontend (apply) → Testing (benchmark)
```

### Full Feature
```
Wave 1: State (foundation)
Wave 2: Frontend + Physics (parallel)
Wave 3: Integration
Wave 4: Testing
```

---

## Metrics to Track

After each orchestration:
- **Token usage**: Actual vs traditional
- **Efficiency gain**: Percentage saved
- **Conflicts detected**: CRITICAL/HIGH/MEDIUM
- **Files modified**: Count
- **Execution time**: Seconds

---

## Troubleshooting

### "Too many dependencies"
- **Limit**: 5 files per handoff
- **Fix**: Break into smaller tasks or extract shared types

### "Critical notes too long"
- **Limit**: 3 notes, <100 chars each
- **Fix**: Condense to essential constraints only

### "Token budget exceeded"
- **Agent Limits**: 1000-2000 tokens
- **Fix**: Reduce dependencies or split task

### "Circular dependency detected"
- **Cause**: A imports B, B imports A
- **Fix**: Extract shared types to `src/types/`

---

## Tips for Success

1. **Start Simple**: Test with simple UI changes first
2. **Monitor Tokens**: Check actual vs budget
3. **Use Validation**: Let it catch issues early
4. **Iterate**: Refine agent definitions based on learnings
5. **Document Patterns**: Track successful orchestrations

---

## Full Documentation

- **CONTEXT_ORCHESTRATION.md**: Original implementation guide
- **IMPLEMENTATION_SUMMARY.md**: Complete system overview
- **Individual agent files**: Detailed agent specifications

---

**Ready to use!** Start with `/orchestrate <your request>`
