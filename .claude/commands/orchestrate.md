# /orchestrate Command

Activates the Orchestrator Agent to coordinate multi-agent workflows with strict context boundaries.

## Usage
```
/orchestrate <user_request>
```

## Behavior

When `/orchestrate` is invoked:

1. **Load Orchestrator Agent**
   - Load always-on context (~450 tokens)
   - Load orchestrator agent definition
   - Initialize AgentContextHub

2. **Parse User Request**
   - Analyze intent and scope
   - Identify complexity level
   - Determine required agents
   - Create dependency graph

3. **Create Task Breakdown**
   - Break request into discrete tasks
   - Assign each task to specialized agent
   - Define context boundaries (max tokens per agent)
   - Create handoff protocols

4. **Execute Tasks**
   - Load agent-specific conditional contexts
   - Register tasks in AgentContextHub
   - Execute tasks with strict token budgets
   - Track progress and token usage

5. **Validate Outputs**
   - Run Integration Validation Layer
   - Detect type mismatches, conflicts
   - Verify test coverage
   - Check contract compliance

6. **Report Results**
   - Show files modified/created
   - Display token efficiency metrics
   - List any conflicts detected
   - Provide recommendations

## Examples

### Example 1: Simple UI Change
```
/orchestrate Add a button to toggle haptic feedback

→ Orchestrator Analysis:
  Intent: UI control addition
  Scope: SettingsPanel.tsx, useUIStore.ts
  Complexity: Simple
  Agents: Frontend (primary), Testing (secondary)

→ Task Breakdown:
  Task 1: Frontend Agent (1500 tokens)
    - Add toggle button to SettingsPanel
    - Wire to useUIStore.hapticEnabled
    - Apply theme-aware styles

  Task 2: Testing Agent (1200 tokens)
    - Test toggle switches state
    - Test localStorage persistence

→ Execution:
  [✓] Frontend Agent complete (1,420 tokens, 0.8s)
  [✓] Testing Agent complete (1,150 tokens, 0.6s)

→ Validation:
  ✓ Type safety verified
  ✓ State contracts valid
  ✓ Test coverage: 85%
  ✓ No conflicts detected

→ Results:
  Files modified: SettingsPanel.tsx, SettingsPanel.test.tsx
  Total tokens: 2,570 (vs 8,000 traditional = 68% savings)
  Success: All tasks complete, no conflicts
```

### Example 2: Complex Multi-Domain Feature
```
/orchestrate Add custom dice upload feature

→ Orchestrator Analysis:
  Intent: New feature (upload + persist + render)
  Scope: ArtistTestingPanel, customDiceDB, CustomDice
  Complexity: Complex
  Agents: State (foundation), Frontend (UI), Physics (rendering), Testing

→ Task Breakdown:
  Wave 1: State Agent (1800 tokens) - Foundation
    - Create customDiceDB.ts with IndexedDB
    - Define interfaces: CustomDiceAsset, DiceMetadata
    - Export save/load functions

  Wave 2: Parallel Execution
    Frontend Agent (2000 tokens)
      - Build upload UI in ArtistTestingPanel
      - File input + metadata form

    Physics Agent (2000 tokens)
      - Create CustomDice component
      - Load GLB via useCustomDiceLoader
      - Auto-detect collider type

  Wave 3: Integration (1500 tokens)
    - Wire components together
    - Add blob URL regeneration
    - Handle upload → persist → spawn

  Wave 4: Testing Agent (1500 tokens)
    - Test upload flow
    - Test IndexedDB persistence
    - Test GLB rendering

→ Execution:
  [✓] Wave 1: State Agent (1,750 tokens, 1.2s)
  [✓] Wave 2: Frontend Agent (1,920 tokens, 1.1s)
  [✓] Wave 2: Physics Agent (1,880 tokens, 1.0s)
  [✓] Wave 3: Integration (1,450 tokens, 0.9s)
  [✓] Wave 4: Testing Agent (1,480 tokens, 0.8s)

→ Validation:
  ✓ Type safety: CustomDiceAsset interface matches across agents
  ✓ Imports: No circular dependencies
  ✓ Test coverage: 88%
  ✓ No conflicts detected

→ Results:
  Files created: customDiceDB.ts, CustomDice.tsx, useCustomDiceLoader.ts
  Files modified: ArtistTestingPanel.tsx, useInventoryStore.ts
  Total tokens: 8,480 (vs 22,000 traditional = 61% savings)
  Success: All tasks complete, no conflicts
```

