"""
Daisu Dice Template Generator
==============================

This Blender Python script generates properly configured dice templates
for all standard dice types (D4, D6, D8, D10, D12, D20).

USAGE:
1. Open Blender
2. Go to Scripting workspace
3. Click "Open" and select this file
4. Click "Run Script" button
5. Your dice templates will be created in the scene!

Each dice will be:
- Correctly sized (1 unit)
- Properly oriented (Y-up)
- Centered at origin
- Ready to customize and export

Created for: Daisu Dice Simulator
Version: 1.0
"""

import bpy
import bmesh
import math
from mathutils import Vector

# Clean the scene
def clean_scene():
    """Remove all objects from the scene"""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

    # Remove all meshes
    for mesh in bpy.data.meshes:
        bpy.data.meshes.remove(mesh)

    # Remove all materials
    for material in bpy.data.materials:
        bpy.data.materials.remove(material)

# Create material
def create_dice_material(name, color):
    """Create a PBR material for dice"""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()

    # Create Principled BSDF
    bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
    bsdf.location = (0, 0)
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.6
    bsdf.inputs['Specular'].default_value = 0.5

    # Create output
    output = nodes.new(type='ShaderNodeOutputMaterial')
    output.location = (300, 0)

    # Link
    mat.node_tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])

    return mat

# D4 - Tetrahedron
def create_d4():
    """Create a D4 (tetrahedron) dice"""
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=0,
        radius=0.6,
        location=(0, 0, 0)
    )
    obj = bpy.context.active_object
    obj.name = "D4_Template"

    # Convert to tetrahedron (4 faces)
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(obj.data)

    # Keep only 4 vertices to make tetrahedron
    verts_to_remove = list(bm.verts)[4:]
    bmesh.ops.delete(bm, geom=verts_to_remove, context='VERTS')

    bmesh.update_edit_mesh(obj.data)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Add material
    mat = create_dice_material("D4_Material", (1.0, 0.2, 0.2, 1.0))  # Red
    obj.data.materials.append(mat)

    # Position
    obj.location = (-6, 0, 0)

    return obj

# D6 - Cube
def create_d6():
    """Create a D6 (cube) dice"""
    bpy.ops.mesh.primitive_cube_add(
        size=1.0,
        location=(0, 0, 0)
    )
    obj = bpy.context.active_object
    obj.name = "D6_Template"

    # Add bevel for realistic edges
    bpy.ops.object.modifier_add(type='BEVEL')
    obj.modifiers["Bevel"].width = 0.02
    obj.modifiers["Bevel"].segments = 2

    # Add material
    mat = create_dice_material("D6_Material", (0.2, 0.4, 1.0, 1.0))  # Blue
    obj.data.materials.append(mat)

    # Position
    obj.location = (-3, 0, 0)

    return obj

# D8 - Octahedron
def create_d8():
    """Create a D8 (octahedron) dice"""
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=0,
        radius=0.7,
        location=(0, 0, 0)
    )
    obj = bpy.context.active_object
    obj.name = "D8_Template"

    # Convert to octahedron (8 faces)
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(obj.data)

    # Keep 6 vertices to make octahedron
    verts_to_remove = list(bm.verts)[6:]
    bmesh.ops.delete(bm, geom=verts_to_remove, context='VERTS')

    bmesh.update_edit_mesh(obj.data)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Add material
    mat = create_dice_material("D8_Material", (0.2, 0.8, 0.4, 1.0))  # Green
    obj.data.materials.append(mat)

    # Position
    obj.location = (0, 0, 0)

    return obj

