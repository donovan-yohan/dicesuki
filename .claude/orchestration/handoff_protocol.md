# Structured Handoff Protocol

## Purpose
Define minimal context passing between agents to maintain token efficiency and prevent context bloat.

## Handoff Structure

```typescript
interface TaskHandoff {
  // Identity
  taskId: string                      // Unique task identifier
  fromAgent: string                   // 'orchestrator' or agent name
  toAgent: string                     // Agent receiving task

  // Task Definition
  taskName: string                    // Short description (max 50 chars)
  taskDescription: string             // Detailed description (max 200 chars)

  // Minimal Context
  interfaces: Record<string, string>  // TypeScript interfaces ONLY
  dependencies: string[]              // File paths to read (max 5)
  criticalNotes: string[]             // Important constraints (max 3, <100 chars each)
  testRequirements: string[]          // Coverage expectations (max 3)

  // Constraints
  tokenBudget: number                 // Max tokens for this task
  deadline?: string                   // Optional time constraint
  priority?: 'low' | 'medium' | 'high'  // Task priority
}
```

## Rules for Minimal Context

### 1. No Implementation Details
**Pass ONLY**:
- TypeScript interface definitions
- Function signatures
- Type contracts

**DO NOT Pass**:
- Full component implementations
- Complete file contents
- Code examples (unless critical)
- Historical context or rationale

### 2. Max 3 Critical Notes
Force prioritization by limiting to 3 most important constraints:

```typescript
// ✅ Good: Focused, actionable
criticalNotes: [
  'Use theme-aware button styles',
  'Add accessibility (ARIA label)',
  'Throttle to max 1 call per 50ms'
]

// ❌ Bad: Too many, too vague
criticalNotes: [
  'Make it look good',
  'Follow best practices',
  'Be performant',
  'Add tests',
  'Use TypeScript'  // Already implied
]
```

### 3. Max 5 Dependencies
Limit file reads to prevent context explosion:

```typescript
// ✅ Good: Targeted dependencies
dependencies: [
  'src/components/panels/SettingsPanel.tsx',
  'src/store/useUIStore.ts',
  'src/hooks/useTheme.ts'
]

// ❌ Bad: Too broad
dependencies: [
  'src/components/**/*.tsx',  // Glob patterns not allowed
  'src/store/',               // Directory not allowed
  // ... 10+ files
]
```

### 4. Interfaces Over Examples
**Prefer**:
```typescript
interfaces: {
  'HapticToggleProps': 'interface HapticToggleProps { enabled: boolean; onChange: (enabled: boolean) => void }'
}
```

**Over**:
```typescript
// ❌ Don't pass code examples
examples: `
function HapticToggle({ enabled, onChange }) {
  return <button onClick={() => onChange(!enabled)}>
    {enabled ? 'On' : 'Off'}
  </button>
}
`
```

## Example Handoffs

### Example 1: Frontend Task
```json
{
  "taskId": "haptic-toggle-001",
  "fromAgent": "orchestrator",
  "toAgent": "frontend",
  "taskName": "Add haptic toggle button",
  "taskDescription": "Add toggle button to SettingsPanel for haptic feedback control with theme-aware styling",

  "interfaces": {
    "HapticToggleProps": "interface HapticToggleProps { enabled: boolean; onChange: (enabled: boolean) => void }",
    "UIStore": "interface UIStore { hapticEnabled: boolean; setHapticEnabled: (enabled: boolean) => void }"
  },

  "dependencies": [
    "src/components/panels/SettingsPanel.tsx",
    "src/store/useUIStore.ts",
    "src/hooks/useTheme.ts"
  ],

  "criticalNotes": [
    "Use theme.tokens.colors.accent for button highlight",
    "Add ARIA label: 'Toggle haptic feedback'",
    "Persist state to localStorage via useUIStore"
  ],

  "testRequirements": [
    "Test toggle switches state correctly",
    "Test localStorage persistence on mount/unmount"
  ],

  "tokenBudget": 1500,
  "priority": "medium"
}
```

