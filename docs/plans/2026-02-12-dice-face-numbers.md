# Dice Face Numbers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **For Agent Team Members:** When you encounter complex implementation problems (geometry math, UV mapping, canvas coordinate transforms), use the `/using-codex` skill to offload intensive coding to Codex CLI. This is especially relevant for d4 classic numbering layout and face-to-triangle mapping verification.

**Goal:** Add visible numbers to all default dice (d4, d6, d8, d10, d12, d20) using canvas textures, with Playwright-based visual validation ensuring the rendered number matches what face detection reports.

**Architecture:** Validation-first approach. Build a test harness and Playwright suite first, then audit the existing face-to-material mapping, then render textures using verified mappings, then validate everything end-to-end with screenshots. The d4 uses classic-style numbering (3 numbers per face near each edge; result read from top vertex of visible faces). All other dice use a single centered number per face.

**Tech Stack:** Three.js CanvasTexture, Playwright (new dependency), existing `faceMaterialMapping.ts` + `geometryFaceMapper.ts` (audited, not blindly trusted), Vitest for unit tests.

---

## Agent Team Structure

This plan is designed for parallel execution using an agent team. Below is the team structure and dependency graph.

### Team Members

| Agent | Role | Tasks | Tools |
|-------|------|-------|-------|
| **harness-builder** | Test Harness + Playwright Setup | Tasks 1, 2 | general-purpose |
| **mapping-auditor** | Face Mapping Verification | Tasks 3, 4 | general-purpose |
| **texture-renderer** | Canvas Texture Implementation | Tasks 5, 6, 7 | general-purpose |
| **playwright-validator** | Visual Validation Suite | Tasks 8, 9 | general-purpose |

### Dependency Graph

```
Tasks 1,2 (harness-builder)  ──┐
                                ├──→ Task 8,9 (playwright-validator)
Tasks 3,4 (mapping-auditor) ──┤
                               └──→ Tasks 5,6,7 (texture-renderer)
```

- **harness-builder** and **mapping-auditor** run in parallel (no dependencies)
- **texture-renderer** starts after mapping-auditor completes (needs verified mappings)
- **playwright-validator** starts after both harness-builder and texture-renderer complete

### Agent Instructions

Each agent should:
1. Read this plan document fully before starting
2. Use `/using-codex` for complex implementation problems (geometry math, coordinate transforms, d4 numbering layout)
3. Run `npm test` after writing tests, `npm run build` after implementation changes
4. Commit after each completed task with clear messages

---

## Task 1: Install Playwright and Configure

**Owner:** harness-builder
**Files:**
- Modify: `package.json`
- Create: `playwright.config.ts`
- Create: `e2e/dice-faces.spec.ts` (placeholder)

**Step 1: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

**Step 2: Create Playwright config**

Create `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev:vite',
    port: 5173,
    reuseExistingServer: true,
  },
})
```

**Step 3: Create placeholder e2e test**

Create `e2e/dice-faces.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

test('placeholder - dice face test harness loads', async ({ page }) => {
  await page.goto('/test/dice-faces?type=d6&face=0')
  // Will be fleshed out in Task 8
  await expect(page.locator('[data-testid="dice-test-harness"]')).toBeVisible()
})
```

**Step 4: Verify Playwright runs**

```bash
npx playwright test --reporter=list
```

Expected: Test fails (harness route doesn't exist yet — that's Task 2).

**Step 5: Commit**

```bash
git add playwright.config.ts e2e/ package.json package-lock.json
git commit -m "chore: add Playwright for dice face visual validation"
```

---

## Task 2: Build the Dice Face Test Harness

**Owner:** harness-builder
**Files:**
- Create: `src/components/test/DiceFaceTestHarness.tsx`
- Modify: `src/App.tsx` (add route)

**Step 1: Create the test harness component**

Create `src/components/test/DiceFaceTestHarness.tsx`:

This component:
- Reads `type` (DiceShape) and `face` (face index) from URL search params
- Creates the geometry for that dice type
- Computes a quaternion that rotates the target face normal to align with the detection direction (up for most, down for d4)
- Renders a single die mesh at that quaternion in a minimal Canvas (no physics, fixed camera)
- Calls `getDiceFaceValue()` with the same quaternion and renders the reported value as `data-testid="reported-value"`
- Renders the face index and dice type as `data-testid="face-index"` and `data-testid="dice-type"`
- Wraps everything in a `data-testid="dice-test-harness"` container

