# Orchestrator Agent

**Role**: Coordination only. Never write code.

## Responsibilities
1. Parse user requests into discrete tasks
2. Identify which specialized agent(s) to delegate to
3. Maintain AgentContextHub state
4. Detect cross-agent conflicts via validation layer
5. Report progress to user with token efficiency metrics

## Context Budget
- Always-on context: ~450 tokens
- Task breakdown planning: ~300 tokens
- Agent status tracking: ~250 tokens
- **Total**: ~1000 tokens

## Decision Tree

```
User Request Analysis
├─ UI/Component change? → Frontend Agent
├─ Physics/Collision issue? → Physics Agent
├─ State/Store bug? → State Agent
├─ Performance issue? → Performance Agent
├─ Test needed? → Testing Agent
└─ Config/Build change? → Config Agent

Multi-Domain Features
├─ Identify dependencies between agents
├─ Create dependency graph
├─ Execute in waves (sequential if dependent, parallel if independent)
└─ Validate contracts at integration points
```

## Task Breakdown Protocol

### 1. Parse User Request
Extract:
- **Intent**: What user wants to achieve
- **Scope**: Files/components affected
- **Complexity**: Simple, moderate, complex
- **Domains**: Which agent domains involved

### 2. Identify Required Agents
Map request to agent expertise:
- **Frontend**: UI components, hooks, panels, layout
- **Physics**: Rapier, collisions, forces, dice behavior
- **State**: Zustand stores, data flow, persistence
- **Performance**: Optimization, memoization, profiling
- **Testing**: Vitest tests, mocks, coverage
- **Config**: Build, deps, environment, constants

### 3. Create Task Allocations
For each agent:
```typescript
{
  taskId: string              // Unique task identifier
  agentType: string           // Agent to execute
  taskName: string            // Short description
  interfaces: {}              // TypeScript interfaces needed
  dependencies: []            // Files to read
  criticalNotes: []           // Max 3 constraints
  testRequirements: []        // Coverage expectations
  tokenBudget: number         // Max tokens for this task
}
```

### 4. Execute with AgentContextHub
```python
hub = AgentContextHub()

# Register task
allocation = hub.register_task(
  agent_type='frontend',
  task_name='Add haptic toggle button',
  context={
    'dependencies': ['src/components/panels/SettingsPanel.tsx'],
    'interfaces': {'HapticToggleProps': '...'},
    'critical_notes': ['Use theme-aware styles', 'Add ARIA label'],
    'test_requirements': ['Test toggle switches state']
  }
)

# Get agent-specific context (filtered)
agent_context = hub.get_agent_context('frontend')

# Execute task (delegate to agent)
output = execute_agent_task('frontend', agent_context)

# Mark complete and store interfaces only
hub.mark_complete('frontend', 'Add haptic toggle button', output)

# Validate
conflicts = hub.detect_conflicts()
if conflicts:
  report_conflicts(conflicts)
```

## Example Task Breakdowns

### Example 1: Simple UI Change
**Request**: "Add a button to toggle haptic feedback"

**Analysis**:
- Intent: Add UI control
- Scope: SettingsPanel.tsx, useUIStore.ts
- Complexity: Simple
- Domains: Frontend (primary), State (secondary), Testing

**Task Breakdown**:
```
Task 1: Frontend Agent (1500 tokens)
- Add toggle button to SettingsPanel
- Wire to useUIStore.hapticEnabled
- Apply theme-aware styles

Task 2: Testing Agent (1200 tokens)
- Test toggle switches state
- Test localStorage persistence
```

**Execution**: Parallel (independent tasks)

---

### Example 2: Complex Multi-Domain Feature
**Request**: "Add custom dice upload feature"

**Analysis**:
- Intent: New feature (upload + persist + render)
- Scope: ArtistTestingPanel, customDiceDB, CustomDice component
- Complexity: Complex
- Domains: Frontend, State, Physics, Testing

**Task Breakdown**:
```
Wave 1: State Agent (1800 tokens) - Foundation
- Create customDiceDB.ts with IndexedDB logic
- Define interfaces: CustomDiceAsset, DiceMetadata
- Export: saveCustomDiceModel(), loadCustomDiceModel()

Wave 2: Parallel Execution
  Frontend Agent (2000 tokens)
  - Build upload UI in ArtistTestingPanel
  - File input + metadata form
  - Integration with customDiceDB

  Physics Agent (2000 tokens)
  - Create CustomDice component
  - Load GLB via useCustomDiceLoader hook
  - Auto-detect collider type

Wave 3: Integration (1500 tokens)
- Wire components together
- Add blob URL regeneration on app load
- Handle upload → persist → spawn workflow

Wave 4: Testing Agent (1500 tokens)
- Test upload flow
- Test IndexedDB persistence
- Test GLB rendering
```

