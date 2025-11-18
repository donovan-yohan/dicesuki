# Artist Guide - Creating Custom Dice for Daisu

**For Artists, 3D Modelers, and Designers**

This guide will walk you through creating custom dice models in Blender and testing them in Daisu.

---

## 📋 Quick Start

1. Download the Blender template file
2. Customize your dice design
3. Export as GLB
4. Upload to Daisu
5. Test and verify

**Time needed:** 15-30 minutes (first time)

---

## 🎨 What You'll Create

Custom 3D dice models that work perfectly in the Daisu dice simulator with:
- ✅ Realistic physics (rolling, bouncing, settling)
- ✅ Accurate face detection (shows the correct number)
- ✅ Beautiful materials and textures
- ✅ Smooth performance

---

## 🎯 Understanding Dice Orientation

**IMPORTANT:** Face numbering matters! The dice simulator needs to know which face is which.

### Standard Dice Numbering

#### D6 (6-sided cube)
```
     [6]
      |
[4]--[2]--[3]
      |
     [1]
      |
     [5]
```

**Rules for D6:**
- Opposite faces sum to 7
- Bottom = 1, Top = 6
- Front = 2, Back = 5
- Right = 3, Left = 4

**In Blender coordinates (Y-up):**
- Face 1 (bottom): Points down (-Y direction)
- Face 2 (front): Points forward (+Z direction)
- Face 3 (right): Points right (+X direction)
- Face 4 (left): Points left (-X direction)
- Face 5 (back): Points back (-Z direction)
- Face 6 (top): Points up (+Y direction)

#### D20 (20-sided icosahedron)
- Face 1 = Bottom (pointing down)
- Face 12 = Top (pointing up)
- Faces 2-11 = Middle band
- Faces 13-20 = Equator

See the template files for exact face positions!

---

## 🛠️ Blender Setup

### Step 1: Generate Dice Templates

We provide a Python script that generates all 6 dice types in Blender automatically!

**How to use the template generator:**

1. **Open Blender** (version 3.0 or newer)

2. **Switch to Scripting workspace:**
   - Click "Scripting" tab at the top of Blender

3. **Load the script:**
   - Click "Open" button in the Text Editor
   - Navigate to `public/artist-resources/templates/generate_dice_templates.py`
   - Click "Open"

4. **Run the script:**
   - Click the "▶ Run Script" button (or press Alt+P)
   - Wait 5-10 seconds for generation

5. **View your dice:**
   - Switch back to "Layout" workspace
   - You'll see all 6 dice types lined up:
     - D4 (red) - D6 (blue) - D8 (green) - D10 (orange) - D12 (purple) - D20 (pink)

6. **Save as template (optional):**
   - File → Save As → `dice-templates.blend`
   - Now you have a reusable template file!

**What the script creates:**
- ✅ All dice properly sized (1 unit)
- ✅ Correct Y-up orientation
- ✅ Centered at origin
- ✅ Basic PBR materials
- ✅ Camera and lighting for preview

**Option B: Start from scratch**
- Model your own dice following the requirements below

### Step 2: Model Requirements

#### Size & Scale
- **D6:** 1 Blender unit = 1 meter in-world
- Model should be **exactly 1×1×1 units** for a D6
- For other dice: Fit within a 1-unit sphere diameter

#### Origin Point
- **Must be at geometric center** of the dice
- In Blender: `Object > Set Origin > Origin to Geometry`

#### Coordinate System
- **Y-axis must point UP**
- This is Blender's default, but double-check!

#### Polygon Count
- **Recommended:** 1,000 - 5,000 triangles
- **Maximum:** 10,000 triangles
- Keep it low for smooth web performance!

**Check polygon count:**
- Enable Statistics in Overlays panel
- Look at "Tris" count in top-right corner

---

## 🎨 Modeling Guidelines

### Geometry

**DO:**
- ✅ Use clean, manifold geometry (no holes, non-manifold edges)
- ✅ Apply all modifiers before export
- ✅ Apply scale, rotation, location (`Ctrl+A > All Transforms`)
- ✅ Use Subdivision Surface for smooth dice (max 2 levels)
- ✅ Add slight edge bevels for realism (0.02-0.05 units)

**DON'T:**
- ❌ Leave holes or gaps in the mesh
- ❌ Use too many polygons (> 10,000 tris)
- ❌ Use non-manifold geometry
- ❌ Forget to apply modifiers

