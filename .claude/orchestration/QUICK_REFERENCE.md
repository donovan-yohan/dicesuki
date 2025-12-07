# Orchestration System Quick Reference

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     AgentContextHub                         │
│  - Maintains project state across distributed agents       │
│  - Manages dependencies, interfaces, completions            │
│  - Routes interfaces to appropriate agents                  │
│  - Detects conflicts and circular dependencies              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ├── Uses ──> InterfaceRouter
                            │             (Explicit routing)
                            │
                            ├── Uses ──> TokenEstimator
                            │             (Accurate budgeting)
                            │
                            └── Validates ──> IntegrationValidator
                                              - Type safety
                                              - Store contracts
                                              - API contracts
                                              - Race conditions
                                              - Imports
                                              - Test coverage
```

## Key Components

### 1. AgentContextHub (`context_hub.py`)
**Purpose**: Centralized state management for distributed agents

**Key Methods**:
```python
# Register a new task with dependencies
hub.register_task(agent_type, task_name, {
    'dependencies': ['agent1 → agent2'],
    'interfaces': {'InterfaceName': 'definition'},
    'critical_notes': ['Important decision'],
    'test_requirements': ['Must test X']
})

# Get context allocated to specific agent
context = hub.get_agent_context('frontend')
# Returns: {architecture, tasks, interfaces, dependencies}

# Mark task complete
hub.mark_complete('frontend', 'task-name', {
    'interfaces': {...},
    'exports': [...],
    'tests': [...]
})

# Detect conflicts
conflicts = hub.detect_conflicts()
# Returns: [{type, severity, message, ...}]

# Check token usage
usage = hub.get_token_usage('frontend')
# Returns: {estimated_tokens, budget, remaining, percentage, breakdown}
```

### 2. InterfaceRouter (`interface_routing.py`)
**Purpose**: Deterministic interface routing to agents

**Key Methods**:
```python
router = InterfaceRouter()

# Get interfaces for specific agent
interfaces = router.get_interfaces_for_agent('frontend', all_interfaces)

# Get which agents need an interface
agents = router.get_agents_for_interface('DiceProps')

# Add custom mapping
router.add_interface_mapping('CustomAsset', ['frontend', 'state'])

# Mark as shared across all agents
router.add_shared_interface('DiceType')

# Get dependency chain
chain = router.get_dependency_chain('frontend')
```

### 3. IntegrationValidator (`validate.py`)
**Purpose**: Cross-agent contract validation

**Key Methods**:
```python
validator = IntegrationValidator(project_root)

# Run all validations
success, report = validator.run_all_validations(agent_outputs)

# Individual validations
type_conflicts = validator.validate_type_safety(interfaces)
store_conflicts = validator.validate_store_contracts(defs, usages)
import_conflicts = validator.validate_imports(file_path)
circular_deps = validator.detect_circular_dependencies(files)
test_warnings = validator.validate_test_coverage(modified_files)
```

### 4. Contract Validators (`contract_validators.py`)
**Purpose**: Store, API, and race condition validation

**Key Functions**:
```python
# Extract store contracts
contracts = extract_store_contracts(project_root, agent_outputs)
# Returns: {'definitions': {...}, 'usages': {...}}

# Validate component props
conflicts = validate_component_props(project_root, agent_outputs)

# Detect race conditions
warnings = detect_race_conditions(project_root, agent_outputs)
```

### 5. TokenEstimator (`token_estimator.py`)
**Purpose**: Accurate token counting for context budgets

**Key Methods**:
```python
estimator = TokenEstimator()

# Estimate tokens for any value
tokens = estimator.estimate_tokens("interface DiceProps { ... }")

# Get breakdown by field
breakdown = estimator.estimate_dict_tokens({
    'architecture': {...},
    'interfaces': {...}
})
# Returns: {'architecture': 120, 'interfaces': 450}
```

## Common Patterns

### Pattern 1: Register Task with Dependencies
```python
hub = AgentContextHub()

hub.register_task('physics', 'collision-detection', {
    'dependencies': [
        'physics → state',  # String format
        {'from': 'physics', 'to': 'frontend', 'type': 'updates'}  # Dict format
    ],
    'interfaces': {
        'CollisionEvent': 'interface CollisionEvent { ... }'
    },
    'critical_notes': ['Use Rapier physics engine'],
    'test_requirements': ['Test collision detection accuracy']
})
```

### Pattern 2: Validate Agent Outputs
```python
validator = IntegrationValidator(Path.cwd())