```typescript
import { useSearchParams } from 'react-router-dom'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import {
  DiceShape,
  getDiceFaceValue,
  D4_FACE_NORMALS,
  D6_FACE_NORMALS,
  D8_FACE_NORMALS,
  D10_FACE_NORMALS,
  D12_FACE_NORMALS,
  D20_FACE_NORMALS,
  createD4Geometry,
  createD6Geometry,
  createD8Geometry,
  createD10Geometry,
  createD12Geometry,
  createD20Geometry,
} from '../../lib/geometries'

const FACE_NORMALS_MAP = {
  d4: D4_FACE_NORMALS,
  d6: D6_FACE_NORMALS,
  d8: D8_FACE_NORMALS,
  d10: D10_FACE_NORMALS,
  d12: D12_FACE_NORMALS,
  d20: D20_FACE_NORMALS,
}

const GEOMETRY_CREATORS = {
  d4: createD4Geometry,
  d6: createD6Geometry,
  d8: createD8Geometry,
  d10: createD10Geometry,
  d12: createD12Geometry,
  d20: createD20Geometry,
}

/**
 * Compute quaternion that rotates a face normal to align with the target direction.
 * For d4: target is DOWN (0,-1,0) — the detected face touches ground.
 * For others: target is UP (0,1,0) — the detected face points to ceiling.
 */
function computeAlignmentQuaternion(faceNormal: THREE.Vector3, shape: DiceShape): THREE.Quaternion {
  const target = shape === 'd4'
    ? new THREE.Vector3(0, -1, 0)
    : new THREE.Vector3(0, 1, 0)

  const quaternion = new THREE.Quaternion()
  quaternion.setFromUnitVectors(faceNormal.clone().normalize(), target)
  return quaternion
}

function DieAtOrientation({
  shape,
  quaternion,
  materials,
}: {
  shape: DiceShape
  quaternion: THREE.Quaternion
  materials: THREE.Material | THREE.Material[]
}) {
  const geometry = useMemo(() => GEOMETRY_CREATORS[shape](1), [shape])
  const euler = useMemo(() => new THREE.Euler().setFromQuaternion(quaternion), [quaternion])

  return (
    <mesh geometry={geometry} material={materials} rotation={euler} />
  )
}

export default function DiceFaceTestHarness() {
  const [searchParams] = useSearchParams()
  const shape = (searchParams.get('type') || 'd6') as DiceShape
  const faceIndex = parseInt(searchParams.get('face') || '0')

  const faceNormals = FACE_NORMALS_MAP[shape]
  if (!faceNormals || faceIndex >= faceNormals.length) {
    return <div data-testid="dice-test-harness">Invalid params</div>
  }

  const face = faceNormals[faceIndex]
  const quaternion = computeAlignmentQuaternion(face.normal, shape)
  const reportedValue = getDiceFaceValue(quaternion, shape)

  // Simple solid material for initial harness (textures added later)
  const material = new THREE.MeshStandardMaterial({ color: '#ff6b35' })

  return (
    <div data-testid="dice-test-harness" style={{ width: '100vw', height: '100vh', background: '#111' }}>
      <div style={{ position: 'absolute', top: 10, left: 10, color: 'white', zIndex: 10, fontFamily: 'monospace' }}>
        <div data-testid="dice-type">{shape}</div>
        <div data-testid="face-index">{faceIndex}</div>
        <div data-testid="expected-value">{face.value}</div>
        <div data-testid="reported-value">{reportedValue}</div>
      </div>
      <Canvas camera={{ position: [0, 3, 0], fov: 50, near: 0.1, far: 100 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 5, 2]} intensity={1} />
        <DieAtOrientation shape={shape} quaternion={quaternion} materials={material} />
      </Canvas>
    </div>
  )
}
```

**Step 2: Add the test route to App.tsx**

Modify `src/App.tsx` — add a route inside `<Routes>` (dev-only):

```tsx
{/* Dev-only test harness for dice face validation */}
<Route path="/test/dice-faces" element={<DiceFaceTestHarness />} />
```

Import at the top:

```tsx
import DiceFaceTestHarness from './components/test/DiceFaceTestHarness'
```

Note: The test harness route does NOT need ThemeProvider/DeviceMotionProvider wrapping since it's a standalone test page. If it causes issues being inside those providers, move it outside or wrap minimally.

**Step 3: Verify the harness loads**

```bash
npm run dev:vite
```

Visit `http://localhost:5173/test/dice-faces?type=d6&face=0` in a browser. Confirm:
- You see a die rendered
- `reported-value` and `expected-value` text overlays are visible
- For d6 face 0: expected value is 1 (bottom face), reported value should also be 1

**Step 4: Verify `reported-value === expected-value` for a few faces manually**

Test these URLs:
- `/test/dice-faces?type=d6&face=5` → expected 6, reported should be 6
- `/test/dice-faces?type=d20&face=0` → expected 1, reported should be 1
- `/test/dice-faces?type=d4&face=0` → expected 1, reported should be 1