**Clean up your mesh:**
1. Select all vertices (`A`)
2. `Mesh > Clean Up > Delete Loose`
3. `Mesh > Normals > Recalculate Outside`
4. `Mesh > Clean Up > Merge by Distance` (0.001 threshold)

### Materials

**Use Principled BSDF shader:**
```
Material Properties:
├─ Base Color: Your dice color or texture
├─ Metallic: 0.0 - 0.3 (most dice are plastic)
├─ Roughness: 0.3 - 0.8 (0.6 for plastic dice)
├─ Specular: 0.5 (default)
└─ Normal: Optional (for surface detail)
```

**Material Tips:**
- **Plastic dice:** Roughness 0.6, Metallic 0.0
- **Metal dice:** Roughness 0.3, Metallic 0.9
- **Glass dice:** Roughness 0.1, Transmission 1.0 (advanced)
- **Wood dice:** Roughness 0.8, use wood texture for Base Color

### Textures

**Best Practices:**
- Use UV unwrapping for texture placement
- Maximum texture size: **2048×2048 pixels**
- Formats: PNG or JPEG
- Embed textures in GLB (Blender does this automatically)

**Adding Numbers (Optional):**
- Paint numbers directly on texture, OR
- Use separate mesh objects for number faces, OR
- Leave blank (numbers can be overlaid in UI)

---

## 📤 Exporting from Blender

### Export Settings

1. **Select your dice object**
2. `File > Export > glTF 2.0 (.glb / .gltf)`

**CRITICAL SETTINGS:**

```
Format:
  ☑ GLB Binary (.glb)  ← MUST use this!

Include:
  ☑ Selected Objects
  ☐ Custom Properties
  ☐ Cameras
  ☐ Punctual Lights

Transform:
  ☑ +Y Up  ← CRITICAL!
  ☑ Apply Modifiers
  ☑ Apply Transform

Geometry:
  ☑ UVs
  ☑ Normals
  ☐ Tangents
  ☑ Vertex Colors (if used)
  ☑ Materials: Export
  ☑ Images: Embedded  ← IMPORTANT!

Animation:
  ☐ (Uncheck everything - static dice only)

Compression:
  ☐ No compression (for best compatibility)
```

3. **Save as:** `your-dice-name.glb`

### File Size Check
- Target: **< 5 MB** (recommended)
- Limit: **< 10 MB** (hard limit)

If too large:
- Reduce texture resolution
- Simplify geometry with Decimate modifier
- Remove unnecessary details

---

## 🧪 Testing in Daisu

### Step 1: Open Artist Testing Platform

1. Open Daisu app in browser
2. Click **⚙️ Settings** icon (top-right)
3. Scroll to **Developer Tools**
4. Click **Artist Testing Platform**

### Step 2: Upload Your Dice

1. **Drag & drop** your `.glb` file into the upload area
2. **Select dice type** (D4, D6, D8, D10, D12, or D20)
3. (Optional) Enter custom name and artist name
4. Click **"Generate Metadata"**
5. Click **"🎲 Load Preview"**

### Step 3: Test in 3D Preview

**Controls:**
- **Roll Dice** - Throw the dice with physics
- **Click & drag dice** - Move it around
- **Click & drag background** - Rotate camera
- **Scroll wheel** - Zoom in/out
- **Reset Position** - Return to start

**What to Check:**
- ✅ Model appears correctly (right size, orientation)
- ✅ Materials/textures look good
- ✅ Physics feels realistic (bouncing, rolling)
- ✅ **Face detection works** - correct number shows when dice stops
- ✅ Performance is smooth (60 FPS)

### Step 4: Verify Face Detection

**Critical Test:**
1. Roll the dice multiple times
2. Check if the **face value** at the bottom matches the actual top face
3. Try to get all possible numbers (1-6 for D6, 1-20 for D20)

**If face detection is wrong:**
- Your model might be rotated differently than expected
- You may need to adjust the face normal vectors in metadata
- Contact us for help!

---

## 🔧 Troubleshooting

### Model doesn't appear
**Problem:** Preview scene is empty
**Solutions:**
- Check file size (must be < 10 MB)
- Verify GLB export (not glTF + separate files)
- Try re-exporting with "Apply Modifiers" checked
- Test with a simple cube first

### Wrong face detection
**Problem:** Shows "3" when top face is "6"
**Cause:** Model orientation doesn't match standard dice layout
**Solutions:**
- Rotate model in Blender to match standard orientation
- In Blender: Rotate 90° on appropriate axis
- Re-apply rotation: `Ctrl+A > Rotation`
- Re-export and test

