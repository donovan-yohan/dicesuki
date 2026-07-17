# Artist Resources - Dicesuki Custom Dice

Welcome! This folder contains everything you need to create custom dice for Dicesuki.

---

## 📚 Documentation

### For Artists (Start Here!)
**[Artist Guide](documentation/ARTIST_GUIDE.md)** - Complete step-by-step guide for creating custom dice in Blender
- Blender setup and modeling guidelines
- Export settings and best practices
- Testing workflow in Dicesuki
- Troubleshooting and tips

---

## 🎨 Templates

### Blender Dice Generator
**[generate_dice_templates.py](templates/generate_dice_templates.py)** - Python script for Blender

**How to use:**
1. Open Blender
2. Switch to "Scripting" workspace
3. Open this Python file in the Text Editor
4. Click "Run Script" (▶ button)
5. All 6 dice types will be generated!

**What it creates:**
- D4 (tetrahedron, red)
- D6 (cube, blue)
- D8 (octahedron, green)
- D10 (pentagonal trapezohedron, orange)
- D12 (dodecahedron, purple)
- D20 (icosahedron, pink)

Each dice is:
- Properly sized (1 unit)
- Correctly oriented (Y-up)
- Centered at origin
- Ready to customize and export

**After running:** Save as `dice-templates.blend` for future use!

---

### ImageGen UV Templates
**[imagegen-uv/](imagegen-uv/)** - Generated UV guide and mask assets for AI-assisted material exploration

**How to use:**
1. Run `npm run generate:imagegen-uv` from the repo root
2. Open `imagegen-uv/INDEX.md`
3. Attach a shape template and use its prompt pack with ImageGen
4. Start with material-only prompts, then place numbers deterministically in Three.js or Blender

**What it creates:**
- D4/D6/D8/D10/D12/D20 UV guide SVGs
- Paintable island masks
- Face/material manifests
- Prompt packs for material-only and experimental numbered atlas generation
- Geometry-derived numbered ImageGen edit targets with edge-parallel baselines
- Cozy Forest, Dark Dungeon, and Cyberpunk Box atlases, normal maps, prompts, and engine captures

The complete workshop instructions and templates are in
`imagegen-uv/theme-sets/templates/README.md`.

---

## 📦 Examples

*(Coming soon)*

Example GLB files showing:
- Different dice types
- Various art styles
- Proper metadata configuration
- Face numbering reference

---

## 🚀 Quick Start

1. **Generate templates** - Run the Python script in Blender
2. **Read the guide** - Open [ARTIST_GUIDE.md](documentation/ARTIST_GUIDE.md)
3. **Customize a die** - Start with D6 (easiest)
4. **Export as GLB** - Follow export settings in guide
5. **Test in Dicesuki** - Settings → Developer Tools → Artist Testing Platform

---

## 🎯 File Format

- **3D Model:** `.glb` (Binary glTF 2.0)
- **Metadata:** Auto-generated or `.json` sidecar
- **Max File Size:** 10 MB (5 MB recommended)
- **Polygon Count:** 1,000-5,000 triangles (10,000 max)
- **Textures:** ≤ 2048×2048 (embedded in GLB)

---

## 📞 Support

- **Full Guide:** See [ARTIST_GUIDE.md](documentation/ARTIST_GUIDE.md)
- **Technical Docs:** See `/docs/ARTIST_PLATFORM_DESIGN.md`
- **Issues:** Report problems on GitHub

---

**Happy Dice Creating!** 🎲