If any mismatch: the alignment quaternion logic is wrong — debug before proceeding.

**Step 5: Commit**

```bash
git add src/components/test/DiceFaceTestHarness.tsx src/App.tsx
git commit -m "feat: add dice face test harness for visual validation"
```

---

## Task 3: Audit Face-to-Material Mapping with Unit Tests

**Owner:** mapping-auditor
**Files:**
- Create: `src/lib/faceMaterialMapping.test.ts`
- Modify: `src/lib/faceMaterialMapping.ts` (fix d12 mapping, fix any bugs found)

> **Note:** Use `/using-codex` if the geometry analysis gets complex, especially for d10 and d12.

**Step 1: Write unit tests for mapping verification**

The test strategy: for each dice type, create the geometry, use `generateMaterialMapping()` from `geometryFaceMapper.ts` to compute the actual triangle-to-face mapping, then verify it matches `FACE_MATERIAL_MAPS`.

Create `src/lib/faceMaterialMapping.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  FACE_MATERIAL_MAPS,
  createFaceMaterialsArray,
  getFaceNormals,
} from './faceMaterialMapping'
import { generateMaterialMapping } from './geometryFaceMapper'
import {
  DiceShape,
  createD4Geometry,
  createD6Geometry,
  createD8Geometry,
  createD10Geometry,
  createD12Geometry,
  createD20Geometry,
} from './geometries'

const GEOMETRY_CREATORS: Record<DiceShape, (size?: number) => THREE.BufferGeometry> = {
  d4: createD4Geometry,
  d6: createD6Geometry,
  d8: createD8Geometry,
  d10: createD10Geometry,
  d12: createD12Geometry,
  d20: createD20Geometry,
}

const DICE_TYPES: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

describe('Face Material Mapping', () => {
  describe('FACE_MATERIAL_MAPS completeness', () => {
    for (const shape of DICE_TYPES) {
      it(`${shape} mapping should be non-empty`, () => {
        const mapping = FACE_MATERIAL_MAPS[shape]
        expect(mapping.length).toBeGreaterThan(0)
      })
    }
  })

  describe('Mapping matches geometry triangle normals', () => {
    for (const shape of DICE_TYPES) {
      it(`${shape} material mapping matches geometry analysis`, () => {
        const geometry = GEOMETRY_CREATORS[shape](1)
        const faceNormals = getFaceNormals(shape)
        const computedMapping = generateMaterialMapping(geometry, faceNormals, shape)
        const declaredMapping = FACE_MATERIAL_MAPS[shape]

        // For each face value, check that the declared material index
        // contains a triangle whose computed face value matches
        const faceCount = faceNormals.length
        const startValue = shape === 'd10' ? 0 : 1
        const endValue = shape === 'd10' ? 9 : faceCount

        for (let faceValue = startValue; faceValue <= endValue; faceValue++) {
          const materialIndex = declaredMapping[shape === 'd10' ? faceValue : faceValue]
          expect(materialIndex).toBeDefined()
          expect(materialIndex).not.toBe(-1)

          // The triangle at this material index should map to this face value
          expect(computedMapping[materialIndex]).toBe(faceValue)
        }
      })
    }
  })

  describe('getDiceFaceValue consistency', () => {
    // For each die type and each face, rotate so that face points up (or down for d4),
    // then verify getDiceFaceValue returns the expected value
    for (const shape of DICE_TYPES) {
      const faceNormals = getFaceNormals(shape)
      for (let i = 0; i < faceNormals.length; i++) {
        it(`${shape} face ${faceNormals[i].value}: detection matches when aligned`, () => {
          const face = faceNormals[i]
          const target = shape === 'd4'
            ? new THREE.Vector3(0, -1, 0)
            : new THREE.Vector3(0, 1, 0)

          const quaternion = new THREE.Quaternion()
          quaternion.setFromUnitVectors(face.normal.clone().normalize(), target)

          const { getDiceFaceValue } = require('./geometries')
          const detected = getDiceFaceValue(quaternion, shape)
          expect(detected).toBe(face.value)
        })
      }
    }
  })
})
```

**Step 2: Run the tests**

```bash
npx vitest run src/lib/faceMaterialMapping.test.ts
```

Expected: d12 tests will FAIL (mapping is empty `[]`). Other dice types may also fail if the assumed 1:1 mappings are wrong.

**Step 3: Fix the d12 mapping**

Use `generateMaterialMapping()` to compute the correct d12 mapping from geometry:

```typescript
// Run this in a test or script to determine d12 mapping:
const geometry = createD12Geometry(1)
const faceNormals = D12_FACE_NORMALS
const mapping = generateMaterialMapping(geometry, faceNormals, 'd12')
console.log('D12 computed mapping:', mapping)
```

Then update `FACE_MATERIAL_MAPS.d12` in `src/lib/faceMaterialMapping.ts` with the computed values.

**Step 4: Fix any other mapping mismatches**

For each failing test, compare the computed mapping against the declared mapping and update `FACE_MATERIAL_MAPS` accordingly.

**IMPORTANT:** The `POLYHEDRON_DETAIL_LEVEL = 0` means no subdivision, so triangle count = face count for d4, d8, d20. But verify this — if detail > 0, triangles get subdivided and the mapping logic changes entirely.

**Step 5: Run tests again — all should pass**

```bash
npx vitest run src/lib/faceMaterialMapping.test.ts
```

Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/lib/faceMaterialMapping.test.ts src/lib/faceMaterialMapping.ts
git commit -m "fix: audit and correct face-to-material mappings for all dice types

- Added comprehensive unit tests for all 6 dice types
- Fixed d12 mapping (was empty)
- Verified all mappings against geometry triangle analysis
- Confirmed getDiceFaceValue consistency for all faces"
```

---

## Task 4: Write Unit Tests for getDiceFaceValue Across All Orientations

**Owner:** mapping-auditor
**Files:**
- Modify: `src/lib/geometries.test.ts` (add comprehensive face detection tests)

**Step 1: Add face detection tests for ALL dice types**

The existing `geometries.test.ts` only tests d6. Add tests for d4, d8, d10, d12, d20 — for each face, verify that when the face normal is aligned with the target direction, `getDiceFaceValue` returns the correct value.

Add to `src/lib/geometries.test.ts`:

```typescript
describe('getDiceFaceValue - all dice types', () => {
  const DICE_CONFIGS = [
    { shape: 'd4' as const, normals: D4_FACE_NORMALS, target: new THREE.Vector3(0, -1, 0) },
    { shape: 'd6' as const, normals: D6_FACE_NORMALS, target: new THREE.Vector3(0, 1, 0) },
    { shape: 'd8' as const, normals: D8_FACE_NORMALS, target: new THREE.Vector3(0, 1, 0) },
    { shape: 'd10' as const, normals: D10_FACE_NORMALS, target: new THREE.Vector3(0, 1, 0) },
    { shape: 'd12' as const, normals: D12_FACE_NORMALS, target: new THREE.Vector3(0, 1, 0) },
    { shape: 'd20' as const, normals: D20_FACE_NORMALS, target: new THREE.Vector3(0, 1, 0) },
  ]

  for (const { shape, normals, target } of DICE_CONFIGS) {
    describe(shape, () => {
      for (const face of normals) {
        it(`detects face value ${face.value} when aligned`, () => {
          const quaternion = new THREE.Quaternion()
          quaternion.setFromUnitVectors(face.normal.clone().normalize(), target)
          expect(getDiceFaceValue(quaternion, shape)).toBe(face.value)
        })
      }
    })
  }
})
```

**Step 2: Run the tests**

```bash
npx vitest run src/lib/geometries.test.ts
```

Expected: All 60 tests pass (4+6+8+10+12+20).

**Step 3: Commit**

```bash
git add src/lib/geometries.test.ts
git commit -m "test: add comprehensive face detection tests for all dice types

- 60 tests covering every face of every dice type (d4-d20)
- Verifies getDiceFaceValue returns correct value for each orientation"
```

---

## Task 5: Build Canvas Texture Rendering for Standard Dice

**Owner:** texture-renderer
**Depends on:** Tasks 3-4 complete (verified face mappings)
**Files:**
- Modify: `src/lib/textureRendering.ts` (audit existing, add number orientation support)
- Create: `src/lib/textureRendering.test.ts`

**Step 1: Write tests for texture rendering**

Create `src/lib/textureRendering.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock canvas and context
const mockContext = {
  fillStyle: '',
  font: '',
  textAlign: '',
  textBaseline: '',
  fillRect: vi.fn(),
  fillText: vi.fn(),
  strokeStyle: '',
  lineWidth: 0,
  strokeText: vi.fn(),
  shadowColor: '',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  save: vi.fn(),
  restore: vi.fn(),
}

vi.stubGlobal('document', {
  createElement: vi.fn().mockReturnValue({
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(mockContext),
  }),
})