### Model too large/small
**Problem:** Dice is huge or tiny in preview
**Cause:** Scale not set correctly
**Solutions:**
- In Blender: Select dice, press `S` then type `1` and Enter
- Apply scale: `Ctrl+A > Scale`
- Check dimensions in Properties panel (should be 1×1×1 for D6)
- Re-export

### Performance issues
**Problem:** Preview is laggy, low FPS
**Cause:** Too many polygons or large textures
**Solutions:**
- Add Decimate modifier (Ratio: 0.5) to reduce polygons
- Reduce texture resolution to 1024×1024
- Simplify geometry
- Target < 5,000 triangles

### Textures missing
**Problem:** Dice appears gray/untextured
**Cause:** Textures not embedded in GLB
**Solutions:**
- Re-export with "Images: Embedded" checked
- Use "Pack External Data" in Blender before export
- Check texture paths are not broken

---

## 📝 Quick Reference Card

### Blender Checklist Before Export
- [ ] Model is 1×1×1 units (for D6) or fits in 1-unit sphere
- [ ] Origin is at geometric center (`Object > Set Origin > Geometry`)
- [ ] Scale/rotation/location applied (`Ctrl+A > All Transforms`)
- [ ] All modifiers applied
- [ ] Mesh is clean (no loose vertices, recalculated normals)
- [ ] Polygon count < 5,000 triangles
- [ ] Materials use Principled BSDF
- [ ] Textures < 2048×2048 and embedded
- [ ] Y-axis points up
- [ ] File size < 5 MB after export

### Export Settings Quick Copy
```
Format: GLB Binary
Transform: +Y Up, Apply Modifiers, Apply Transform
Geometry: UVs, Normals, Materials Export, Images Embedded
```

### Common Dice Sizes
- **D4:** Tetrahedron, ~1 unit height
- **D6:** Cube, 1×1×1 units
- **D8:** Octahedron, ~1 unit diameter
- **D10:** Pentagonal trapezohedron, ~1 unit diameter
- **D12:** Dodecahedron, ~1 unit diameter
- **D20:** Icosahedron, ~1 unit diameter

---

## 🎓 Advanced Topics

### Custom Face Normals

If default face detection doesn't work, you can specify custom face normals in the metadata JSON file.

**metadata.json structure:**
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
  }
}
```

**Face normals explained:**
- Vector pointing **outward** from each face
- Must be **unit length** (magnitude = 1.0)
- In model's local coordinate space

**To find face normals in Blender:**
1. Edit Mode
2. Select a face
3. `Mesh > Normals > Show Face Normals`
4. Note the direction of the blue arrow
5. Write down the vector (normalized)

### Custom Physics Properties

Adjust how your dice behaves:

**Restitution (Bounciness):**
- `0.0` = No bounce (dead drop)
- `0.3` = Realistic plastic dice (default)
- `0.5` = Bouncy
- `1.0` = Perfect bounce (unrealistic)

**Friction:**
- `0.3` = Slippery (ice)
- `0.6` = Normal plastic dice (default)
- `0.8` = High friction (rubber)

**Mass:**
- `1.0` = Standard (default)
- `> 1.0` = Heavier (settles faster)
- `< 1.0` = Lighter (more floaty)

Adjust these in the metadata JSON file!

---

## 🆘 Getting Help

### Resources
- **Blender Templates:** `/public/models/templates/dice-templates.blend`
- **Example Models:** `/public/models/dice/` (see examples for each type)
- **Technical Docs:** `/docs/ARTIST_PLATFORM_DESIGN.md`

### Support
- **Discord:** [Join our server] (link TBD)
- **GitHub Issues:** Report bugs or ask questions
- **Email:** support@dicesuki.com (TBD)

### Common Questions

**Q: Can I sell my custom dice?**
A: Check with project maintainers about licensing.

**Q: What's the best way to add numbers to dice?**
A: Use texture painting or decals in Blender. Numbers will be overlaid in UI by default.

**Q: Can I use procedural materials?**
A: Yes, but bake them to textures before export for best compatibility.

**Q: My D20 face detection is all wrong!**
A: D20s are complex! Contact us for help with face normal mapping.

**Q: Can I animate the dice?**
A: Not yet - only static models are supported currently.

---

## 🎉 You're Ready!

Follow this guide, use the templates, and test your dice in the preview. If something doesn't work, check the troubleshooting section or reach out for help.

**Happy dice making!** 🎲✨

---

**Last Updated:** 2025-11-16
**Version:** 1.0
**For:** Daisu Artist Testing Platform