agent_outputs = {
    'frontend': {
        'filesModified': ['src/components/Dice.tsx'],
        'filesCreated': ['src/components/DiceToolbar.tsx'],
        'interfaces': {
            'DiceProps': 'interface DiceProps { ... }'
        },
        'tests': ['src/components/Dice.test.tsx']
    },
    'state': {
        'filesModified': ['src/store/useDiceStore.ts'],
        'interfaces': {
            'DiceStore': 'interface DiceStore { ... }'
        }
    }
}

success, report = validator.run_all_validations(agent_outputs)
print(report)

if not success:
    # Handle critical issues
    conflicts = validator.get_conflicts()
    for conflict in conflicts:
        if '❌ CRITICAL' in conflict:
            print(f"BLOCKER: {conflict}")
```

### Pattern 3: Route Interfaces to Agents
```python
router = InterfaceRouter()

all_interfaces = {
    'DiceProps': 'interface DiceProps { ... }',
    'UIStore': 'interface UIStore { ... }',
    'DiceType': "type DiceType = 'd4' | 'd6' | 'd8'"
}

# Get interfaces for frontend agent
frontend_interfaces = router.get_interfaces_for_agent('frontend', all_interfaces)
# Returns: {'DiceProps': '...', 'DiceType': '...'} (shared)

# Get interfaces for state agent
state_interfaces = router.get_interfaces_for_agent('state', all_interfaces)
# Returns: {'UIStore': '...', 'DiceType': '...'} (shared)
```

### Pattern 4: Check Token Budget
```python
hub = AgentContextHub()

# Register task
hub.register_task('frontend', 'build-ui', {...})

# Check token usage
usage = hub.get_token_usage('frontend')

if usage['percentage'] > 80:
    print(f"⚠️  Warning: {usage['percentage']:.1f}% of token budget used")
    print(f"Breakdown: {usage['breakdown']}")
    # Take action: compress context, defer tasks, etc.
```

## Dependency Format

### String Format
```python
dependencies = [
    'physics → state',      # physics depends on state
    'frontend → physics',   # frontend depends on physics
    'frontend → state'      # frontend depends on state
]
```

### Dict Format (More Expressive)
```python
dependencies = [
    {
        'from': 'physics',
        'to': 'state',
        'type': 'updates'  # physics updates state
    },
    {
        'from': 'frontend',
        'to': 'physics',
        'type': 'calls'    # frontend calls physics
    }
]
```

## Conflict Types

### Type Safety
```python
{
    'type': 'interface_mismatch',
    'severity': 'CRITICAL',
    'interface': 'DiceProps',
    'agent1': 'frontend',
    'agent2': 'physics',
    'definition1': '...',
    'definition2': '...',
    'message': 'Interface DiceProps has conflicting definitions...'
}
```

### Circular Dependency
```python
{
    'type': 'circular_dependency',
    'severity': 'CRITICAL',
    'cycle': ['agent1', 'agent2', 'agent3', 'agent1'],
    'message': 'Circular dependency detected: agent1 → agent2 → agent3 → agent1'
}
```

### Store Contract Violation
```python
"❌ CRITICAL: Property 'invalidProp' accessed but not defined in UIStore
  File: Component.tsx
  Fix: Add 'invalidProp' to UIStore interface"
```

### Race Condition Warning
```python
"⚠️  HIGH: Store 'useUIStore' modified by multiple agents: frontend (Component.tsx), state (store.ts)
  Ensure proper synchronization to avoid race conditions"
```

## Validation Report Format

```
🔍 Validation Report
   Agents: frontend, state, physics

✅ Type Safety: PASS
   - 5 interfaces validated
   - 0 conflicts detected

✅ Store Contracts: PASS
   - 2 stores validated
   - All property accesses valid

❌ API Contracts: FAIL (CRITICAL)
   - Component 'Dice' used with undefined props: invalidProp
     File: Scene.tsx
     Expected props: diceType, inventoryDieId

