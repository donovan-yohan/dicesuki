# Integration Validation Rules

## Purpose
Detect conflicts between agents before deployment to prevent runtime errors and ensure contract compliance.

## Validation Categories

### 1. Type Safety
**Check**: TypeScript interfaces match across agents

**Goal**: Prevent type mismatches that would cause TypeScript compilation errors.

**Example Conflict**:
```typescript
// Frontend Agent exports:
interface DiceProps {
  diceType: DiceType
  inventoryDieId: string    // ← string type
}

// State Agent expects:
interface DiceInstance {
  diceType: DiceType
  inventoryDieId: number    // ← number type (MISMATCH!)
}
```

**Action**:
- **Severity**: CRITICAL (blocks deployment)
- **Report**: Flag interface mismatch with both definitions
- **Resolution**: Agents must align on consistent type

**Detection**:
1. Extract all interface definitions from agent outputs
2. Group by interface name
3. Compare definitions (ignoring whitespace)
4. Report mismatches with agent sources

---

### 2. State Contracts
**Check**: Zustand store shapes consistent across consumers

**Goal**: Ensure components and hooks access valid store properties.

**Example Conflict**:
```typescript
// State Agent defines:
interface UIStore {
  hapticEnabled: boolean
  theme: string
}

// Frontend Agent uses:
const { hapticEnabled } = useUIStore()  // ✓ Valid

const { hapticActive } = useUIStore()   // ✗ Property doesn't exist (MISMATCH!)
```

**Action**:
- **Severity**: CRITICAL (blocks deployment)
- **Report**: List undefined properties with store definition
- **Resolution**: Frontend must use correct property name or State must add property

**Detection**:
1. Parse store interface definitions
2. Extract store property accesses from component files
3. Check if all accessed properties exist in store definition
4. Report missing properties

---

### 3. API Contracts
**Check**: Component props and hook signatures match usage

**Goal**: Ensure components receive correct props and hooks return expected values.

**Example Conflict**:
```typescript
// Frontend Agent creates:
function Dice({ diceType, inventoryDieId }: DiceProps) { ... }

// Physics Agent calls:
<Dice diceType="d6" inventoryDieId="dice-001" />  // ✓ Correct

<Dice type="d6" id="dice-001" />                  // ✗ Wrong prop names (MISMATCH!)
```

**Action**:
- **Severity**: HIGH (may cause runtime errors)
- **Report**: Show expected vs actual prop names
- **Resolution**: Fix prop names in calling code

**Detection**:
1. Extract component prop interfaces
2. Find JSX usages of components
3. Compare prop names passed vs interface definition
4. Report mismatches

---

### 4. Dependency Conflicts
**Check**: No circular imports, all imports resolve

**Goal**: Prevent import cycles and missing dependencies.

**Example Conflict**:
```typescript
// CIRCULAR DEPENDENCY
// useDiceManagerStore.ts imports from Dice.tsx
import { DiceType } from '../components/dice/Dice'

// Dice.tsx imports from useDiceManagerStore.ts
import { useDiceManagerStore } from '../../store/useDiceManagerStore'

// This creates a circular dependency!
```

**Action**:
- **Severity**: HIGH (may cause build failures)
- **Report**: Show circular dependency chain
- **Resolution**: Extract shared types to `src/types/`

**Detection**:
1. Build dependency graph from import statements
2. Run cycle detection algorithm (DFS)
3. Report any cycles found

**Example Fix**:
```typescript
// Extract shared types to src/types/dice.ts
export type DiceType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20'

// Both files import from types
import { DiceType } from '../types/dice'
```

---

### 5. Test Coverage
**Check**: Critical paths have tests

**Goal**: Ensure quality and prevent regressions.

**Requirements**:
- **New hooks**: 100% coverage
- **New components**: 80% coverage
- **Bug fixes**: Regression test required
- **Modified functions**: Maintain existing coverage

**Example Violation**:
```typescript
// State Agent creates new hook
function useCustomDiceLoader(modelUrl: string) {
  // ... implementation ...
}

// BUT no test file created
// ✗ VIOLATION: New hook without tests
```

**Action**:
- **Severity**: MEDIUM (blocks deployment in strict mode)
- **Report**: List files without tests
- **Resolution**: Testing Agent creates tests

**Detection**:
1. Identify new files created by agents
2. Check for corresponding `.test.ts` or `.test.tsx` files
3. For modified files, verify tests were updated
4. Report missing tests

---

## Validation Workflow

### Pre-Deployment Checks

