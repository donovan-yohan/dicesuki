# Artist Dice Testing Platform - Architecture & Design

**Version:** 1.0
**Date:** 2025-11-16
**Status:** Design Phase

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [File Format & Technical Specifications](#file-format--technical-specifications)
4. [Upload & Preview System](#upload--preview-system)
5. [Physics Integration](#physics-integration)
6. [Face Detection Integration](#face-detection-integration)
7. [Artist Documentation](#artist-documentation)
8. [Production Workflow](#production-workflow)
9. [Implementation Roadmap](#implementation-roadmap)
10. [Testing Strategy](#testing-strategy)

---

## Executive Summary

### Objective
Create a comprehensive platform for artists to design, upload, preview, and test custom dice models within the Daisu dice simulator, with a streamlined workflow from Blender to production deployment.

### Key Features
- **Upload Interface**: Settings panel for file upload and dice type specification
- **Real-time Preview**: Interactive testing with full physics simulation
- **Face Detection Configuration**: Metadata-driven face normal mapping
- **Artist Documentation**: Complete Blender export guidelines and specifications
- **Production Pipeline**: Seamless integration of approved assets into repository

### Technology Stack
- **3D Format**: glTF 2.0 / GLB (binary glTF)
- **Loader**: Three.js GLTFLoader (already compatible with R3F)
- **Storage**: IndexedDB for temporary preview models
- **Metadata**: Sidecar JSON files for dice configuration

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Artist Workflow                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Blender Export (.glb + metadata.json)                          │
│  - Model geometry                                               │
│  - Materials & textures                                         │
│  - Face normal vectors (in metadata)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Upload System (Settings Panel)                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. File Upload Component                                  │  │
│  │    - Drag & drop .glb file                                │  │
│  │    - Optional metadata.json upload                        │  │
│  │ 2. Dice Type Selector                                     │  │
│  │    - Select: d4, d6, d8, d10, d12, d20                    │  │
│  │ 3. Validation & Parsing                                   │  │
│  │    - File size checks (< 5MB recommended)                 │  │
│  │    - Geometry validation                                  │  │
│  │    - Metadata schema validation                           │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Preview System (DiceScene)                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. Model Loader (GLTFLoader)                              │  │
│  │    - Parse GLB file                                       │  │
│  │    - Extract geometry, materials, textures                │  │
│  │ 2. Physics Integration                                    │  │
│  │    - Map to appropriate collider (hull/cuboid)            │  │
│  │    - Apply dice physics properties                        │  │
│  │ 3. Face Detection                                         │  │
│  │    - Load face normals from metadata                      │  │
│  │    - Register with getDiceFaceValue system                │  │
│  │ 4. Interactive Testing                                    │  │
│  │    - Roll button, drag, throw                             │  │
│  │    - Face value display                                   │  │
│  │    - Performance metrics (FPS, physics stats)             │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Production Pipeline                                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. Asset Storage                                          │  │
│  │    /public/models/dice/{dice-type}/{asset-name}.glb      │  │
│  │    /public/models/dice/{dice-type}/{asset-name}.json     │  │
│  │ 2. Dice Registry                                          │  │
│  │    src/lib/diceAssets.ts - Asset catalog                  │  │
│  │ 3. Theme Integration                                      │  │
│  │    Add custom dice to theme configurations                │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Component Structure

```typescript
src/
├── components/
│   └── panels/
│       └── ArtistTestingPanel.tsx      // Main upload UI
├── lib/
│   ├── diceAssets.ts                   // Asset registry & loader
│   ├── diceModelLoader.ts              // GLB loading utilities
│   └── diceMetadataSchema.ts           // Metadata validation
├── hooks/
│   ├── useCustomDiceLoader.ts          // Load custom dice from GLB
│   └── useAssetValidation.ts           // Validate uploaded files
└── types/
    └── customDice.ts                   // TypeScript interfaces

public/
└── models/
    └── dice/
        ├── d6/
        │   ├── classic-wooden.glb
        │   ├── classic-wooden.json
        │   ├── crystal-blue.glb
        │   └── crystal-blue.json
        ├── d20/
        │   └── ...
        └── documentation/
            └── ARTIST_GUIDE.md          // Artist-facing documentation
```

---

## File Format & Technical Specifications

### Recommended Format: **GLB (Binary glTF 2.0)**

#### Why GLB?

| Feature | GLB | FBX | OBJ | USDZ |
|---------|-----|-----|-----|------|
| **Web-optimized** | ✅ Yes | ❌ No | ⚠️ Limited | ⚠️ Limited |
| **Single file** | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| **Textures embedded** | ✅ Yes | ⚠️ Partial | ❌ No | ✅ Yes |
| **Three.js support** | ✅ Excellent | ⚠️ Via converter | ✅ Basic | ❌ No |
| **File size** | ✅ Small | ❌ Large | ✅ Small | ⚠️ Medium |
| **Material support** | ✅ PBR | ✅ Yes | ❌ Limited | ✅ Yes |
| **Industry standard** | ✅ Yes | ✅ Yes | ⚠️ Legacy | ⚠️ Emerging |

**Decision: GLB** - Industry standard, web-optimized, single-file, excellent Three.js support

### File Specifications

#### Model Requirements

```yaml
Format: glTF 2.0 Binary (.glb)
Max File Size: 5 MB (recommended), 10 MB (hard limit)
Polygon Count:
  - Recommended: 1,000 - 5,000 triangles
  - Maximum: 10,000 triangles
Coordinate System: Y-up, right-handed (Three.js standard)
Scale: 1 unit = 1 meter in-world
Origin: Geometric center of the dice
Materials: PBR (Metallic-Roughness workflow)
Textures:
  - Max resolution: 2048x2048 per texture
  - Formats: PNG, JPEG (embedded in GLB)
  - Recommended: Base Color, Normal, Metallic-Roughness combined
```

#### Metadata JSON Schema

```json
{
  "$schema": "https://dicesuki.com/schemas/dice-metadata-v1.json",
  "version": "1.0",
  "diceType": "d6",
  "name": "Classic Wooden D6",
  "artist": "Artist Name",
  "created": "2025-11-16",
  "scale": 1.0,
  "faceNormals": [
    { "value": 1, "normal": [0, -1, 0] },
    { "value": 2, "normal": [0, 0, 1] },
    { "value": 3, "normal": [1, 0, 0] },
    { "value": 4, "normal": [-1, 0, 0] },
    { "value": 5, "normal": [0, 0, -1] },
    { "value": 6, "normal": [0, 1, 0] }
  ],
  "physics": {
    "mass": 1.0,
    "restitution": 0.3,
    "friction": 0.6
  },
  "colliderType": "roundCuboid",
  "colliderArgs": {
    "halfExtents": [0.5, 0.5, 0.5],
    "borderRadius": 0.08
  }
}
```

### TypeScript Interfaces

```typescript
// src/types/customDice.ts

export interface DiceMetadata {
  version: string
  diceType: DiceShape
  name: string
  artist: string
  created: string
  scale: number
  faceNormals: FaceNormal[]
  physics: PhysicsProperties
  colliderType: ColliderType
  colliderArgs: ColliderArgs
}

export interface FaceNormal {
  value: number
  normal: [number, number, number]
}

export interface PhysicsProperties {
  mass: number
  restitution: number
  friction: number
}

export type ColliderType = 'hull' | 'roundCuboid' | 'cuboid' | 'ball'

export interface ColliderArgs {
  halfExtents?: [number, number, number]
  borderRadius?: number
  radius?: number
}

export interface CustomDiceAsset {
  id: string
  metadata: DiceMetadata
  modelUrl: string
  thumbnailUrl?: string
}
```

---

## Upload & Preview System

### Settings Panel UI Component

```typescript
// src/components/panels/ArtistTestingPanel.tsx

interface ArtistTestingPanelProps {
  onDiceLoaded?: (asset: CustomDiceAsset) => void
}

export function ArtistTestingPanel({ onDiceLoaded }: ArtistTestingPanelProps) {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [metadata, setMetadata] = useState<DiceMetadata | null>(null)
  const [selectedDiceType, setSelectedDiceType] = useState<DiceShape>('d6')
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [previewAsset, setPreviewAsset] = useState<CustomDiceAsset | null>(null)

  return (
    <div className="artist-testing-panel">
      {/* File Upload Area */}
      <FileUploadZone
        accept=".glb"
        onFileSelect={handleFileSelect}
        maxSizeMB={10}
      />

      {/* Metadata Upload (Optional) */}
      <MetadataUpload
        onMetadataSelect={handleMetadataSelect}
      />

      {/* Dice Type Selector */}
      <DiceTypeSelector
        value={selectedDiceType}
        onChange={setSelectedDiceType}
      />

      {/* Auto-generation Option */}
      <AutoGenerateMetadata
        enabled={!metadata}
        diceType={selectedDiceType}
        onGenerate={handleAutoGenerateMetadata}
      />

      {/* Validation Results */}
      {validationErrors.length > 0 && (
        <ValidationErrors errors={validationErrors} />
      )}

      {/* Preview Button */}
      <button
        onClick={handlePreview}
        disabled={!uploadedFile || validationErrors.length > 0}
      >
        Load Preview
      </button>

      {/* Preview Window */}
      {previewAsset && (
        <DicePreviewWindow
          asset={previewAsset}
          onClose={() => setPreviewAsset(null)}
        />
      )}
    </div>
  )
}
```

### File Upload Flow

```
1. User drags .glb file into upload zone
   │
   ▼
2. Validate file
   - Check file extension (.glb)
   - Check file size (< 10MB)
   - Parse GLB header
   │
   ▼
3. Load metadata
   - Option A: User uploads .json file
   - Option B: Auto-generate from dice type
   │
   ▼
4. Validate metadata schema
   - Check required fields
   - Validate face normal count matches dice type
   - Verify physics values in valid ranges
   │
   ▼
5. Store in IndexedDB
   - Create ObjectURL for model
   - Store metadata
   - Generate thumbnail (optional)
   │
   ▼
6. Load into preview scene
   - Create CustomDice component instance
   - Apply physics from metadata
   - Enable interactive testing
```

---

## Physics Integration

### Collider Mapping

Different dice shapes require different physics colliders:

```typescript
// src/lib/diceModelLoader.ts

export function getColliderForDiceType(
  diceType: DiceShape,
  metadata?: DiceMetadata
): ColliderConfig {
  // Use metadata if provided, otherwise use defaults
  if (metadata?.colliderType) {
    return {
      type: metadata.colliderType,
      args: metadata.colliderArgs
    }
  }

  // Default colliders by dice type
  const defaultColliders: Record<DiceShape, ColliderConfig> = {
    'd4': { type: 'hull', args: {} },
    'd6': {
      type: 'roundCuboid',
      args: {
        halfExtents: [0.5, 0.5, 0.5],
        borderRadius: 0.08
      }
    },
    'd8': { type: 'hull', args: {} },
    'd10': { type: 'hull', args: {} },
    'd12': { type: 'hull', args: {} },
    'd20': { type: 'hull', args: {} },
  }

  return defaultColliders[diceType]
}
```

### Custom Dice Component

```typescript
// src/components/dice/CustomDice.tsx

interface CustomDiceProps {
  asset: CustomDiceAsset
  position?: [number, number, number]
  onRest?: (id: string, faceValue: number) => void
}

export const CustomDice = forwardRef<DiceHandle, CustomDiceProps>(
  ({ asset, position = [0, 5, 0], onRest }, ref) => {
    const { scene, materials } = useGLTF(asset.modelUrl)
    const rigidBodyRef = useRef<RapierRigidBody>(null)
    const colliderConfig = getColliderForDiceType(
      asset.metadata.diceType,
      asset.metadata
    )

    // Face detection with custom normals
    const { isAtRest, faceValue, updateMotion, readFaceValue } =
      useFaceDetection(asset.metadata.faceNormals)

    // ... rest of Dice component logic (same as Dice.tsx)

    return (
      <RigidBody
        ref={rigidBodyRef}
        position={position}
        colliders={colliderConfig.type === 'hull' ? 'hull' : false}
        restitution={asset.metadata.physics.restitution}
        friction={asset.metadata.physics.friction}
      >
        {colliderConfig.type === 'roundCuboid' && (
          <RoundCuboidCollider
            args={[
              ...colliderConfig.args.halfExtents,
              colliderConfig.args.borderRadius
            ]}
          />
        )}

        <primitive object={scene} scale={asset.metadata.scale} />
      </RigidBody>
    )
  }
)
```

---

## Face Detection Integration

### Current System

The existing face detection system (`getDiceFaceValue`) uses predefined normal vectors for each dice type:

```typescript
// Current: src/lib/geometries.ts
export const D6_FACE_NORMALS: DiceFace[] = [
  { value: 1, normal: new THREE.Vector3(0, -1, 0) },  // Bottom
  { value: 2, normal: new THREE.Vector3(0, 0, 1) },   // Front
  // ... etc
]
```

### Custom Dice Integration

Extend the system to accept custom face normals:

```typescript
// Enhanced: src/lib/geometries.ts

export function getDiceFaceValue(
  quaternion: THREE.Quaternion,
  shape: DiceShape = 'd6',
  customFaceNormals?: DiceFace[]
): number {
  // Use custom normals if provided, otherwise use defaults
  let faceNormals: DiceFace[]

  if (customFaceNormals) {
    faceNormals = customFaceNormals
  } else {
    // Existing switch statement for default normals
    switch (shape) {
      case 'd4': faceNormals = D4_FACE_NORMALS; break
      case 'd6': faceNormals = D6_FACE_NORMALS; break
      // ... etc
    }
  }

  // Rest of function unchanged
  const targetVector = shape === 'd4'
    ? new THREE.Vector3(0, -1, 0)
    : new THREE.Vector3(0, 1, 0)

  let maxDot = -Infinity
  let faceValue = 1

  for (const face of faceNormals) {
    const rotatedNormal = face.normal.clone().applyQuaternion(quaternion)
    const dot = rotatedNormal.dot(targetVector)

    if (dot > maxDot) {
      maxDot = dot
      faceValue = face.value
    }
  }

  return faceValue
}
```

### Enhanced useFaceDetection Hook

```typescript
// Enhanced: src/hooks/useFaceDetection.ts

export function useFaceDetection(customFaceNormals?: DiceFace[]) {
  const [isAtRest, setIsAtRest] = useState(false)
  const [faceValue, setFaceValue] = useState<number | null>(null)

  const readFaceValue = useCallback(
    (quaternion: THREE.Quaternion, shape: DiceShape) => {
      const value = getDiceFaceValue(quaternion, shape, customFaceNormals)
      setFaceValue(value)
    },
    [customFaceNormals]
  )

  // ... rest of hook unchanged

  return { isAtRest, faceValue, updateMotion, readFaceValue, reset }
}
```

---

## Artist Documentation

### Blender Export Guide

Create comprehensive artist-facing documentation:

```markdown
# Blender to Daisu - Artist Guide

## Quick Start Checklist

- [ ] Model is centered at origin (0, 0, 0)
- [ ] Model is scaled to 1 unit = dice size
- [ ] Model uses Y-up coordinate system
- [ ] Faces are numbered according to dice type conventions
- [ ] Materials use Principled BSDF shader
- [ ] Textures are < 2048x2048
- [ ] Polygon count < 5,000 triangles
- [ ] Exported as GLB (not glTF + bin)

## Step-by-Step Export Process

### 1. Model Preparation

**Scale & Dimensions:**
- D6: 1 unit cube (1m × 1m × 1m)
- D20: 1 unit diameter (circumscribed sphere)
- All dice types: Use reference objects provided

**Origin Point:**
- Set origin to geometric center: Object > Set Origin > Geometry

**Coordinate System:**
- Ensure Y-axis points up
- Check: Properties > Scene > Units > Length (Metric)

### 2. Face Numbering Convention

**D6 (Cube):**
```
Face 1: Bottom (-Y)
Face 2: Front (+Z)
Face 3: Right (+X)
Face 4: Left (-X)
Face 5: Back (-Z)
Face 6: Top (+Y)

Opposite faces sum to 7: (1,6), (2,5), (3,4)
```

**D20 (Icosahedron):**
```
Face 1: Bottom (-Y)
Face 12: Top (+Y)
Faces 2-11: Middle band (see template)
Faces 13-20: Equator (see template)

Reference: public/models/documentation/d20-face-map.png
```

### 3. Material Setup

**Principled BSDF Settings:**
- Base Color: Use texture or solid color
- Metallic: 0.0 - 0.3 (most dice are non-metallic)
- Roughness: 0.3 - 0.8 (0.6 for plastic dice)
- Normal Map: Optional, for surface detail

**Texture Best Practices:**
- Use UV unwrapping for optimal texture placement
- Bake ambient occlusion for realism
- Embed textures in GLB on export

### 4. Geometry Optimization

**Polygon Count:**
- Use modifier stack: Decimate > Ratio: 0.5 if too dense
- Target: 2,000 - 4,000 triangles for web performance

**Clean Mesh:**
- Mesh > Clean Up > Delete Loose
- Mesh > Normals > Recalculate Outside
- Remove doubles: Merge by Distance (0.001)

### 5. Export Settings

**File > Export > glTF 2.0 (.glb / .gltf)**

**Include:**
- ✅ Selected Objects (or Active Scene)
- ✅ Custom Properties
- ✅ Cameras (if reference needed)

**Transform:**
- ✅ +Y Up
- ✅ Apply Modifiers
- ✅ Apply Transform

**Geometry:**
- ✅ UVs
- ✅ Normals
- ✅ Vertex Colors (if used)
- ❌ Tangents (auto-generated)
- ✅ Materials: Export
- ✅ Images: Embedded

**Animation:** (Uncheck all - static dice only)

**Format:**
- ✅ GLB (Binary .glb)

### 6. Metadata Creation

Use the metadata generator tool at:
`https://dicesuki.com/tools/metadata-generator`

Or manually create `{dice-name}.json`:

```json
{
  "version": "1.0",
  "diceType": "d6",
  "name": "My Custom D6",
  "artist": "Your Name",
  "created": "2025-11-16",
  "scale": 1.0,
  "faceNormals": [
    { "value": 1, "normal": [0, -1, 0] },
    { "value": 2, "normal": [0, 0, 1] },
    { "value": 3, "normal": [1, 0, 0] },
    { "value": 4, "normal": [-1, 0, 0] },
    { "value": 5, "normal": [0, 0, -1] },
    { "value": 6, "normal": [0, 1, 0] }
  ],
  "physics": {
    "mass": 1.0,
    "restitution": 0.3,
    "friction": 0.6
  },
  "colliderType": "roundCuboid",
  "colliderArgs": {
    "halfExtents": [0.5, 0.5, 0.5],
    "borderRadius": 0.08
  }
}
```

### 7. Testing in Daisu

1. Open Daisu app: Settings > Artist Testing
2. Upload your `.glb` file
3. Select dice type (d6, d20, etc.)
4. Upload metadata `.json` (or auto-generate)
5. Click "Load Preview"
6. Test rolling, dragging, physics
7. Verify face detection is accurate

### 8. Troubleshooting

**Model appears too large/small:**
- Check scale in Blender: 1 unit = 1 meter
- Adjust `scale` property in metadata JSON

**Faces not detected correctly:**
- Verify face normal vectors in metadata
- Use Blender: Mesh > Normals > Show Face Normals
- Match normals to face numbering convention

**Textures not showing:**
- Ensure textures are embedded in GLB
- Check material uses Principled BSDF
- Verify texture resolution < 2048x2048

**Physics feels wrong:**
- Adjust `restitution` (bounciness): 0.2-0.4
- Adjust `friction`: 0.5-0.7
- Test with different values in metadata

## Reference Assets

Download starter templates:
- Blender scene with all dice types: `dice-templates.blend`
- Face numbering diagrams: `public/models/documentation/`
- Example GLB files: `public/models/dice/examples/`

## Support

Questions? Join our Discord: https://discord.gg/dicesuki
Report issues: https://github.com/dicesuki/issues
```

---

## Production Workflow

### Adding Finalized Assets to Repository

#### 1. Directory Structure

```
public/models/dice/
├── d4/
│   ├── classic-red.glb
│   ├── classic-red.json
│   ├── crystal-clear.glb
│   └── crystal-clear.json
├── d6/
│   ├── wooden-oak.glb
│   ├── wooden-oak.json
│   ├── metal-steel.glb
│   └── metal-steel.json
├── d8/
├── d10/
├── d12/
├── d20/
├── documentation/
│   ├── ARTIST_GUIDE.md
│   ├── face-numbering-d6.png
│   ├── face-numbering-d20.png
│   └── blender-export-settings.png
└── templates/
    └── dice-templates.blend
```

#### 2. Asset Registry

```typescript
// src/lib/diceAssets.ts

export interface DiceAssetCatalog {
  [diceType: string]: {
    [assetId: string]: CustomDiceAsset
  }
}

export const DICE_ASSETS: DiceAssetCatalog = {
  d6: {
    'wooden-oak': {
      id: 'wooden-oak',
      metadata: {
        version: '1.0',
        diceType: 'd6',
        name: 'Wooden Oak D6',
        artist: 'Daisu Team',
        created: '2025-11-16',
        scale: 1.0,
        faceNormals: D6_FACE_NORMALS.map(fn => ({
          value: fn.value,
          normal: fn.normal.toArray() as [number, number, number]
        })),
        physics: {
          mass: 1.0,
          restitution: 0.25,
          friction: 0.7
        },
        colliderType: 'roundCuboid',
        colliderArgs: {
          halfExtents: [0.5, 0.5, 0.5],
          borderRadius: 0.08
        }
      },
      modelUrl: '/models/dice/d6/wooden-oak.glb',
      thumbnailUrl: '/models/dice/d6/wooden-oak-thumb.png'
    },
    // ... more d6 assets
  },
  d20: {
    // ... d20 assets
  }
}

// Utility functions
export function getAssetById(
  diceType: DiceShape,
  assetId: string
): CustomDiceAsset | undefined {
  return DICE_ASSETS[diceType]?.[assetId]
}

export function getAllAssetsForType(
  diceType: DiceShape
): CustomDiceAsset[] {
  return Object.values(DICE_ASSETS[diceType] || {})
}

export function useAssetLoader(assetId: string, diceType: DiceShape) {
  const asset = useMemo(
    () => getAssetById(diceType, assetId),
    [assetId, diceType]
  )

  const { scene } = useGLTF(asset?.modelUrl || '')

  return { asset, scene }
}
```

#### 3. Integration with Theme System

```typescript
// src/themes/tokens.ts (enhanced)

export interface ThemeTokens {
  // ... existing theme properties

  customDice?: {
    d6?: string  // Asset ID to use for d6
    d20?: string // Asset ID to use for d20
    // ... other dice types
  }
}

// Example theme with custom dice
export const THEME_FOREST: ThemeTokens = {
  id: 'forest',
  name: 'Forest Clearing',
  // ... other properties

  customDice: {
    d6: 'wooden-oak',
    d20: 'wooden-oak'
  }
}
```

#### 4. Automated Asset Pipeline (Optional)

```bash
# scripts/import-dice-asset.sh

#!/bin/bash
# Usage: ./scripts/import-dice-asset.sh <glb-file> <json-file> <dice-type>

GLB_FILE=$1
JSON_FILE=$2
DICE_TYPE=$3

# Validate inputs
if [ ! -f "$GLB_FILE" ] || [ ! -f "$JSON_FILE" ]; then
  echo "Error: Files not found"
  exit 1
fi

# Extract asset name from filename
ASSET_NAME=$(basename "$GLB_FILE" .glb)

# Validate dice type
VALID_TYPES=("d4" "d6" "d8" "d10" "d12" "d20")
if [[ ! " ${VALID_TYPES[@]} " =~ " ${DICE_TYPE} " ]]; then
  echo "Error: Invalid dice type. Must be d4, d6, d8, d10, d12, or d20"
  exit 1
fi

# Copy files to public directory
DEST_DIR="public/models/dice/$DICE_TYPE"
mkdir -p "$DEST_DIR"
cp "$GLB_FILE" "$DEST_DIR/$ASSET_NAME.glb"
cp "$JSON_FILE" "$DEST_DIR/$ASSET_NAME.json"

# Generate thumbnail (requires @gltf-transform/cli)
npx gltf-transform view "$DEST_DIR/$ASSET_NAME.glb" \
  --screenshot "$DEST_DIR/$ASSET_NAME-thumb.png" \
  --resolution 512 512

# Update asset registry
node scripts/update-asset-registry.js "$DICE_TYPE" "$ASSET_NAME"

echo "✅ Asset imported successfully!"
echo "   Model: $DEST_DIR/$ASSET_NAME.glb"
echo "   Metadata: $DEST_DIR/$ASSET_NAME.json"
echo "   Thumbnail: $DEST_DIR/$ASSET_NAME-thumb.png"
```

---

## Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1-2)

**Goals:**
- Set up file upload system
- Implement GLB loader
- Create metadata schema and validation

**Tasks:**
1. Create `ArtistTestingPanel.tsx` component
2. Implement `FileUploadZone` with drag & drop
3. Add GLTFLoader integration for R3F
4. Define TypeScript interfaces (`customDice.ts`)
5. Create metadata JSON schema
6. Implement validation utilities
7. Set up IndexedDB storage for preview models

**Deliverables:**
- Working upload interface in Settings panel
- File validation with error messaging
- Metadata schema v1.0

---

### Phase 2: Preview & Physics Integration (Week 2-3)

**Goals:**
- Load custom dice into preview scene
- Integrate with existing physics system
- Support face detection with custom normals

**Tasks:**
1. Create `CustomDice.tsx` component
2. Extend `getDiceFaceValue` to accept custom normals
3. Update `useFaceDetection` hook for custom dice
4. Implement collider mapping system
5. Add physics property overrides from metadata
6. Create preview testing environment

**Deliverables:**
- Interactive custom dice preview
- Full physics simulation with custom models
- Accurate face detection

---

### Phase 3: Artist Documentation (Week 3-4)

**Goals:**
- Create comprehensive Blender guide
- Provide reference assets and templates
- Build metadata generator tool

**Tasks:**
1. Write `ARTIST_GUIDE.md` (detailed export instructions)
2. Create Blender scene templates for all dice types
3. Generate face numbering diagrams
4. Build web-based metadata generator tool
5. Record video tutorials (optional)
6. Create example GLB files for each dice type

**Deliverables:**
- Complete artist documentation
- Blender starter templates
- Metadata generator web tool

---

### Phase 4: Production Pipeline (Week 4-5)

**Goals:**
- Set up asset storage structure
- Create asset registry system
- Integrate with theme system

**Tasks:**
1. Create `public/models/dice/` directory structure
2. Implement `diceAssets.ts` registry
3. Build asset loader hooks
4. Integrate custom dice with `ThemeTokens`
5. Create asset import script (`import-dice-asset.sh`)
6. Add asset management utilities

**Deliverables:**
- Production-ready asset pipeline
- Theme integration for custom dice
- Automated import scripts

---

### Phase 5: Testing & Polish (Week 5-6)

**Goals:**
- Comprehensive testing of all features
- Performance optimization
- User feedback integration

**Tasks:**
1. Write unit tests for upload system
2. Test all dice types with custom models
3. Performance profiling (FPS, memory)
4. Cross-browser testing (Chrome, Safari, Firefox)
5. Mobile testing (iOS, Android)
6. Gather artist feedback and iterate
7. Documentation improvements

**Deliverables:**
- 100% test coverage for new features
- Performance benchmarks
- Polished user experience

---

## Testing Strategy

### Unit Tests

```typescript
// src/lib/diceModelLoader.test.ts

describe('diceModelLoader', () => {
  describe('validateGLBFile', () => {
    it('should accept valid GLB files', async () => {
      const file = new File([mockGLBData], 'test.glb', {
        type: 'model/gltf-binary'
      })
      const result = await validateGLBFile(file)
      expect(result.isValid).toBe(true)
    })

    it('should reject files over size limit', async () => {
      const largeFile = new File([new ArrayBuffer(11 * 1024 * 1024)], 'large.glb')
      const result = await validateGLBFile(largeFile)
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('File size exceeds')
    })
  })

  describe('validateMetadata', () => {
    it('should validate correct face normal count for D6', () => {
      const metadata: DiceMetadata = {
        version: '1.0',
        diceType: 'd6',
        faceNormals: Array(6).fill({ value: 1, normal: [0, 1, 0] }),
        // ... other fields
      }
      expect(validateMetadata(metadata)).toBe(true)
    })

    it('should reject incorrect face count', () => {
      const metadata: DiceMetadata = {
        version: '1.0',
        diceType: 'd6',
        faceNormals: Array(4).fill({ value: 1, normal: [0, 1, 0] }),
        // ... other fields
      }
      expect(validateMetadata(metadata)).toBe(false)
    })
  })
})
```

### Integration Tests

```typescript
// src/components/panels/ArtistTestingPanel.test.tsx

describe('ArtistTestingPanel', () => {
  it('should upload and preview custom dice', async () => {
    const { getByText, getByLabelText } = render(<ArtistTestingPanel />)

    const fileInput = getByLabelText('Upload GLB')
    const glbFile = new File([mockGLBData], 'custom-d6.glb', {
      type: 'model/gltf-binary'
    })

    await userEvent.upload(fileInput, glbFile)

    const previewButton = getByText('Load Preview')
    await userEvent.click(previewButton)

    await waitFor(() => {
      expect(getByText('Preview loaded')).toBeInTheDocument()
    })
  })
})
```

### Performance Testing

```typescript
// Performance benchmarks

describe('Custom Dice Performance', () => {
  it('should maintain 60fps with custom dice', async () => {
    const { result } = renderHook(() => useCustomDice(mockAsset))

    const frameTimings: number[] = []
    for (let i = 0; i < 100; i++) {
      const start = performance.now()
      act(() => {
        result.current.roll()
      })
      const end = performance.now()
      frameTimings.push(end - start)
    }

    const avgFrameTime = frameTimings.reduce((a, b) => a + b) / frameTimings.length
    expect(avgFrameTime).toBeLessThan(16.67) // 60fps = 16.67ms per frame
  })

  it('should load GLB files in under 1 second', async () => {
    const start = performance.now()
    await loadGLBAsset('/models/test-d6.glb')
    const end = performance.now()

    expect(end - start).toBeLessThan(1000)
  })
})
```

---

## Appendix

### A. Required Dependencies

```json
{
  "dependencies": {
    "@react-three/drei": "^10.7.7",        // Already installed
    "@react-three/fiber": "^9.4.0",        // Already installed
    "three": "^0.162.0",                   // Already installed
    "idb": "^8.0.0"                        // NEW: IndexedDB wrapper
  },
  "devDependencies": {
    "@gltf-transform/cli": "^4.0.0",       // NEW: GLB processing
    "@gltf-transform/core": "^4.0.0",      // NEW: GLB utilities
    "ajv": "^8.12.0"                       // NEW: JSON schema validation
  }
}
```

### B. Metadata Schema (JSON Schema)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://dicesuki.com/schemas/dice-metadata-v1.json",
  "title": "Daisu Custom Dice Metadata",
  "type": "object",
  "required": ["version", "diceType", "name", "faceNormals", "physics"],
  "properties": {
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+$",
      "description": "Schema version (e.g., '1.0')"
    },
    "diceType": {
      "type": "string",
      "enum": ["d4", "d6", "d8", "d10", "d12", "d20"],
      "description": "Type of dice"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100,
      "description": "Display name of the dice"
    },
    "artist": {
      "type": "string",
      "description": "Artist or creator name"
    },
    "created": {
      "type": "string",
      "format": "date",
      "description": "Creation date (YYYY-MM-DD)"
    },
    "scale": {
      "type": "number",
      "minimum": 0.1,
      "maximum": 10,
      "default": 1.0,
      "description": "Scale multiplier for the model"
    },
    "faceNormals": {
      "type": "array",
      "description": "Face normal vectors for each dice face",
      "items": {
        "type": "object",
        "required": ["value", "normal"],
        "properties": {
          "value": {
            "type": "integer",
            "minimum": 0,
            "description": "Face value (number on the face)"
          },
          "normal": {
            "type": "array",
            "description": "Outward normal vector [x, y, z]",
            "items": { "type": "number" },
            "minItems": 3,
            "maxItems": 3
          }
        }
      }
    },
    "physics": {
      "type": "object",
      "required": ["mass", "restitution", "friction"],
      "properties": {
        "mass": {
          "type": "number",
          "minimum": 0.1,
          "maximum": 100,
          "default": 1.0
        },
        "restitution": {
          "type": "number",
          "minimum": 0,
          "maximum": 1,
          "default": 0.3,
          "description": "Bounciness (0 = no bounce, 1 = perfect bounce)"
        },
        "friction": {
          "type": "number",
          "minimum": 0,
          "maximum": 2,
          "default": 0.6,
          "description": "Surface friction coefficient"
        }
      }
    },
    "colliderType": {
      "type": "string",
      "enum": ["hull", "roundCuboid", "cuboid", "ball"],
      "default": "hull",
      "description": "Physics collider shape"
    },
    "colliderArgs": {
      "type": "object",
      "description": "Collider-specific parameters",
      "properties": {
        "halfExtents": {
          "type": "array",
          "items": { "type": "number" },
          "minItems": 3,
          "maxItems": 3
        },
        "borderRadius": {
          "type": "number",
          "minimum": 0
        },
        "radius": {
          "type": "number",
          "minimum": 0
        }
      }
    }
  }
}
```

### C. Face Normal Reference

#### D6 (Standard Numbering)
```
Top (6):     [0, 1, 0]
Bottom (1):  [0, -1, 0]
Front (2):   [0, 0, 1]
Back (5):    [0, 0, -1]
Right (3):   [1, 0, 0]
Left (4):    [-1, 0, 0]

Opposite faces sum to 7
```

#### D20 (Standard Numbering)
```
Top (12):    [0, 1, 0]
Bottom (1):  [0, -1, 0]

See full D20 face map at:
public/models/documentation/d20-face-normals.json
```

### D. Future Enhancements

1. **Asset Marketplace**
   - Community-submitted custom dice
   - Rating and review system
   - Featured artists showcase

2. **Advanced Editor**
   - In-app model viewer with normal visualization
   - Face numbering helper overlay
   - Automatic face normal detection (AI-based)

3. **Animation Support**
   - Idle animations (sparkles, glow)
   - Roll animations (trail effects)
   - Impact effects (particles)

4. **Material Editor**
   - In-app material tweaking
   - Real-time shader adjustments
   - Material presets library

5. **Batch Operations**
   - Import multiple dice at once
   - Bulk metadata generation
   - Automated thumbnail creation

---

**Document Version:** 1.0
**Last Updated:** 2025-11-16
**Authors:** Claude + Daisu Development Team
**Status:** Ready for Implementation