⚠️  Race Conditions: WARNING (MEDIUM)
   - Potential race condition in useStore.ts
     Non-functional setState found
     Consider: setState(state => ({ ...state, newValue }))

✅ Dependencies: PASS
   - No circular dependencies
   - All imports resolve

⚠️  Test Coverage: WARNING (MEDIUM)
   - Missing test file for customDiceDB.ts

🚨 DEPLOYMENT BLOCKED
   - 1 CRITICAL issue must be resolved
   - 2 MEDIUM issues can be deferred
```

## Agent Types

### Frontend
- **Interfaces**: UI components, panels, toolbars
- **Dependencies**: state, physics
- **Budget**: 2000 tokens

### Physics
- **Interfaces**: Collision, forces, rigid bodies
- **Dependencies**: state
- **Budget**: 2000 tokens

### State
- **Interfaces**: Zustand stores, state management
- **Dependencies**: None (base layer)
- **Budget**: 1500 tokens

### Testing
- **Interfaces**: Test utilities, mocks
- **Dependencies**: frontend, state, physics
- **Budget**: 1500 tokens

### Config
- **Interfaces**: Configuration types
- **Dependencies**: None (base layer)
- **Budget**: 1000 tokens

### Performance
- **Interfaces**: Optimization, metrics
- **Dependencies**: frontend, state, physics
- **Budget**: 2000 tokens

## Best Practices

### 1. Always Specify Dependencies
```python
# ❌ BAD - No dependencies specified
hub.register_task('frontend', 'ui-work', {
    'interfaces': {...}
})

# ✅ GOOD - Clear dependencies
hub.register_task('frontend', 'ui-work', {
    'dependencies': ['frontend → state'],
    'interfaces': {...}
})
```

### 2. Use Explicit Interface Routing
```python
# ❌ BAD - Relying on keyword heuristics
# (old system would miss this)

# ✅ GOOD - Explicit mapping
router.add_interface_mapping('CustomDiceAsset', ['frontend', 'state'])
```

### 3. Validate Before Deployment
```python
# ❌ BAD - Deploy without validation
deploy(agent_outputs)

# ✅ GOOD - Validate first
success, report = validator.run_all_validations(agent_outputs)
if success:
    deploy(agent_outputs)
else:
    print(report)
    fix_critical_issues()
```

### 4. Monitor Token Budgets
```python
# ❌ BAD - Ignore token usage
hub.register_task(...)
hub.register_task(...)
hub.register_task(...)

# ✅ GOOD - Check budget
usage = hub.get_token_usage('frontend')
if usage['percentage'] < 90:
    hub.register_task(...)
else:
    defer_or_split_task()
```

## Troubleshooting

### Issue: Dependencies Not Persisting
```python
# Check if dependencies are in project_state
print(hub.project_state['dependencies'])

# Should see: {'physics → state': ['depends_on'], ...}
# If empty, check register_task call format
```

### Issue: Interface Not Routing to Agent
```python
# Check routing configuration
router = hub.interface_router
agents = router.get_agents_for_interface('MyInterface')

# If empty, add mapping
router.add_interface_mapping('MyInterface', ['target_agent'])
```

### Issue: False Positive Conflicts
```python
# Check if it's whitespace difference
conflicts = hub.detect_conflicts()
for conflict in conflicts:
    if conflict['type'] == 'interface_mismatch':
        # Interfaces are normalized, so this is real conflict
        print(conflict['definition1'])
        print(conflict['definition2'])
```

### Issue: Validation Taking Too Long
```python
# Check number of files being validated
print(f"Validating {len(all_files)} files")

# Reduce scope if needed
validator.run_all_validations({
    agent: output for agent, output in agent_outputs.items()
    if agent in ['frontend', 'state']  # Only validate specific agents
})
```

## Testing

```bash
# Run all tests
python -m pytest .claude/orchestration/test_orchestration.py -v

# Run specific test class
python -m pytest .claude/orchestration/test_orchestration.py::TestDependencyPersistence -v

# Run with coverage
python -m pytest .claude/orchestration/test_orchestration.py --cov=. --cov-report=html
```

---

**Quick Start**: See `FIXES_SUMMARY.md` for detailed implementation guide.
**Full Documentation**: See validation_rules.md for validation specifications.
