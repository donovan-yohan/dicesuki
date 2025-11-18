# Artist Dice Testing Platform - Implementation Guide

**Status:** ✅ Phases 1-2 Complete, Ready for Testing
**Date:** 2025-11-16

---

## 📋 Overview

The **Artist Dice Testing Platform** allows artists to create custom dice in Blender, upload them to the Daisu simulator, and test them with full physics and face detection before production deployment.

**Current Status:**
- ✅ Core system fully implemented
- ✅ Preview system with full physics
- ✅ Custom face detection working
- ✅ Integrated into Settings panel
- ✅ Artist documentation created

---

## 🎯 Quick Access

**For Artists:**
- 📖 **Artist Guide:** `public/artist-resources/documentation/ARTIST_GUIDE.md`
- 🎨 **Blender Templates:** `public/artist-resources/templates/generate_dice_templates.py`

**For Developers:**
- 📘 **Technical Design:** `docs/ARTIST_PLATFORM_DESIGN.md`
- 💻 **Source Code:** See "Implementation Files" below

**How to Test:**
1. Open Daisu app
2. Settings → Developer Tools → Artist Testing Platform
3. Upload a `.glb` file and test!

---

## 📦 Implementation Files

### Core System

**Type Definitions:**
- `src/types/customDice.ts` - TypeScript interfaces for custom dice

**Utilities:**
- `src/lib/diceMetadataSchema.ts` - Validation utilities
- `src/lib/diceMetadataGenerator.ts` - Metadata auto-generation

**Components:**
- `src/components/dice/CustomDice.tsx` - Custom GLB dice component (430 lines)
- `src/components/panels/ArtistTestingPanel.tsx` - Upload interface
- `src/components/panels/DicePreviewScene.tsx` - 3D testing environment (250 lines)

**Hooks:**
- `src/hooks/useCustomDiceLoader.ts` - GLB loading hook
- `src/hooks/useFaceDetection.ts` - Extended with custom normals support

**Enhanced Systems:**
- `src/lib/geometries.ts` - Extended `getDiceFaceValue()` with custom normals

---

## 🎯 Key Design Decisions

### File Format: **GLB (Binary glTF 2.0)**

**Why GLB?**
- ✅ Web-optimized, single-file format
- ✅ Excellent Three.js/React Three Fiber support
- ✅ Embedded textures and materials
- ✅ Industry standard (Khronos Group)
- ✅ Small file sizes with compression

**Specifications:**
- Max file size: 10 MB (5 MB recommended)
- Polygon count: 1,000-5,000 triangles (10,000 max)
- Coordinate system: Y-up, right-handed
- Scale: 1 unit = 1 meter
- Materials: PBR (Metallic-Roughness)
- Textures: ≤ 2048×2048, embedded

### Metadata Format: **JSON Sidecar**

Artists provide (or auto-generate) a `.json` file alongside the `.glb` file containing:
- Dice type and basic info
- Face normal vectors (for face detection)
- Physics properties (mass, friction, bounciness)
- Collider configuration
- Custom tags and metadata

**Example:**
```json
{
  "version": "1.0",
  "diceType": "d6",
  "name": "Wooden Oak D6",
  "artist": "Jane Artist",
  "created": "2025-11-16",
  "scale": 1.0,
  "faceNormals": [
    { "value": 1, "normal": [0, -1, 0] },
    { "value": 2, "normal": [0, 0, 1] },
    ...
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

### Upload & Preview Workflow

```
1. Artist creates dice in Blender
   ↓
2. Export as .glb with proper settings
   ↓
3. Open Daisu → Settings → Artist Testing
   ↓
4. Upload .glb file (drag & drop or browse)
   ↓
5. Select dice type (d4, d6, d8, d10, d12, d20)
   ↓
6. Either:
   - Upload metadata.json
   - Auto-generate metadata
   ↓
7. System validates file & metadata
   ↓
