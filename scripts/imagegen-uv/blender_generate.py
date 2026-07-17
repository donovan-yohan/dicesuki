#!/usr/bin/env python3
"""Build a Blender mesh from a validated Dicesuki canonical UV manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys
from typing import Any

try:
    import bpy  # type: ignore
except ModuleNotFoundError:
    bpy = None


REFERENCE_PATTERN = re.compile(r"^canonical-contract-v(\d+)\.json$")


def validate_manifest_data(manifest: dict[str, Any]) -> list[str]:
    """Validate portable fields and the frozen contract before touching Blender."""
    errors: list[str] = []
    shape = manifest.get("shape")
    if shape not in {"d4", "d6", "d8", "d10", "d12", "d20"}:
        errors.append(f"unsupported shape {shape}")

    face_count = manifest.get("canonicalFaceCount")
    triangle_count = manifest.get("canonicalTriangleCount")
    triangles_per_face = manifest.get("trianglesPerFace")
    islands = manifest.get("islands")
    if not isinstance(islands, list) or len(islands) != face_count:
        errors.append(f"expected {face_count} islands")
        return errors

    seen_faces: set[int] = set()
    seen_triangles: set[int] = set()
    for island in islands:
        face_value = island.get("faceValue")
        label = f"face {face_value}"
        if face_value in seen_faces:
            errors.append(f"duplicate {label}")
        seen_faces.add(face_value)

        indices = island.get("triangleIndices")
        uv_triangles = island.get("uvByTriangle")
        mesh_triangles = island.get("meshTriangles")
        if not isinstance(indices, list) or len(indices) != triangles_per_face:
            errors.append(f"{label} has wrong triangle index count")
            continue
        if not isinstance(uv_triangles, list) or len(uv_triangles) != triangles_per_face:
            errors.append(f"{label} has wrong UV triangle count")
            continue
        if not isinstance(mesh_triangles, list) or len(mesh_triangles) != triangles_per_face:
            errors.append(f"{label} has wrong mesh triangle count")
            continue

        for offset, triangle_index in enumerate(indices):
            if triangle_index in seen_triangles:
                errors.append(f"duplicate triangle index {triangle_index}")
            seen_triangles.add(triangle_index)
            mesh_triangle = mesh_triangles[offset]
            positions = mesh_triangle.get("positions")
            uvs = mesh_triangle.get("uvs")
            expected_uvs = [[uv.get("u"), uv.get("v")] for uv in uv_triangles[offset]]
            if mesh_triangle.get("triangleIndex") != triangle_index:
                errors.append(f"{label} mesh triangle index mismatch")
            if not _valid_vector_rows(positions, 3, 3):
                errors.append(f"{label} triangle {triangle_index} must have three finite XYZ positions")
            if not _valid_vector_rows(uvs, 3, 2):
                errors.append(f"{label} triangle {triangle_index} must have three finite UV pairs")
            elif uvs != expected_uvs:
                errors.append(f"{label} triangle {triangle_index} UV fields disagree")
            elif any(value < 0 or value > 1 for uv in uvs for value in uv):
                errors.append(f"{label} triangle {triangle_index} has out-of-range UV")

        if shape == "d10" and (
            len(indices) != 2 or island.get("sharedAtlasIsland") is not True
        ):
            errors.append(f"D10 {label} must be one two-triangle kite island")

    if len(seen_triangles) != triangle_count:
        errors.append(f"expected {triangle_count} unique triangles, got {len(seen_triangles)}")
    if seen_triangles and seen_triangles != set(range(triangle_count)):
        errors.append("triangle indexes must cover one canonical zero-based sequence")

    try:
        reference = _load_canonical_reference()
    except (OSError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"cannot load canonical reference: {error}")
        return errors

    expected = reference.get("shapes", {}).get(shape)
    if expected is None:
        errors.append(f"canonical reference has no {shape} entry")
        return errors
    if manifest.get("version") != reference.get("manifestVersion"):
        errors.append(f"canonical manifest version drifted for {shape}")
    if manifest.get("canvasSize") != reference.get("canvasSize"):
        errors.append(f"canonical canvas size drifted for {shape}")
    if manifest.get("faceValues") != expected.get("faceValues"):
        errors.append(f"canonical face order drifted for {shape}")
    if manifest.get("materialMap") != expected.get("materialMap"):
        errors.append(f"canonical face/material mapping drifted for {shape}")

    expected_faces = {face["value"]: face for face in expected.get("faces", [])}
    for island in islands:
        face_value = island.get("faceValue")
        expected_face = expected_faces.get(face_value)
        if expected_face is None:
            errors.append(f"canonical reference has no {shape} face {face_value}")
            continue
        if island.get("materialIndex") != expected_face.get("materialIndex"):
            errors.append(f"{shape} face {face_value} material mapping drifted")
        if island.get("triangleIndices") != expected_face.get("triangleIndices"):
            errors.append(f"{shape} face {face_value} triangle grouping drifted")

    uv_digest = _canonical_digest(_uv_contract(manifest))
    mesh_digest = _canonical_digest(_mesh_contract(manifest))
    if uv_digest != expected.get("uvDigest"):
        errors.append(f"canonical UV mapping drifted for {shape}: {uv_digest}")
    if mesh_digest != expected.get("meshDigest"):
        errors.append(f"canonical mesh topology drifted for {shape}: {mesh_digest}")
    return errors


def _load_canonical_reference() -> dict[str, Any]:
    fixture_directory = Path(__file__).resolve().parent / "fixtures"
    references = []
    for candidate in fixture_directory.iterdir():
        match = REFERENCE_PATTERN.match(candidate.name)
        if match:
            references.append((int(match.group(1)), candidate))
    if not references:
        raise ValueError("no canonical ImageGen reference fixtures found")
    version, reference_path = max(references, key=lambda item: item[0])
    reference = json.loads(reference_path.read_text(encoding="utf-8"))
    if reference.get("referenceVersion") != version:
        raise ValueError(f"{reference_path.name} must declare referenceVersion {version}")
    return reference


def _uv_contract(manifest: dict[str, Any]) -> dict[str, Any]:
    return _selected(manifest, [
        "version", "shape", "canvasSize", "faceValues", "materialMap",
    ]) | {
        "islands": [
            _selected(island, [
                "faceValue", "materialIndex", "triangleIndices", "points",
                "safePoints", "baselineEdge", "baselineAngleDegrees",
                "uvByTriangle", "sharedAtlasIsland",
            ])
            for island in manifest.get("islands", [])
        ]
    }


def _mesh_contract(manifest: dict[str, Any]) -> dict[str, Any]:
    return _selected(manifest, [
        "version", "shape", "geometry", "canonicalFaceCount",
        "canonicalTriangleCount", "trianglesPerFace",
    ]) | {
        "islands": [
            _selected(island, ["faceValue", "materialIndex", "meshTriangles"])
            for island in manifest.get("islands", [])
        ]
    }


def _selected(value: dict[str, Any], keys: list[str]) -> dict[str, Any]:
    return {key: value[key] for key in keys if key in value}


def _canonical_digest(value: dict[str, Any]) -> str:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def create_blender_mesh(manifest: dict[str, Any], object_name: str) -> Any:
    """Create one connected mesh with per-loop UVs and per-face metadata."""
    if bpy is None:
        raise RuntimeError("Blender Python (bpy) is required unless --validate-only is used")

    errors = validate_manifest_data(manifest)
    if errors:
        raise ValueError("Invalid canonical manifest:\n" + "\n".join(errors))

    existing = bpy.data.objects.get(object_name)
    if existing is not None:
        bpy.data.objects.remove(existing, do_unlink=True)

    records = []
    for island in manifest["islands"]:
        for mesh_triangle in island["meshTriangles"]:
            records.append({
                "triangle_index": mesh_triangle["triangleIndex"],
                "positions": mesh_triangle["positions"],
                "uvs": mesh_triangle["uvs"],
                "face_value": island["faceValue"],
                "material_index": island["materialIndex"],
            })
    records.sort(key=lambda record: record["triangle_index"])

    vertices: list[tuple[float, float, float]] = []
    vertex_indexes: dict[tuple[float, float, float], int] = {}
    faces: list[list[int]] = []
    for record in records:
        face = []
        for raw_position in record["positions"]:
            position = tuple(round(float(value), 6) for value in raw_position)
            if position not in vertex_indexes:
                vertex_indexes[position] = len(vertices)
                vertices.append(position)
            face.append(vertex_indexes[position])
        faces.append(face)

    mesh = bpy.data.meshes.new(f"{object_name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    uv_layer = mesh.uv_layers.new(name="DicesukiCanonicalUV")
    face_values = mesh.attributes.new(name="dice_face_value", type="INT", domain="FACE")
    material_indexes = mesh.attributes.new(name="dice_material_index", type="INT", domain="FACE")

    object_value = bpy.data.objects.new(object_name, mesh)
    bpy.context.collection.objects.link(object_value)
    object_value["dicesuki_shape"] = manifest["shape"]
    object_value["dicesuki_manifest_version"] = manifest["version"]
    object_value["dicesuki_uv_origin"] = "top-left in manifest; V flipped for Blender"

    material_count = max(record["material_index"] for record in records) + 1
    for material_index in range(material_count):
        material = bpy.data.materials.new(name=f"Dicesuki_Material_{material_index:02d}")
        object_value.data.materials.append(material)

    for polygon, record in zip(mesh.polygons, records, strict=True):
        polygon.material_index = record["material_index"]
        face_values.data[polygon.index].value = record["face_value"]
        material_indexes.data[polygon.index].value = record["material_index"]
        for loop_index, (u_value, top_left_v) in zip(
            polygon.loop_indices,
            record["uvs"],
            strict=True,
        ):
            uv_layer.data[loop_index].uv = (float(u_value), 1.0 - float(top_left_v))

    for polygon in mesh.polygons:
        polygon.use_smooth = False
    return object_value


def _valid_vector_rows(value: Any, row_count: int, width: int) -> bool:
    return (
        isinstance(value, list)
        and len(value) == row_count
        and all(
            isinstance(row, list)
            and len(row) == width
            and all(isinstance(part, (int, float)) and math.isfinite(part) for part in row)
            for row in value
        )
    )


def _parse_arguments(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--object-name")
    parser.add_argument("--output-blend", type=Path)
    parser.add_argument("--validate-only", action="store_true")
    return parser.parse_args(argv)


def _script_arguments() -> list[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]


def main() -> int:
    arguments = _parse_arguments(_script_arguments())
    manifest = json.loads(arguments.manifest.read_text(encoding="utf-8"))
    errors = validate_manifest_data(manifest)
    if errors:
        print("Invalid canonical manifest:\n" + "\n".join(errors), file=sys.stderr)
        return 1

    if arguments.validate_only:
        print(
            f"Validated {manifest['shape']} Blender manifest: "
            f"{manifest['canonicalFaceCount']} faces / {manifest['canonicalTriangleCount']} triangles"
        )
        return 0

    object_name = arguments.object_name or f"Dicesuki_{manifest['shape'].upper()}_Canonical"
    create_blender_mesh(manifest, object_name)
    if arguments.output_blend:
        arguments.output_blend.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(arguments.output_blend.resolve()))
    print(f"Created Blender object {object_name} from {arguments.manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