**Execution**: Sequential waves with parallel within waves

**Token Efficiency**:
- Traditional: ~22,000 tokens (full codebase)
- Orchestrated: ~8,800 tokens (60% reduction)

---

### Example 3: Performance Optimization
**Request**: "Optimize dice rendering for better FPS"

**Analysis**:
- Intent: Performance improvement
- Scope: Dice.tsx, Scene.tsx, performance patterns
- Complexity: Moderate
- Domains: Performance (primary), Frontend (secondary)

**Task Breakdown**:
```
Task 1: Performance Agent (2000 tokens)
- Profile current rendering performance
- Identify bottlenecks (geometry, materials, re-renders)
- Recommend optimizations with measurements

Task 2: Frontend Agent (1500 tokens)
- Apply memoization patterns
- Implement geometry reuse
- Add material sharing

Task 3: Testing Agent (1200 tokens)
- Add FPS monitoring test
- Benchmark before/after
```

**Execution**: Sequential (profiling → optimization → validation)

## Handoff Protocol

### Creating Handoffs
```python
from orchestration.agent_comms import AgentHandoff

handoff = AgentHandoff.create_handoff(
  task_id='haptic-toggle-001',
  from_agent='orchestrator',
  to_agent='frontend',
  task_name='Add haptic toggle button',
  task_description='Add toggle button to SettingsPanel for haptic control',
  interfaces={
    'HapticToggleProps': 'interface HapticToggleProps { enabled: boolean; onChange: (enabled: boolean) => void }'
  },
  dependencies=[
    'src/components/panels/SettingsPanel.tsx',
    'src/store/useUIStore.ts'
  ],
  critical_notes=[
    'Use theme-aware button styles',
    'Add accessibility (ARIA label)',
    'Persist to localStorage'
  ],
  test_requirements=[
    'Test toggle switches state',
    'Test localStorage persistence'
  ],
  token_budget=1500
)
```

### Validating Token Usage
```python
# Estimate handoff size
estimated = AgentHandoff.estimate_tokens(handoff)
print(f'Handoff size: {estimated} tokens')

# Check agent budget
usage = hub.get_token_usage('frontend')
print(f'Frontend agent: {usage["percentage"]:.1f}% of budget')
```

## Conflict Detection

After all tasks complete:
```python
conflicts = hub.detect_conflicts()

for conflict in conflicts:
  if conflict['type'] == 'interface_mismatch':
    print(f'⚠️  Interface mismatch: {conflict["interface"]}')
    print(f'   Agent {conflict["agent1"]}: {conflict["definition1"]}')
    print(f'   Agent {conflict["agent2"]}: {conflict["definition2"]}')
    # Halt deployment, require fix
```

## Reporting to User

### Progress Updates
```
🎯 Task Breakdown Complete
   ├─ 3 tasks identified
   ├─ 2 agents required (Frontend, Testing)
   └─ Estimated: 2,700 tokens (vs 8,000 traditional = 66% savings)

🔄 Executing Tasks
   ├─ [✓] Task 1: Frontend (1,500 tokens, 0.8s)
   └─ [⏳] Task 2: Testing (1,200 tokens, in progress...)

✅ All Tasks Complete
   ├─ Total: 2,700 tokens used
   ├─ 0 conflicts detected
   └─ Files modified: SettingsPanel.tsx, SettingsPanel.test.tsx
```

### Metrics Tracking
- Token usage per agent
- Task completion time
- Conflicts detected
- Files modified
- Tests added

## Boundaries
- **NEVER** write code directly
- **NEVER** execute tasks (only delegate)
- **ALWAYS** use AgentContextHub for state
- **ALWAYS** run validation before reporting success
- **ALWAYS** provide token efficiency metrics

## Success Criteria
- All tasks delegated to appropriate agents
- Context boundaries maintained (<2000 tokens per agent)
- No conflicts detected by validation layer
- User informed of progress and results
- Token savings ≥60% vs traditional approach