describe('textureRendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renderSimpleNumber draws number centered on canvas', async () => {
    const { renderSimpleNumber } = await import('./textureRendering')
    renderSimpleNumber(mockContext as any, 6, 256, '#ff6b35')

    expect(mockContext.fillRect).toHaveBeenCalled()
    expect(mockContext.fillText).toHaveBeenCalledWith('6', 128, 128)
    expect(mockContext.textAlign).toBe('center')
    expect(mockContext.textBaseline).toBe('middle')
  })

  it('renderStyledNumber draws number with outline', async () => {
    const { renderStyledNumber } = await import('./textureRendering')
    renderStyledNumber(mockContext as any, 20, 256, '#ff6b35')

    expect(mockContext.strokeText).toHaveBeenCalled()
    expect(mockContext.fillText).toHaveBeenCalledWith('20', 128, 128)
  })

  it('preRenderDiceFaces creates correct number of textures for d6', async () => {
    // This test needs THREE.js mocking — may be complex
    // Focus on verifying the face count and value range
    const { preRenderDiceFaces, renderSimpleNumber } = await import('./textureRendering')
    // Will need proper Three.js CanvasTexture mock
  })
})
```

**Step 2: Run tests to verify existing renderers work**

```bash
npx vitest run src/lib/textureRendering.test.ts
```

**Step 3: Verify the existing `renderStyledNumber` meets our needs**

The existing `renderStyledNumber` already does:
- White text with black outline and drop shadow
- Centered on canvas
- Solid background fill

This matches our design spec (clean white numbers with outline for legibility). **Use this as-is for standard dice** — no changes needed to the renderer itself.

**Step 4: Verify `preRenderDiceFaces` generates correct face counts**

For each dice type, check that `preRenderDiceFaces` creates the right number of textures:
- d4: 4 textures (values 1-4)
- d6: 6 textures (values 1-6)
- d8: 8 textures (values 1-8)
- d10: 10 textures (values 0-9)
- d12: 12 textures (values 1-12)
- d20: 20 textures (values 1-20)

**Step 5: Commit**

```bash
git add src/lib/textureRendering.test.ts
git commit -m "test: add texture rendering unit tests"
```

---

## Task 6: Build D4 Classic-Style Texture Renderer

**Owner:** texture-renderer
**Files:**
- Create: `src/lib/faceRenderers/d4Renderer.ts`
- Create: `src/lib/faceRenderers/d4Renderer.test.ts`

> **Note:** This is the most complex texture task. Use `/using-codex` if the d4 vertex-to-face math gets tricky.

**Step 1: Understand d4 classic numbering**

Classic d4 numbering rules:
- Each triangular face has 3 numbers printed on it, one near each edge
- When face N is on the ground (detected by our down-vector), the value N appears at the TOP vertex of all 3 visible faces
- Each vertex of the tetrahedron is shared by 3 faces
- At each vertex, the number shown is the value of the OPPOSITE face (the face that doesn't touch that vertex)

For a TetrahedronGeometry with `POLYHEDRON_DETAIL_LEVEL = 0`:
- 4 faces, 4 vertices
- Face 0 (value 1): when this is down, vertex opposite to it is at top
- The 3 visible faces each show "1" at their vertex closest to the top

**Numbering layout per face:**
Each face shows 3 numbers — one near each of its 3 edges. The number near each edge is the value of the face on the OTHER side of that edge.

We need to determine the vertex layout of TetrahedronGeometry to know which numbers go where on the texture canvas.

**Step 2: Analyze TetrahedronGeometry vertex layout**

Write a small utility (or use a test) to log the vertices and face assignments:

```typescript
const geo = new THREE.TetrahedronGeometry(1, 0)
const pos = geo.getAttribute('position')
// With detail=0, TetrahedronGeometry is non-indexed with 12 vertices (4 faces x 3 vertices each)
for (let face = 0; face < 4; face++) {
  const v1 = [pos.getX(face*3), pos.getY(face*3), pos.getZ(face*3)]
  const v2 = [pos.getX(face*3+1), pos.getY(face*3+1), pos.getZ(face*3+1)]
  const v3 = [pos.getX(face*3+2), pos.getY(face*3+2), pos.getZ(face*3+2)]
  console.log(`Face ${face}: v1=${v1}, v2=${v2}, v3=${v3}`)
}
```

**Step 3: Determine the number layout for each face**

Based on the geometry analysis:
- For each face, identify which shared vertices connect to which adjacent faces
- Map each vertex position on the canvas (equilateral triangle UV) to the correct number
- The number near each edge = the value of the face sharing that edge

**Step 4: Implement d4 renderer**

Create `src/lib/faceRenderers/d4Renderer.ts`:

```typescript
import type { FaceRenderer } from '../textureRendering'