8. Load preview → Test with full physics
   ↓
9. Verify face detection works correctly
   ↓
10. Download finalized files for production
```

### Face Detection Integration

The existing `getDiceFaceValue()` function is extended to accept custom face normals:

```typescript
// Before (hardcoded normals)
getDiceFaceValue(quaternion, 'd6')

// After (custom normals)
getDiceFaceValue(quaternion, 'd6', customFaceNormals)
```

Artists define face normals in the metadata, which the system uses instead of defaults.

---

## 🚀 Quick Start Guide

### For Developers

#### 1. Install Additional Dependencies

```bash
npm install idb ajv
npm install --save-dev @gltf-transform/cli @gltf-transform/core
```

#### 2. Integrate Artist Testing Panel

Add to your settings/panels UI:

```typescript
import { ArtistTestingPanel } from './components/panels/ArtistTestingPanel'

function SettingsPanel() {
  const [showArtistPanel, setShowArtistPanel] = useState(false)

  return (
    <div>
      {/* Other settings... */}

      <button onClick={() => setShowArtistPanel(true)}>
        Artist Testing Platform
      </button>

      {showArtistPanel && (
        <ArtistTestingPanel
          onDiceLoaded={(asset) => {
            console.log('Custom dice loaded:', asset)
            // TODO: Render custom dice in preview scene
          }}
          onClose={() => setShowArtistPanel(false)}
        />
      )}
    </div>
  )
}
```

#### 3. Create Preview Scene Component

You'll need to create `CustomDice.tsx` component (similar to existing `Dice.tsx`) that:
- Loads GLB models with `useGLTF` hook
- Applies custom physics from metadata
- Uses custom face normals for detection
- Renders with `<primitive object={scene} />` for GLB models

See design document section "Custom Dice Component" for details.

#### 4. Set Up Asset Storage

Create production asset directories:

```bash
mkdir -p public/models/dice/{d4,d6,d8,d10,d12,d20,documentation,templates}
```

### For Artists

#### 1. Download Templates

- Blender scene templates (TODO: create these)
- Face numbering reference diagrams
- Example dice with metadata

#### 2. Follow Export Guide

See **ARTIST_PLATFORM_DESIGN.md** → "Artist Documentation" → "Blender Export Guide" for detailed step-by-step instructions.

**Quick checklist:**
- ✅ Model centered at origin
- ✅ Scaled to 1 unit
- ✅ Y-up coordinate system
- ✅ Clean geometry (< 5k triangles)
- ✅ PBR materials
- ✅ Export as GLB (not glTF + bin)

#### 3. Test in Daisu

1. Open Daisu app
2. Go to Settings → Artist Testing
3. Upload your `.glb` file
4. Select dice type
5. Auto-generate or upload metadata
6. Load preview and test!

---

## 📊 Implementation Status

### ✅ Phase 1: Core Infrastructure (Complete)
- ✅ TypeScript interfaces defined
- ✅ Validation utilities created
- ✅ Metadata generator implemented
- ✅ UI component created with drag & drop
- ✅ File upload system integrated
- ✅ Blob URL lifecycle management

### ✅ Phase 2: Preview & Physics (Complete)
- ✅ `CustomDice.tsx` component created (430 lines)
- ✅ `getDiceFaceValue()` extended for custom normals
- ✅ `useFaceDetection()` hook updated
- ✅ `useCustomDiceLoader()` hook created
- ✅ Collider mapping implemented
- ✅ Full preview testing environment built
- ✅ Integrated into Settings panel

### 📝 Phase 3: Artist Documentation (In Progress)
- ✅ Complete Blender export guide created
- ✅ Blender template generator script (Python)
- ⏳ Create actual .blend template file
- ⏳ Generate reference diagrams (face numbering)
- ⏳ Build metadata generator web tool (optional)
- ⏳ Record video tutorials (optional)

### ⏳ Phase 4: Production Pipeline (Planned)
- ⏳ Set up asset directory structure
- ⏳ Create asset registry system
- ⏳ Theme integration
- ⏳ Import automation scripts

### ⏳ Phase 5: Testing & Polish (Planned)
- ⏳ Unit tests for new components
- ⏳ Integration tests for upload flow
- ⏳ Performance benchmarks
- ⏳ Cross-browser testing
- ⏳ Artist feedback & iteration

---

## 🎨 Artist Resources

All artist-facing materials are in `public/artist-resources/`:

```
public/artist-resources/
├── documentation/
│   └── ARTIST_GUIDE.md        ← Complete non-technical guide
├── templates/
│   └── generate_dice_templates.py  ← Blender script to generate all dice types
└── examples/                   ← (Coming soon) Example GLB files
```

---

## 🚀 Next Steps

### For Phase 3 (Artist Documentation)
1. **Create .blend template file** - Run the Python script in Blender to generate, then save as `.blend`
2. **Generate face numbering diagrams** - Visual references showing number placement for each dice type
3. **Add example GLB files** - Sample dice models artists can reference

### For Phase 4 (Production Pipeline)
1. **Asset registry** - Create `src/lib/diceAssets.ts` for managing production dice
2. **Theme integration** - Allow custom dice to be selected in theme system
3. **Directory structure** - Set up `/public/models/dice/` with organized folders

### For Phase 5 (Testing & Polish)
1. **Unit tests** - Test validation, metadata generation, and loader hooks
2. **Integration tests** - Test full upload → preview → validation flow
3. **Performance testing** - Verify 60fps with custom models
4. **Cross-platform testing** - Test on iOS, Android, desktop browsers

---

## 🧪 Testing Strategy

### Unit Tests

Test all validation and metadata generation:

```typescript
describe('validateMetadata', () => {
  it('should validate correct D6 metadata', () => {
    const metadata = generateDefaultMetadata('d6')
    const result = validateMetadata(metadata)
    expect(result.isValid).toBe(true)
  })

  it('should reject metadata with wrong face count', () => {
    const metadata = { ...generateDefaultMetadata('d6') }
    metadata.faceNormals = metadata.faceNormals.slice(0, 4) // Only 4 faces
    const result = validateMetadata(metadata)
    expect(result.isValid).toBe(false)
  })
})
```

### Integration Tests

Test upload → validation → preview flow:

```typescript
describe('ArtistTestingPanel', () => {
  it('should complete full upload workflow', async () => {
    const { getByText, getByLabelText } = render(<ArtistTestingPanel />)

    // Upload file
    const fileInput = getByLabelText('Upload GLB')
    await userEvent.upload(fileInput, mockGLBFile)

    // Auto-generate metadata
    const generateBtn = getByText('Generate Metadata')
    await userEvent.click(generateBtn)

    // Load preview
    const previewBtn = getByText('Load Preview')
    expect(previewBtn).not.toBeDisabled()
    await userEvent.click(previewBtn)

    // Verify callback
    expect(mockOnDiceLoaded).toHaveBeenCalled()
  })
})
```

### Performance Tests

Ensure smooth rendering with custom models:

```typescript
describe('CustomDice Performance', () => {
  it('should maintain 60fps with custom dice', async () => {
    const asset = createMockAsset()
    const { result } = renderHook(() => useCustomDice(asset))

    const frameTimings = measureFrameTimings(100)
    const avgFrameTime = average(frameTimings)

    expect(avgFrameTime).toBeLessThan(16.67) // 60fps
  })
})
```

---

## 📚 Reference Materials

### File Specifications

- **GLB Format:** [Khronos glTF 2.0 Spec](https://www.khronos.org/gltf/)
- **PBR Materials:** [glTF PBR Materials Guide](https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/README.md#materials)
- **Three.js Loader:** [GLTFLoader Docs](https://threejs.org/docs/#examples/en/loaders/GLTFLoader)

### Blender Resources

- **Blender Export:** [Blender glTF 2.0 Export](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html)
- **PBR Workflow:** [Blender PBR Guide](https://docs.blender.org/manual/en/latest/render/shader_nodes/shader/principled.html)

### Physics Documentation

- **Rapier Physics:** [Rapier.rs Docs](https://rapier.rs/docs/)
- **React Three Rapier:** [@react-three/rapier Docs](https://github.com/pmndrs/react-three-rapier)

---

## 💡 Tips & Best Practices

### For Developers

1. **Validation First:** Always validate files before processing
2. **Memory Management:** Revoke blob URLs when components unmount
3. **Error Handling:** Provide clear, actionable error messages
4. **Performance:** Use Web Workers for heavy file parsing (optional enhancement)
5. **Accessibility:** Ensure keyboard navigation and screen reader support

### For Artists

1. **Start Simple:** Begin with basic geometry, add details later
2. **Test Early:** Upload and test frequently during development
3. **Optimize Textures:** Use texture atlasing, compress images
4. **Clean Geometry:** Remove doubles, recalculate normals
5. **Document Changes:** Keep notes on material settings, face numbering

---

## 🐛 Troubleshooting

### Common Issues

**Issue:** "GLB file validation failed"
- Check file is actually GLB format (not .blend renamed)
- Ensure exported from Blender with correct settings
- Try re-exporting with "Apply Modifiers" enabled

**Issue:** "Face detection not working"
- Verify face normal vectors match face numbering
- Use Blender's "Show Face Normals" to visualize
- Check coordinate system is Y-up

**Issue:** "Physics feels wrong"
- Adjust restitution (bounciness) in metadata
- Try different collider types (hull vs roundCuboid)
- Check mass is set to 1.0 (standard)

**Issue:** "Model appears too large/small"
- Adjust `scale` property in metadata
- Re-export from Blender at correct size (1 unit)
- Apply transforms in Blender before export

---

## 🤝 Contributing

### Adding New Features

1. Follow existing code patterns and conventions
2. Write tests for all new functionality
3. Update documentation (this file and design doc)
4. Submit PR with clear description

### Improving Documentation

1. Fix typos, unclear explanations
2. Add examples and screenshots
3. Create video tutorials
4. Translate to other languages (future)

---

## 📝 License

This artist platform is part of the Daisu project. See main project LICENSE for details.

---

## 📞 Support

- **Documentation:** See `ARTIST_PLATFORM_DESIGN.md` for full details
- **Issues:** Report bugs on GitHub Issues
- **Discord:** Join our Discord for artist support (link TBD)
- **Email:** support@dicesuki.com (TBD)

---

**Last Updated:** 2025-11-16
**Version:** 2.0 (Phases 1-2 Complete)
**Status:** ✅ Core System Ready for Testing

---

## File Summary

### ✅ Completed Files
- `src/types/customDice.ts` - TypeScript interfaces
- `src/lib/diceMetadataSchema.ts` - Validation utilities
- `src/lib/diceMetadataGenerator.ts` - Metadata generation
- `src/components/panels/ArtistTestingPanel.tsx` - Upload UI with drag & drop
- `src/components/dice/CustomDice.tsx` - Custom GLB dice component
- `src/components/panels/DicePreviewScene.tsx` - Interactive preview environment
- `src/hooks/useCustomDiceLoader.ts` - GLB loading hook
- `public/artist-resources/documentation/ARTIST_GUIDE.md` - Non-technical artist guide
- `public/artist-resources/templates/generate_dice_templates.py` - Blender template generator

### ⏳ Remaining
- `.blend` template file (run Python script to generate)
- Face numbering diagrams
- Example GLB files
- Production asset registry (`src/lib/diceAssets.ts`)
- Unit and integration tests

---

🎲 **Start Testing: Settings → Developer Tools → Artist Testing Platform** 🎲