### Example 3: Performance Optimization
```
/orchestrate Optimize dice rendering for better FPS

→ Orchestrator Analysis:
  Intent: Performance improvement
  Scope: Dice.tsx, Scene.tsx
  Complexity: Moderate
  Agents: Performance (primary), Frontend (secondary), Testing

→ Task Breakdown:
  Task 1: Performance Agent (2000 tokens)
    - Profile current rendering performance
    - Identify bottlenecks
    - Recommend optimizations with measurements

  Task 2: Frontend Agent (1500 tokens)
    - Apply memoization patterns
    - Implement geometry reuse
    - Add material sharing

  Task 3: Testing Agent (1200 tokens)
    - Add FPS monitoring test
    - Benchmark before/after

→ Execution:
  [✓] Performance Agent complete (1,890 tokens, 1.5s)
      Findings: Geometry recreation on every render (-15 FPS)
      Recommendation: Memoize geometries, share materials

  [✓] Frontend Agent complete (1,420 tokens, 0.9s)
      Applied: useMemo for geometries, shared material instances

  [✓] Testing Agent complete (1,150 tokens, 0.7s)
      Benchmark: 45 FPS → 60 FPS (33% improvement)

→ Validation:
  ✓ No regressions in functionality
  ✓ Performance targets met
  ✓ Test coverage maintained

→ Results:
  Files modified: Dice.tsx, Scene.tsx, Dice.test.tsx
  Performance improvement: +15 FPS (45 → 60)
  Total tokens: 4,460 (vs 12,000 traditional = 63% savings)
  Success: All tasks complete, performance goals achieved
```

## Token Efficiency Metrics

Every `/orchestrate` execution reports:

- **Token Breakdown**: By agent and phase
- **Efficiency Gain**: Percentage saved vs traditional approach
- **Context Usage**: Per-agent token budgets and actuals
- **Performance**: Execution time per task

## When to Use

### ✅ Use `/orchestrate` for:
- Multi-file features spanning multiple domains
- Complex tasks requiring coordination between agents
- Performance-critical work requiring optimization
- Features with cross-cutting concerns (UI + State + Physics)
- Situations where context window is a constraint

### ❌ Don't use `/orchestrate` for:
- Single-file changes in one domain
- Simple bug fixes
- Documentation updates
- Quick experiments or prototypes
- Tasks where full context is needed (major refactoring)

## Orchestrator Decision Tree

The orchestrator uses this logic to route tasks:

```
User Request
├─ UI/Component change?
│  ├─ Simple → Frontend Agent only
│  └─ Complex → Frontend + (State | Physics | Performance)
│
├─ Physics/Collision issue?
│  ├─ Simple → Physics Agent only
│  └─ Complex → Physics + (Frontend | State)
│
├─ State/Store change?
│  ├─ Simple → State Agent only
│  └─ Complex → State + (Frontend | Physics)
│
├─ Performance issue?
│  ├─ Profiling → Performance Agent only
│  └─ Optimization → Performance + (Frontend | Physics | State)
│
├─ Test needed?
│  └─ Testing Agent (after domain agents complete)
│
└─ Config/Build change?
   └─ Config Agent only
```

## Validation Gates

Before reporting success, orchestrator validates:

1. **Type Safety**: TypeScript interfaces match across agents
2. **State Contracts**: Zustand store shapes consistent
3. **API Contracts**: Component props, hook signatures valid
4. **Dependencies**: No circular imports
5. **Test Coverage**: Critical paths tested (target: 80%+)

If validation fails:
- Report conflicts to user
- Halt deployment
- Provide fix recommendations
- Allow agents to correct issues

## Success Criteria

An orchestrated workflow is successful when:

- ✅ All tasks completed without errors
- ✅ Token usage <2000 tokens per agent
- ✅ Validation layer detects 0 conflicts
- ✅ Test coverage meets targets
- ✅ Performance budgets not exceeded
- ✅ Token efficiency gain ≥60% vs traditional

## Advanced Options (Future)

```
/orchestrate --dry-run <request>
  → Show task breakdown without executing

/orchestrate --agent=frontend <request>
  → Force specific agent (skip auto-detection)

/orchestrate --tokens=5000 <request>
  → Set total token budget
```

---

**Note**: `/orchestrate` is designed for complex multi-agent workflows. For simple single-domain tasks, direct agent invocation may be more efficient.