/**
 * D4 face numbering layout.
 * For each face (index 0-3), lists the 3 numbers to display,
 * positioned near each vertex of the triangle.
 *
 * numbersAtVertices[faceIndex] = [topNumber, bottomLeftNumber, bottomRightNumber]
 *
 * These are determined by analyzing the TetrahedronGeometry vertex layout
 * and the d4 classic numbering convention.
 */
const D4_FACE_NUMBERS: number[][] = [
  // TODO: Fill in after Step 2 geometry analysis
  // Example: [2, 3, 4] means face 0 shows 2 at top vertex, 3 at bottom-left, 4 at bottom-right
]

/**
 * Classic D4 renderer - three numbers per triangular face
 *
 * Each triangular face displays 3 numbers near its edges.
 * When the die lands, the result is read from the number at the
 * top vertex of the 3 visible faces.
 */
export const renderD4Classic: FaceRenderer = (
  ctx,
  faceValue,
  canvasSize,
  backgroundColor,
) => {
  const faceIndex = faceValue - 1 // Convert 1-based value to 0-based index
  const numbers = D4_FACE_NUMBERS[faceIndex]

  // Fill background
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  // Draw triangle background (optional — face shape)
  // The texture maps to a square, so we draw the triangle region

  const fontSize = canvasSize * 0.25
  ctx.font = `bold ${fontSize}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Position numbers near each vertex of the equilateral triangle
  // Triangle vertices on the canvas (matching UV mapping):
  const topX = canvasSize / 2
  const topY = canvasSize * 0.15
  const bottomLeftX = canvasSize * 0.15
  const bottomLeftY = canvasSize * 0.85
  const bottomRightX = canvasSize * 0.85
  const bottomRightY = canvasSize * 0.85

  // Draw each number with outline for legibility
  const drawNumber = (num: number, x: number, y: number) => {
    ctx.strokeStyle = 'black'
    ctx.lineWidth = fontSize * 0.08
    ctx.strokeText(num.toString(), x, y)
    ctx.fillStyle = 'white'
    ctx.fillText(num.toString(), x, y)
  }

  drawNumber(numbers[0], topX, topY)           // Top vertex
  drawNumber(numbers[1], bottomLeftX, bottomLeftY)   // Bottom-left vertex
  drawNumber(numbers[2], bottomRightX, bottomRightY) // Bottom-right vertex
}
```

**Step 5: Write tests**

Create `src/lib/faceRenderers/d4Renderer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
// Test that D4_FACE_NUMBERS contains valid values
// Each face should have 3 numbers, all between 1-4, none equal to the face's own value

describe('D4 Classic Renderer', () => {
  it('each face has 3 numbers that are not the face value itself', () => {
    // Import and validate D4_FACE_NUMBERS
  })

  it('for each vertex shared by 3 faces, all 3 faces show the same number at that vertex', () => {
    // This validates the classic d4 convention:
    // when face N is down, all visible faces show N at the top vertex
  })
})
```

**Step 6: Run tests**

```bash
npx vitest run src/lib/faceRenderers/d4Renderer.test.ts
```

**Step 7: Commit**

```bash
git add src/lib/faceRenderers/d4Renderer.ts src/lib/faceRenderers/d4Renderer.test.ts
git commit -m "feat: add classic d4 renderer with 3 numbers per face"
```

---

## Task 7: Integrate Textures into Dice.tsx

**Owner:** texture-renderer
**Depends on:** Tasks 3-6 complete
**Files:**
- Modify: `src/components/dice/Dice.tsx`
- Modify: `src/hooks/useDiceMaterials.ts` (audit and fix if needed)
- Modify: `src/lib/faceMaterialMapping.ts` (if any fixes needed from integration)

**Step 1: Audit useDiceMaterials hook**

The existing `useDiceMaterials.ts` hook already:
- Creates materials array via `createFaceMaterialsArray()`
- Uses `renderDiceFaceToTexture()` for canvas textures
- Has cleanup logic for texture disposal
- Falls back to solid color on error

**Potential issues to check:**
- Does it work with the verified `FACE_MATERIAL_MAPS`?
- Does the `flatShading: true` on line 96 cause visual artifacts for d6 (which shouldn't use flat shading)?
- Does the d10 special case handle correctly?

**Step 2: Fix useDiceMaterials if needed**

Key fix needed: `flatShading: true` is hardcoded for ALL dice types but should only apply to d10. Update:

```typescript
const material = new THREE.MeshStandardMaterial({
  map: texture,
  roughness,
  metalness,
  flatShading: shape === 'd10',
})
```

Also ensure the d4 renderer is used for d4 instead of `renderSimpleNumber`.

**Step 3: Update Dice.tsx material creation**

Replace the single material with the materials array from `useDiceMaterials`:

In `Dice.tsx`, change the material memo:

```typescript
// OLD:
const material = useMemo(() => {
  const diceMaterials = currentTheme.dice.materials
  const mat = createDiceMaterial(color, ...)
  if (shape === 'd10') { mat.flatShading = true; mat.needsUpdate = true }
  return mat
}, [color, shape, currentTheme.dice.materials])

// NEW:
import { useDiceMaterials } from '../../hooks/useDiceMaterials'
import { renderD4Classic } from '../../lib/faceRenderers/d4Renderer'
import { renderStyledNumber } from '../../lib/textureRendering'

const materials = useDiceMaterials({
  shape,
  color,
  roughness: currentTheme.dice.materials.roughness,
  metalness: currentTheme.dice.materials.metalness,
  emissiveIntensity: currentTheme.dice.materials.emissiveIntensity,
  faceRenderer: shape === 'd4' ? renderD4Classic : renderStyledNumber,
})
```

And in the JSX:

```tsx
// OLD:
<mesh geometry={geometry} material={material} castShadow receiveShadow ... />

// NEW:
<mesh geometry={geometry} material={materials} castShadow receiveShadow ... />
```

Note: Three.js `<mesh>` accepts `material` as either a single material or an array.

**Step 4: Set up geometry material groups**

**CRITICAL:** For polyhedron geometries (d4, d8, d12, d20), Three.js needs `groups` defined on the BufferGeometry to know which triangles use which material. Without groups, the material array is ignored.

For `BoxGeometry` (d6), groups are built-in.
For `TetrahedronGeometry`, `OctahedronGeometry`, `DodecahedronGeometry`, `IcosahedronGeometry` with detail=0, we need to add groups manually.

Add a utility that sets up material groups:

```typescript
function addMaterialGroups(geometry: THREE.BufferGeometry, trianglesPerFace: number = 1) {
  geometry.clearGroups()
  const posAttr = geometry.getAttribute('position')
  const totalTriangles = geometry.index
    ? geometry.index.count / 3
    : posAttr.count / 3

  for (let i = 0; i < totalTriangles; i++) {
    geometry.addGroup(i * 3, 3, i * trianglesPerFace === 0 ? i : i)
  }
}
```

For d10 (20 triangles, 10 faces): each pair of triangles shares a material:
```typescript
// d10: triangles 0-9 are top halves, 10-19 are bottom halves
// Face i uses triangle i and triangle i+10
for (let i = 0; i < 20; i++) {
  geometry.addGroup(i * 3, 3, i) // material index = triangle index
}
```

For d12 (DodecahedronGeometry detail=0): 12 pentagonal faces, each made of 3 triangles = 36 triangles total. Groups need to map each set of 3 triangles to one material.

**Step 5: Verify in dev**

```bash
npm run dev:vite
```

Visit the main app. Spawn different dice and verify:
- Numbers are visible on all faces
- Numbers rotate with the dice
- D4 shows classic 3-number layout
- D10 shows 0-9
- Colors respect the current theme

**Step 6: Verify build**

```bash
npm run build
```

Expected: Clean build, no TypeScript errors.

**Step 7: Commit**

```bash
git add src/components/dice/Dice.tsx src/hooks/useDiceMaterials.ts src/lib/faceMaterialMapping.ts
git commit -m "feat: add visible numbers to all dice faces

- Integrated canvas texture rendering into Dice.tsx
- D4 uses classic 3-number layout
- D6-D20 use centered styled numbers
- Materials array with proper geometry groups
- Theme-reactive: numbers re-render on theme change"
```

---

## Task 8: Write Playwright Visual Validation Tests

**Owner:** playwright-validator
**Depends on:** Tasks 2 and 7 complete
**Files:**
- Modify: `e2e/dice-faces.spec.ts`

**Step 1: Write the comprehensive test suite**

Update `e2e/dice-faces.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

const DICE_TYPES = [
  { type: 'd4', faceCount: 4 },
  { type: 'd6', faceCount: 6 },
  { type: 'd8', faceCount: 8 },
  { type: 'd10', faceCount: 10 },
  { type: 'd12', faceCount: 12 },
  { type: 'd20', faceCount: 20 },
]

for (const { type, faceCount } of DICE_TYPES) {
  test.describe(`${type} face validation`, () => {
    for (let face = 0; face < faceCount; face++) {
      test(`${type} face ${face}: reported value matches expected`, async ({ page }) => {
        await page.goto(`/test/dice-faces?type=${type}&face=${face}`)
        await page.waitForSelector('[data-testid="dice-test-harness"]')

        // Wait for WebGL to render (give it a moment)
        await page.waitForTimeout(2000)

        const expectedValue = await page.locator('[data-testid="expected-value"]').textContent()
        const reportedValue = await page.locator('[data-testid="reported-value"]').textContent()

        expect(reportedValue).toBe(expectedValue)
      })
    }
  })
}

// Screenshot grid for manual visual review
test('generate screenshot grid for all dice faces', async ({ page }) => {
  for (const { type, faceCount } of DICE_TYPES) {
    for (let face = 0; face < faceCount; face++) {
      await page.goto(`/test/dice-faces?type=${type}&face=${face}`)
      await page.waitForSelector('[data-testid="dice-test-harness"]')
      await page.waitForTimeout(2000)

      await page.screenshot({
        path: `e2e/screenshots/${type}-face-${face}.png`,
        fullPage: true,
      })
    }
  }
})
```

**Step 2: Create screenshots directory**

```bash
mkdir -p e2e/screenshots
```

**Step 3: Run the tests**

```bash
npx playwright test e2e/dice-faces.spec.ts --reporter=list
```

Expected: All 60 face tests pass (reported === expected). Screenshots saved for manual review.

**Step 4: Review the screenshot grid**

Manually inspect `e2e/screenshots/` — for each screenshot:
- Verify the 3D die is visible
- Verify a number is rendered on the top-facing surface
- Verify the number matches the `reported-value` overlay

**Step 5: Commit**

```bash
git add e2e/dice-faces.spec.ts e2e/screenshots/.gitkeep
git commit -m "test: add Playwright visual validation for all 60 dice faces

- Tests all faces of d4, d6, d8, d10, d12, d20
- Asserts reported value matches expected value
- Generates screenshot grid for manual visual review"
```

---

## Task 9: Update Test Harness to Show Textured Dice

**Owner:** playwright-validator
**Depends on:** Task 7 complete
**Files:**
- Modify: `src/components/test/DiceFaceTestHarness.tsx`

**Step 1: Update harness to use textured materials**

Replace the solid material in `DiceFaceTestHarness.tsx` with the actual face materials:

```typescript
import { useDiceMaterials } from '../../hooks/useDiceMaterials'
import { renderD4Classic } from '../../lib/faceRenderers/d4Renderer'
import { renderStyledNumber } from '../../lib/textureRendering'

// Inside the component:
const materials = useDiceMaterials({
  shape,
  color: '#ff6b35',
  faceRenderer: shape === 'd4' ? renderD4Classic : renderStyledNumber,
})
```

Pass `materials` to `DieAtOrientation` instead of the solid material.

**Step 2: Re-run Playwright tests**

```bash
npx playwright test e2e/dice-faces.spec.ts --reporter=list
```

Expected: All 60 tests still pass. Screenshots now show numbered dice.

**Step 3: Review updated screenshots**

Re-inspect `e2e/screenshots/` — now the 3D die should show the actual number on the top face. This is the final visual validation:
- Number rendered on the 3D face matches the `reported-value` in the overlay
- Number is readable (white on colored background with outline)
- D4 shows classic 3-number layout

**Step 4: Commit**

```bash
git add src/components/test/DiceFaceTestHarness.tsx
git commit -m "feat: update test harness to render textured dice for visual validation"
```

---

## Post-Implementation Checklist

After all tasks complete:

- [ ] All 60 Playwright face tests pass
- [ ] Screenshot grid reviewed — every face shows correct number
- [ ] D4 classic numbering renders correctly (3 numbers per face)
- [ ] D10 shows 0-9 (not 1-10)
- [ ] Numbers are legible against all theme colors
- [ ] `npm test` passes (all existing tests + new tests)
- [ ] `npm run build` succeeds
- [ ] No console errors in dev
- [ ] Custom dice (`CustomDice.tsx`) still work (untouched)
- [ ] Performance acceptable (no FPS drops from textures)

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/lib/geometries.ts` | Face normals, geometry creators, `getDiceFaceValue()` |
| `src/lib/faceMaterialMapping.ts` | `FACE_MATERIAL_MAPS`, `createFaceMaterialsArray()` |
| `src/lib/geometryFaceMapper.ts` | `generateMaterialMapping()` (geometry analysis) |
| `src/lib/textureRendering.ts` | Canvas texture rendering utilities |
| `src/lib/faceRenderers/d4Renderer.ts` | D4 classic 3-number renderer |
| `src/hooks/useDiceMaterials.ts` | Hook for creating per-face material arrays |
| `src/components/dice/Dice.tsx` | Main dice component (integration target) |
| `src/components/test/DiceFaceTestHarness.tsx` | Test harness for validation |
| `e2e/dice-faces.spec.ts` | Playwright visual validation tests |
| `playwright.config.ts` | Playwright configuration |