**Estimated Tokens**: ~350 tokens (well under budget)

---

### Example 2: Physics Task
```json
{
  "taskId": "collision-haptic-002",
  "fromAgent": "orchestrator",
  "toAgent": "physics",
  "taskName": "Add collision haptic detection",
  "taskDescription": "Implement multi-filter collision detection to trigger haptic feedback only on impacts, not sliding contact",

  "interfaces": {
    "HapticPattern": "type HapticPattern = 'light' | 'medium' | 'strong'",
    "CollisionCallback": "type CollisionCallback = (pattern: HapticPattern) => void",
    "ContactForcePayload": "interface ContactForcePayload { totalForce: Vector3; totalForceMagnitude: number }"
  },

  "dependencies": [
    "src/components/dice/Dice.tsx",
    "src/hooks/useHapticFeedback.ts",
    "src/config/physicsConfig.ts"
  ],

  "criticalNotes": [
    "Use multi-filter: speed > 0.5 m/s AND force opposes velocity (dot < -0.3) AND delta-v > 0.5",
    "Map force magnitude to pattern: <20=light, 20-50=medium, >50=strong",
    "Throttle to max 1 vibration per 50ms"
  ],

  "testRequirements": [
    "Test valid impact triggers haptic (force opposes velocity)",
    "Test sliding contact does NOT trigger (force parallel to velocity)",
    "Test throttling prevents excessive vibrations"
  ],

  "tokenBudget": 1800,
  "priority": "high"
}
```

**Estimated Tokens**: ~420 tokens

---

### Example 3: State Task
```json
{
  "taskId": "custom-dice-db-003",
  "fromAgent": "orchestrator",
  "toAgent": "state",
  "taskName": "Create IndexedDB custom dice storage",
  "taskDescription": "Implement IndexedDB persistence for custom dice GLB files with save/load operations and blob URL regeneration",

  "interfaces": {
    "CustomDiceAsset": "interface CustomDiceAsset { modelUrl: string; metadata: DiceMetadata }",
    "DiceMetadata": "interface DiceMetadata { name: string; colliderType: 'cuboid' | 'ball' | 'convexHull'; scale: number; mass: number }"
  },

  "dependencies": [
    "src/store/useInventoryStore.ts",
    "src/types/inventory.ts"
  ],

  "criticalNotes": [
    "Convert Blob to ArrayBuffer BEFORE opening IndexedDB transaction",
    "Regenerate blob URLs on app initialization from stored ArrayBuffers",
    "DB schema: key=diceId (string), value=ArrayBuffer (GLB file)"
  ],

  "testRequirements": [
    "Test save GLB file and retrieve ArrayBuffer",
    "Test blob URL regeneration on app reload"
  ],

  "tokenBudget": 1800,
  "priority": "high"
}
```

**Estimated Tokens**: ~390 tokens

---

### Example 4: Performance Task
```json
{
  "taskId": "dice-render-perf-004",
  "fromAgent": "orchestrator",
  "toAgent": "performance",
  "taskName": "Optimize dice rendering performance",
  "taskDescription": "Profile and optimize dice component rendering to achieve 60 FPS on mobile with up to 10 dice on screen",

  "interfaces": {
    "DiceProps": "interface DiceProps { diceType: DiceType; inventoryDieId: string; position: [number, number, number] }",
    "PerformanceMetrics": "interface PerformanceMetrics { fps: number; frameTime: number; renderTime: number }"
  },

  "dependencies": [
    "src/components/dice/Dice.tsx",
    "src/components/Scene.tsx"
  ],

  "criticalNotes": [
    "Target: 60 FPS with 10 dice (16.67ms per frame budget)",
    "Likely bottlenecks: geometry recreation, material instances, callbacks",
    "Apply React.memo, useMemo for geometry, useCallback for handlers"
  ],

  "testRequirements": [
    "Add FPS benchmark test: baseline vs optimized",
    "Verify no functionality regressions"
  ],

  "tokenBudget": 2000,
  "priority": "medium"
}
```