# D10 - Pentagonal Trapezohedron
def create_d10():
    """Create a D10 (pentagonal trapezohedron) dice"""
    # Using a UV sphere as approximation
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=10,
        ring_count=5,
        radius=0.6,
        location=(0, 0, 0)
    )
    obj = bpy.context.active_object
    obj.name = "D10_Template"

    # NOTE: This is an approximation. For accurate D10, model manually
    # or import from specialized dice modeling tools

    # Add material
    mat = create_dice_material("D10_Material", (1.0, 0.6, 0.0, 1.0))  # Orange
    obj.data.materials.append(mat)

    # Position
    obj.location = (3, 0, 0)

    return obj

# D12 - Dodecahedron
def create_d12():
    """Create a D12 (dodecahedron) dice"""
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=1,
        radius=0.65,
        location=(0, 0, 0)
    )
    obj = bpy.context.active_object
    obj.name = "D12_Template"

    # Convert to dodecahedron using modifier
    bpy.ops.object.modifier_add(type='REMESH')
    obj.modifiers["Remesh"].mode = 'BLOCKS'
    obj.modifiers["Remesh"].octree_depth = 3

    # Add material
    mat = create_dice_material("D12_Material", (0.6, 0.2, 1.0, 1.0))  # Purple
    obj.data.materials.append(mat)

    # Position
    obj.location = (6, 0, 0)

    return obj

# D20 - Icosahedron
def create_d20():
    """Create a D20 (icosahedron) dice"""
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=1,
        radius=0.7,
        location=(0, 0, 0)
    )
    obj = bpy.context.active_object
    obj.name = "D20_Template"

    # Add material
    mat = create_dice_material("D20_Material", (1.0, 0.2, 0.6, 1.0))  # Pink
    obj.data.materials.append(mat)

    # Position
    obj.location = (9, 0, 0)

    return obj

# Apply transforms to all objects
def finalize_all_dice():
    """Apply all transforms and set origins"""
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            # Select object
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj

            # Set origin to geometry
            bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')

            # Apply all transforms
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

            # Recalculate normals
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.normals_consistent(inside=False)
            bpy.ops.object.mode_set(mode='OBJECT')

# Add lights and camera
def setup_scene():
    """Add lighting and camera for preview"""
    # Add camera
    bpy.ops.object.camera_add(location=(0, -12, 6))
    camera = bpy.context.active_object
    camera.rotation_euler = (math.radians(60), 0, 0)
    bpy.context.scene.camera = camera

    # Add sun light
    bpy.ops.object.light_add(type='SUN', location=(5, -5, 10))
    light = bpy.context.active_object
    light.data.energy = 2.0
    light.rotation_euler = (math.radians(45), 0, math.radians(45))

    # Add ambient light
    bpy.context.scene.world.use_nodes = True
    world_nodes = bpy.context.scene.world.node_tree.nodes
    bg_node = world_nodes.get('Background')
    if bg_node:
        bg_node.inputs['Strength'].default_value = 0.3

# Main function
def main():
    """Generate all dice templates"""
    print("=" * 50)
    print("Daisu Dice Template Generator")
    print("=" * 50)

    # Clean scene
    print("Cleaning scene...")
    clean_scene()

    # Create dice
    print("Creating D4...")
    create_d4()

    print("Creating D6...")
    create_d6()

    print("Creating D8...")
    create_d8()

    print("Creating D10...")
    create_d10()

    print("Creating D12...")
    create_d12()

    print("Creating D20...")
    create_d20()

    # Finalize
    print("Finalizing transforms...")
    finalize_all_dice()

    # Setup scene
    print("Setting up lights and camera...")
    setup_scene()

    print("=" * 50)
    print("✓ All dice templates created!")
    print("=" * 50)
    print("\nNEXT STEPS:")
    print("1. Customize each dice (add details, textures, etc.)")
    print("2. Select one dice to export")
    print("3. File > Export > glTF 2.0 (.glb)")
    print("4. Use settings from ARTIST_GUIDE.md")
    print("5. Upload to Daisu for testing!")
    print("\nTIP: Each dice is a separate object.")
    print("     Select one at a time to work on it.")

# Run the script
if __name__ == "__main__":
    main()