```
1. Collect Agent Outputs
   ↓
2. Type Safety Validation
   - Extract interfaces
   - Compare across agents
   - Flag mismatches
   ↓
3. State Contract Validation
   - Parse store definitions
   - Check property accesses
   - Flag undefined properties
   ↓
4. API Contract Validation
   - Extract component props
   - Check JSX usages
   - Flag incorrect props
   ↓
5. Dependency Validation
   - Build import graph
   - Detect circular dependencies
   - Check unresolved imports
   ↓
6. Test Coverage Validation
   - Identify new/modified files
   - Check for test files
   - Flag missing tests
   ↓
7. Generate Validation Report
   - CRITICAL issues block deployment
   - HIGH issues warn but may proceed
   - MEDIUM issues logged for future
   ↓
8. Decision
   ├─ No CRITICAL issues → Proceed to deployment
   └─ Has CRITICAL issues → Halt, require fixes
```

### Validation Report Format

```
🔍 Validation Report
   Task ID: custom-dice-upload-003
   Agents: State, Frontend, Physics

✅ Type Safety: PASS
   - 3 interfaces validated
   - 0 conflicts detected

❌ State Contracts: FAIL (CRITICAL)
   - Store: useInventoryStore
     Property 'customDice' accessed but not defined
     Agent: Frontend (ArtistTestingPanel.tsx:45)
     Fix: Add 'customDice' to InventoryState interface

✅ API Contracts: PASS
   - 2 components validated
   - All prop usages correct

⚠️  Dependencies: WARNING (HIGH)
   - Circular dependency detected:
     customDiceDB.ts → useInventoryStore.ts → customDiceDB.ts
   Fix: Extract DiceMetadata interface to src/types/

⚠️  Test Coverage: WARNING (MEDIUM)
   - Missing tests for:
     * src/lib/customDiceDB.ts (new file)
     * src/hooks/useCustomDiceLoader.ts (new file)
   Fix: Create test files

🚨 DEPLOYMENT BLOCKED
   - 1 CRITICAL issue must be resolved
   - 1 HIGH issue should be resolved
   - 1 MEDIUM issue can be deferred
```

---

## Validation Rules Configuration

```typescript
interface ValidationConfig {
  // Type safety
  enforceTypeMatching: boolean              // Default: true
  allowImplicitAny: boolean                 // Default: false

  // State contracts
  enforceStoreContracts: boolean            // Default: true
  allowDynamicProperties: boolean           // Default: false

  // API contracts
  enforceComponentProps: boolean            // Default: true
  allowExtraProps: boolean                  // Default: true (for ...rest patterns)

  // Dependencies
  blockCircularDependencies: boolean        // Default: true
  blockUnresolvedImports: boolean           // Default: true

  // Test coverage
  requireTestsForNewFiles: boolean          // Default: true
  minimumCoveragePercentage: number         // Default: 80
  blockDeploymentOnLowCoverage: boolean     // Default: false

  // Severity levels that block deployment
  blockOnCritical: boolean                  // Default: true
  blockOnHigh: boolean                      // Default: false
  blockOnMedium: boolean                    // Default: false
}
```

---

## Common Validation Patterns

### Pattern 1: Interface Evolution
```typescript
// State Agent adds new property to store
interface UIStore {
  hapticEnabled: boolean
  theme: string
  performanceMode: 'low' | 'medium' | 'high'  // NEW
}

// Validation checks:
// ✓ Backward compatible (existing properties unchanged)
// ✓ Frontend Agent doesn't break (optional property or default value)
// ✓ No type mismatches
```

### Pattern 2: Cross-Agent Coordination
```typescript
// Frontend Agent creates component
interface CustomDiceProps {
  modelUrl: string
  metadata: DiceMetadata  // References State Agent's interface
}

// State Agent must export
export interface DiceMetadata {
  name: string
  colliderType: ColliderType
  scale: number
  mass: number
}

// Validation checks:
// ✓ DiceMetadata exported by State Agent
// ✓ Frontend Agent can import it
// ✓ No circular dependency created
```

### Pattern 3: Refactoring Validation
```typescript
// Physics Agent renames function
// OLD: calculateImpulse()
// NEW: calculateRollImpulse()

// Validation checks:
// ✗ CRITICAL: Frontend Agent still calls calculateImpulse()
// Fix: Update all call sites or keep old function as alias
```

---

## Success Criteria

Validation passes when:

- ✅ No CRITICAL issues detected
- ✅ All interfaces consistent across agents
- ✅ All store properties defined
- ✅ All component props correct
- ✅ No circular dependencies
- ✅ No unresolved imports
- ✅ Test coverage meets targets (or acknowledged for deferred work)

Validation BLOCKS deployment on:

- ❌ Type mismatches between agents
- ❌ Undefined store properties accessed
- ❌ Circular dependencies
- ❌ Unresolved imports
- ❌ Missing tests for new hooks (if `requireTestsForNewFiles=true`)

---

**Validation is the safety net that allows distributed agents to work independently while maintaining system integrity.**