**Estimated Tokens**: ~380 tokens

---

## Handoff Response Structure

```typescript
interface TaskResponse {
  taskId: string
  agentType: string
  status: 'success' | 'error' | 'blocked'

  // Outputs (minimal)
  filesModified: string[]
  filesCreated: string[]
  interfaces: Record<string, string>  // New/updated interfaces ONLY
  exports: string[]                   // New exports from modified files
  tests: string[]                     // Test files created/modified

  // Metadata
  tokenUsage: number
  executionTime: number               // Milliseconds
  warnings: string[]                  // Non-blocking issues
  errors?: string[]                   // Blocking issues (if status=error)
  blockers?: string[]                 // Dependencies needed (if status=blocked)
}
```

## Handoff Validation

Before sending handoff, validate:

```python
def validate_handoff(handoff: dict) -> list[str]:
    errors = []

    # Check required fields
    required = ['taskId', 'fromAgent', 'toAgent', 'taskName', 'taskDescription']
    for field in required:
        if field not in handoff:
            errors.append(f'Missing required field: {field}')

    # Validate constraints
    if len(handoff.get('taskDescription', '')) > 200:
        errors.append('taskDescription must be <200 chars')

    if len(handoff.get('criticalNotes', [])) > 3:
        errors.append('Max 3 critical notes allowed')

    if len(handoff.get('dependencies', [])) > 5:
        errors.append('Max 5 dependencies allowed')

    for note in handoff.get('criticalNotes', []):
        if len(note) > 100:
            errors.append(f'Critical note too long (>100 chars): {note[:50]}...')

    # Validate token budget
    budget = handoff.get('tokenBudget', 0)
    if budget < 500 or budget > 3000:
        errors.append(f'Token budget out of range (500-3000): {budget}')

    return errors
```

## Token Compression Techniques

### 1. Interface Compression
```typescript
// Before compression (verbose)
interface UserData {
  firstName: string
  lastName: string
  email: string
  isActive: boolean
}

// After compression (remove whitespace, comments)
'interface UserData{firstName:string;lastName:string;email:string;isActive:boolean}'
```

### 2. Critical Note Abbreviation
```typescript
// Before
'Use theme.tokens.colors.accent for the button highlight color'

// After
'Use theme.tokens.colors.accent for button highlight'
```

### 3. Dependency Path Shortening
```typescript
// Use relative paths where possible
'src/components/panels/SettingsPanel.tsx'
// vs full absolute path
'/Users/user/projects/daisu-app/src/components/panels/SettingsPanel.tsx'
```

## Handoff Lifecycle

```
1. Orchestrator creates handoff
   ↓
2. Validate handoff (check constraints)
   ↓
3. Estimate token usage
   ↓
4. Send to agent (load conditional context + handoff)
   ↓
5. Agent executes task
   ↓
6. Agent returns response (minimal interfaces + files)
   ↓
7. Orchestrator validates response
   ↓
8. Update AgentContextHub with interfaces
   ↓
9. Proceed to next task or report completion
```

## Best Practices

### ✅ DO:
- Keep descriptions concise and actionable
- Pass only TypeScript interfaces, not implementations
- Limit dependencies to truly necessary files
- Prioritize critical notes (max 3)
- Use meaningful task IDs (e.g., `feature-component-number`)
- Estimate token usage before sending

### ❌ DON'T:
- Pass full file contents
- Include historical context or discussion
- Use vague notes like "make it good"
- Exceed 5 dependencies per task
- Include examples unless absolutely critical
- Pass redundant information across agents

## Metrics to Track

- **Handoff Size**: Tokens per handoff (target: <500)
- **Compression Ratio**: Original vs compressed interfaces
- **Validation Failures**: % of handoffs rejected
- **Token Accuracy**: Estimated vs actual usage
- **Response Quality**: % of tasks requiring rework

---

**Goal**: Keep handoffs <500 tokens each to maintain overall efficiency and prevent context bloat across the orchestration system.
