#!/usr/bin/env python3
"""Isolated Blender stage for the procedural wood D6 experiment; never opens user state."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

import bpy  # type: ignore[import-not-found]

# Import canonical mesh code without leaving cache files outside the write fence.
sys.dont_write_bytecode = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    repo = Path(__file__).resolve().parents[2]
    allowed = (repo / '.artifacts/theme-workshop/experiments/woodland').resolve()
    out = args.out.resolve()
    if out != allowed and allowed not in out.parents:
        raise ValueError('Output must stay inside the woodland experiment')
    spec = importlib.util.spec_from_file_location('canonical_generator', repo / 'scripts/imagegen-uv/blender_generate.py')
    assert spec is not None and spec.loader is not None
    canonical = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(canonical)
    manifest = json.loads(args.manifest.read_text())
    errors = canonical.validate_manifest_data(manifest)
    if errors or manifest['shape'] != 'd6':
        raise ValueError(f'Invalid canonical D6: {errors}')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    die = canonical.create_blender_mesh(manifest, 'WoodlandHoneyOakD6')
    # The generator's XYZ coordinates ARE canonical Three.js coordinates. Keep
    # them as-is at unit edge size; metadata applies the Rust body's 1.1 world
    # scale exactly once. A default Blender Z-up conversion would swap values.
    die['canonical_coordinate_system'] = 'Three.js Y-up; export_yup=False'
    die['baked_edge_length'] = 1.0
    die['runtime_scale'] = 1.1
    material = bpy.data.materials.new('Procedural warm honey oak / carved digits')
    if hasattr(material, 'use_nodes') and not material.use_nodes:
        material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.65
    bsdf.inputs['IOR'].default_value = 1.45
    for name, socket, color in [('albedo', 'Base Color', 'sRGB'), ('roughness', 'Roughness', 'Non-Color')]:
        texture = nodes.new('ShaderNodeTexImage')
        texture.name = f'Wood {name}'
        texture.image = bpy.data.images.load(str(out / f'wood-{name}.png'))
        texture.image.colorspace_settings.name = color
        texture.image.pack()
        links.new(texture.outputs['Color'], bsdf.inputs[socket])
    normal_texture = nodes.new('ShaderNodeTexImage')
    normal_texture.name = 'Wood tangent-space normal (OpenGL +Y)'
    normal_texture.image = bpy.data.images.load(str(out / 'wood-normal.png'))
    normal_texture.image.colorspace_settings.name = 'Non-Color'
    normal_texture.image.pack()
    normal = nodes.new('ShaderNodeNormalMap')
    normal.space = 'TANGENT'
    normal.inputs['Strength'].default_value = 1.0
    links.new(normal_texture.outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
    die.data.materials.clear()
    die.data.materials.append(material)
    for polygon in die.data.polygons:
        polygon.material_index = 0
    bpy.ops.object.select_all(action='DESELECT')
    die.select_set(True)
    bpy.context.view_layer.objects.active = die
    bpy.ops.export_scene.gltf(filepath=str(out / 'wood-d6.glb'), export_format='GLB', use_selection=True,
                              export_yup=False, export_texcoords=True, export_normals=True,
                              export_tangents=True, export_materials='EXPORT', export_extras=True,
                              export_image_format='AUTO')
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world.color = (0.2, 0.2, 0.2)
    if hasattr(scene.world, 'use_nodes') and not scene.world.use_nodes:
        scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.19, 0.22, 0.26, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.45
    scene.view_settings.view_transform = 'AgX'
    # Stage ground explicitly in canonical XZ plane (Y-up).
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, -0.505, 0), rotation=(1.57079632679, 0, 0))
    ground = bpy.context.object
    ground.name = 'Proof ground (not exported)'
    ground_material = bpy.data.materials.new('Proof slate')
    ground_material.diffuse_color = (0.045, 0.06, 0.07, 1)
    ground.data.materials.append(ground_material)
    camera_data = bpy.data.cameras.new('Proof camera')
    camera = bpy.data.objects.new('Proof camera', camera_data)
    scene.collection.objects.link(camera)
    camera.location = (2.5, 2.05, 2.9)
    camera.rotation_euler = (-camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 2.1
    scene.camera = camera
    for name, location, power, size in [('Warm key', (1, 3, 3), 450, 3), ('Soft fill', (-3, 1, 2), 180, 3), ('Edge light', (2, 1, -3), 300, 2)]:
        light_data = bpy.data.lights.new(name, type='AREA')
        light_data.energy = power
        light_data.shape = 'DISK'
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = location
        light.rotation_euler = (-light.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.object.select_all(action='DESELECT')
    die.select_set(True)
    bpy.context.view_layer.objects.active = die
    # Disable backup litter when this repeatable proof is run again.
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(out / 'wood-d6.blend'))
    scene.render.filepath = str(out / 'blender-hero.png')
    bpy.ops.render.render(write_still=True)
    (out / 'blender-receipt.json').write_text(json.dumps({
        'blenderVersion': bpy.app.version_string,
        'exportYUp': False,
        'vertices': len(die.data.vertices),
        'triangles': len(die.data.polygons),
        'objectScale': list(die.scale),
        'packedImages': [image.name for image in bpy.data.images if image.packed_file],
        'coordinatePolicy': 'canonical Three.js Y-up unit positions unchanged; runtime metadata scale 1.1',
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
