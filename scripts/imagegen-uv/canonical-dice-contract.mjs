import * as THREE from 'three'
import D10_GEOMETRY_CONTRACT from '../../src/lib/d10GeometryContract.json' with { type: 'json' }

export const CANONICAL_MANIFEST_VERSION = '1.0'
export const CANONICAL_CANVAS_SIZE = 2048
export const SUPPORTED_DICE_SHAPES = Object.freeze(['d4', 'd6', 'd8', 'd10', 'd12', 'd20'])

const MATERIAL_MAPS = {
  d4: [0, 1, 2, 3],
  d6: [3, 4, 0, 1, 5, 2],
  d8: [0, 1, 2, 3, 6, 7, 4, 5],
  d10: Array.from(
    { length: D10_GEOMETRY_CONTRACT.kiteValuesByMaterial.length },
    (_, value) => D10_GEOMETRY_CONTRACT.kiteValuesByMaterial.indexOf(value),
  ),
  d12: [0, 1, 2, 3, 5, 6, 10, 11, 9, 7, 4, 8],
  d20: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 15, 19, 18, 17, 14, 10, 11, 12, 13],
}

const FACE_COUNTS = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 }
const TRIANGLES_PER_FACE = { d4: 1, d6: 2, d8: 1, d10: 2, d12: 3, d20: 1 }
const ISLAND_SHAPES = { d4: 'triangle', d6: 'square', d8: 'triangle', d10: 'kite', d12: 'pentagon', d20: 'triangle' }
const COLUMNS = { d4: 2, d6: 3, d8: 4, d10: 5, d12: 4, d20: 5 }
const OPPOSITE_CONVENTIONS = {
  d4: { type: 'vertex-opposite-face', vertexValues: { v0: 2, v1: 4, v2: 3, v3: 1 } },
  d6: { type: 'sum', sum: 7 },
  d8: { type: 'sum', sum: 9 },
  d10: { type: 'sum', sum: 9 },
  d12: { type: 'sum', sum: 13 },
  d20: { type: 'sum', sum: 21 },
}

export const CANONICAL_DICE_SPECS = Object.freeze(Object.fromEntries(
  SUPPORTED_DICE_SHAPES.map((shape) => {
    const faceValues = shape === 'd10'
      ? Array.from({ length: 10 }, (_, value) => value)
      : Array.from({ length: FACE_COUNTS[shape] }, (_, index) => index + 1)
    const materialMap = Object.fromEntries(
      faceValues.map((value, index) => [value, MATERIAL_MAPS[shape][index]]),
    )

    return [shape, Object.freeze({
      shape,
      label: shape.toUpperCase(),
      faceValues: Object.freeze(faceValues),
      materialMap: Object.freeze(materialMap),
      canonicalFaceCount: FACE_COUNTS[shape],
      canonicalTriangleCount: FACE_COUNTS[shape] * TRIANGLES_PER_FACE[shape],
      trianglesPerFace: TRIANGLES_PER_FACE[shape],
      islandShape: ISLAND_SHAPES[shape],
      columns: COLUMNS[shape],
      opposingValueConvention: OPPOSITE_CONVENTIONS[shape],
      geometryPrimitive: shape === 'd4'
        ? 'TetrahedronGeometry'
        : shape === 'd6'
          ? 'BoxGeometry'
          : shape === 'd8'
            ? 'OctahedronGeometry'
            : shape === 'd10'
              ? 'pentagonal-trapezohedron'
              : shape === 'd12'
                ? 'DodecahedronGeometry'
                : 'IcosahedronGeometry',
    })]
  }),
))

export function getCanonicalDiceSpec(shape) {
  const spec = CANONICAL_DICE_SPECS[shape]
  if (!spec) throw new Error(`Unsupported dice shape: ${shape}`)
  return spec
}

export function createCanonicalDiceGeometry(shape, radius = 1) {
  getCanonicalDiceSpec(shape)
  if (shape === 'd4') return new THREE.TetrahedronGeometry(radius, 0)
  if (shape === 'd6') return new THREE.BoxGeometry(radius, radius, radius)
  if (shape === 'd8') return new THREE.OctahedronGeometry(radius, 0)
  if (shape === 'd12') return new THREE.DodecahedronGeometry(radius, 0)
  if (shape === 'd20') return new THREE.IcosahedronGeometry(radius, 0)
  return createD10Geometry(radius)
}

export function createCanonicalDiceManifest(shape) {
  const spec = getCanonicalDiceSpec(shape)
  const canvasSize = CANONICAL_CANVAS_SIZE
  const margin = Math.round(canvasSize * 0.047)
  const gap = Math.round(canvasSize * 0.027)
  const rows = Math.ceil(spec.canonicalFaceCount / spec.columns)
  const cellWidth = (canvasSize - margin * 2 - gap * (spec.columns - 1)) / spec.columns
  const cellHeight = (canvasSize - margin * 2 - gap * (rows - 1)) / rows
  const targetExtent = Math.min(cellWidth, cellHeight) * 0.78
  const geometry = createCanonicalDiceGeometry(shape)

  try {
    const triangles = getTriangles(geometry)
    const islands = createFaceGroups(spec, triangles).map((group, atlasIndex) => {
      const column = atlasIndex % spec.columns
      const row = Math.floor(atlasIndex / spec.columns)
      const center = {
        x: margin + column * (cellWidth + gap) + cellWidth / 2,
        y: margin + row * (cellHeight + gap) + cellHeight / 2,
      }
      const uniqueVertices = uniqueTriangleVertices(group.triangles)
      const normal = triangleNormal(group.triangles[0])
      const { tangent, bitangent } = createFaceBasis(normal)
      const centroid = uniqueVertices.reduce(
        (sum, point) => sum.add(point),
        new THREE.Vector3(),
      ).divideScalar(uniqueVertices.length)
      const projectedByPosition = new Map(uniqueVertices.map((point) => {
        const relative = point.clone().sub(centroid)
        return [pointKey(point), { x: relative.dot(tangent), y: relative.dot(bitangent) }]
      }))
      const projected = [...projectedByPosition.values()]
      const minX = Math.min(...projected.map((point) => point.x))
      const maxX = Math.max(...projected.map((point) => point.x))
      const minY = Math.min(...projected.map((point) => point.y))
      const maxY = Math.max(...projected.map((point) => point.y))
      const scale = targetExtent / Math.max(maxX - minX, maxY - minY)
      const toAtlas = (point) => ({
        x: center.x + (point.x - (minX + maxX) / 2) * scale,
        y: center.y - (point.y - (minY + maxY) / 2) * scale,
      })
      const atlasPolygon = orderPolygonPoints(projected.map(toAtlas))
      const baseline = canonicalEdge(atlasPolygon)
      const uvForPoint = (point) => {
        const projectedPoint = projectedByPosition.get(pointKey(point))
        if (!projectedPoint) throw new Error(`Missing projected point for ${shape}`)
        const atlasPoint = toAtlas(projectedPoint)
        return { u: round(atlasPoint.x / canvasSize), v: round(atlasPoint.y / canvasSize) }
      }
      const uvByTriangle = group.triangles.map((triangle) => triangle.map(uvForPoint))
      const meshTriangles = group.triangles.map((triangle, offset) => ({
        triangleIndex: group.triangleIndices[offset],
        positions: triangle.map((point) => point.toArray().map((value) => round(value))),
        uvs: uvByTriangle[offset].map(({ u, v }) => [u, v]),
      }))

      return {
        id: `${shape}-face-${group.faceValue}`,
        faceValue: group.faceValue,
        materialIndex: group.materialIndex,
        islandShape: spec.islandShape,
        triangleIndices: group.triangleIndices,
        triangleCount: group.triangleIndices.length,
        center: roundPoint(center),
        points: atlasPolygon.map(roundPoint),
        safePoints: atlasPolygon.map((point) => roundPoint({
          x: center.x + (point.x - center.x) * 0.66,
          y: center.y + (point.y - center.y) * 0.66,
        })),
        baselineEdge: baseline.vertexIndexes,
        baselineAngleDegrees: round(baseline.angleDegrees, 3),
        uvByTriangle,
        meshTriangles,
        sharedAtlasIsland: true,
      }
    })

    const manifest = {
      version: CANONICAL_MANIFEST_VERSION,
      shape,
      label: spec.label,
      canvasSize,
      columns: spec.columns,
      rows,
      coordinateSystem: {
        pixels: 'top-left atlas coordinates',
        uv: 'normalized top-left atlas coordinates; Blender consumers flip V on import',
        numberBaseline: 'baselineEdge is parallel to baselineAngleDegrees modulo 180 degrees',
      },
      geometry: {
        primitive: spec.geometryPrimitive,
        topology: 'non-subdivided canonical Three.js geometry',
        materialGroups: 'one group per physical face; all triangles in a group share one atlas island',
      },
      faceValues: [...spec.faceValues],
      canonicalFaceCount: spec.canonicalFaceCount,
      canonicalTriangleCount: spec.canonicalTriangleCount,
      trianglesPerFace: spec.trianglesPerFace,
      islandShape: spec.islandShape,
      materialMap: { ...spec.materialMap },
      opposingValueConvention: spec.opposingValueConvention,
      d10Contract: shape === 'd10' ? {
        faceInterpretation: '10 kite faces, not 20 triangular faces',
        trianglesPerKite: 2,
        sharedMaterialPerKite: true,
        values: '0-9',
      } : undefined,
      islands,
    }

    const validation = validateManifestStructure(manifest)
    if (!validation.valid) {
      throw new Error(`Generated ${shape} manifest is invalid:\n${validation.errors.join('\n')}`)
    }
    return manifest
  } finally {
    geometry.dispose()
  }
}

export function validateManifestStructure(manifest) {
  const errors = []
  const spec = manifest && CANONICAL_DICE_SPECS[manifest.shape]
  if (!spec) return { valid: false, errors: [`unsupported shape ${manifest?.shape}`] }

  if (manifest.version !== CANONICAL_MANIFEST_VERSION) {
    errors.push(`expected manifest version ${CANONICAL_MANIFEST_VERSION}, got ${manifest.version}`)
  }
  if (manifest.canvasSize !== CANONICAL_CANVAS_SIZE) {
    errors.push(`expected ${CANONICAL_CANVAS_SIZE}px canvas, got ${manifest.canvasSize}`)
  }
  if (manifest.faceValues?.join(',') !== spec.faceValues.join(',')) {
    errors.push(`face values must be exactly ${spec.faceValues.join(',')}`)
  }
  if (manifest.canonicalFaceCount !== spec.canonicalFaceCount) {
    errors.push(`expected ${spec.canonicalFaceCount} canonical faces, got ${manifest.canonicalFaceCount}`)
  }
  if (manifest.canonicalTriangleCount !== spec.canonicalTriangleCount) {
    errors.push(`expected ${spec.canonicalTriangleCount} triangles, got ${manifest.canonicalTriangleCount}`)
  }
  if (!Array.isArray(manifest.islands) || manifest.islands.length !== spec.canonicalFaceCount) {
    errors.push(`expected ${spec.canonicalFaceCount} islands, got ${manifest.islands?.length}`)
  }

  const values = new Set()
  const materials = new Set()
  const triangles = new Set()
  for (const island of manifest.islands ?? []) {
    validateIsland(island, manifest, spec, errors, values, materials, triangles)
  }

  if (values.size !== spec.canonicalFaceCount) errors.push('missing face values')
  if (materials.size !== spec.canonicalFaceCount) errors.push('missing material mappings')
  if (triangles.size !== spec.canonicalTriangleCount) errors.push('missing triangle mappings')
  if (manifest.shape === 'd10') validateD10Kites(manifest, errors)

  return { valid: errors.length === 0, errors }
}

function validateIsland(island, manifest, spec, errors, values, materials, triangles) {
  const label = `face ${island.faceValue}`
  if (values.has(island.faceValue)) errors.push(`duplicate face value ${island.faceValue}`)
  values.add(island.faceValue)
  if (!spec.faceValues.includes(island.faceValue)) errors.push(`out-of-range face value ${island.faceValue}`)
  if (materials.has(island.materialIndex)) errors.push(`duplicate material index ${island.materialIndex}`)
  materials.add(island.materialIndex)
  if (island.materialIndex !== spec.materialMap[island.faceValue]) {
    errors.push(`${label} maps to material ${island.materialIndex}, expected ${spec.materialMap[island.faceValue]}`)
  }

  const expectedTriangleIndices = Array.from(
    { length: spec.trianglesPerFace },
    (_, offset) => island.materialIndex * spec.trianglesPerFace + offset,
  )
  if (island.triangleCount !== spec.trianglesPerFace) {
    errors.push(`${label} must contain exactly ${spec.trianglesPerFace} triangles`)
  }
  if (island.triangleIndices?.join(',') !== expectedTriangleIndices.join(',')) {
    errors.push(`${label} triangles must be ${expectedTriangleIndices.join(',')}`)
  }
  for (const triangleIndex of island.triangleIndices ?? []) {
    if (triangles.has(triangleIndex)) errors.push(`duplicate triangle index ${triangleIndex}`)
    triangles.add(triangleIndex)
  }

  const points = island.points ?? []
  if (island.baselineEdge?.length !== 2 || island.baselineEdge.some((index) => index < 0 || index >= points.length)) {
    errors.push(`${label} has invalid baseline edge`)
  } else {
    const a = points[island.baselineEdge[0]]
    const b = points[island.baselineEdge[1]]
    const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
    const delta = normalizeUndirectedAngle(angle - island.baselineAngleDegrees)
    if (Math.abs(delta) > 0.01) errors.push(`${label} baseline is not parallel to persisted angle`)
  }

  if (island.uvByTriangle?.length !== spec.trianglesPerFace) {
    errors.push(`${label} has wrong UV triangle count`)
  }
  if (island.meshTriangles?.length !== spec.trianglesPerFace) {
    errors.push(`${label} has wrong mesh triangle count`)
  }
  for (let index = 0; index < spec.trianglesPerFace; index += 1) {
    const uvs = island.uvByTriangle?.[index]
    const meshTriangle = island.meshTriangles?.[index]
    if (!Array.isArray(uvs) || uvs.length !== 3) {
      errors.push(`${label} triangle ${index} must have three UV corners`)
      continue
    }
    for (const uv of uvs) {
      if (!Number.isFinite(uv.u) || !Number.isFinite(uv.v) || uv.u < 0 || uv.u > 1 || uv.v < 0 || uv.v > 1) {
        errors.push(`${label} has out-of-range or non-finite UV`)
      }
    }
    if (!meshTriangle || meshTriangle.triangleIndex !== island.triangleIndices?.[index]) {
      errors.push(`${label} mesh triangle ${index} has wrong canonical index`)
      continue
    }
    if (!Array.isArray(meshTriangle.positions) || meshTriangle.positions.length !== 3) {
      errors.push(`${label} mesh triangle ${index} must have three positions`)
    }
    if (meshTriangle.uvs?.length !== 3 || JSON.stringify(meshTriangle.uvs) !== JSON.stringify(uvs.map(({ u, v }) => [u, v]))) {
      errors.push(`${label} mesh triangle ${index} UVs diverge from uvByTriangle`)
    }
  }

  const polygonUvs = points.map((point) => ({
    u: point.x / manifest.canvasSize,
    v: point.y / manifest.canvasSize,
  }))
  for (const triangle of island.uvByTriangle ?? []) {
    for (const uv of triangle) {
      const landsOnPolygon = polygonUvs.some((point) => (
        Math.abs(point.u - uv.u) <= 1e-5 && Math.abs(point.v - uv.v) <= 1e-5
      ))
      if (!landsOnPolygon) errors.push(`${label} UV does not land on its canonical island polygon`)
    }
  }
}

function validateD10Kites(manifest, errors) {
  for (const island of manifest.islands ?? []) {
    const label = `D10 face ${island.faceValue}`
    if (island.triangleCount !== 2 || island.sharedAtlasIsland !== true) {
      errors.push(`${label} must pair exactly two triangles on one island`)
      continue
    }
    const [first, second] = island.meshTriangles ?? []
    if (!first?.positions || !second?.positions) continue
    const firstPoints = first.positions.map(vectorFromArray)
    const secondPoints = second.positions.map(vectorFromArray)
    const shared = firstPoints.filter((point) => secondPoints.some((candidate) => samePoint(point, candidate)))
    const unique = uniqueVectors([...firstPoints, ...secondPoints])
    const sharedApex = shared.filter((point) => Math.abs(Math.abs(point.y) - 1) < 1e-4)
    const ringVertices = unique.filter((point) => Math.abs(Math.abs(point.y) - 1) >= 1e-4)
    if (shared.length !== 2 || unique.length !== 4 || sharedApex.length !== 1 || ringVertices.length !== 3) {
      errors.push(`${label} is not a two-triangle kite with one shared apex-ring edge`)
    }
    if (triangleNormal(firstPoints).dot(triangleNormal(secondPoints)) < 0.9999) {
      errors.push(`${label} triangles are not coplanar`)
    }
  }
}

function createD10Geometry(size) {
  const vertices = [0, size, 0, 0, -size, 0]
  const altitude = size * D10_GEOMETRY_CONTRACT.altitudeRatio
  for (let index = 0; index < D10_GEOMETRY_CONTRACT.ringVertexCount; index += 1) {
    const angle = index * Math.PI * 2 / D10_GEOMETRY_CONTRACT.ringVertexCount
    vertices.push(
      -Math.cos(angle) * size,
      altitude * D10_GEOMETRY_CONTRACT.ringHeightParity[index % 2],
      -Math.sin(angle) * size,
    )
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(D10_GEOMETRY_CONTRACT.triangleIndices)
  return geometry
}

function getTriangles(geometry) {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry
  try {
    const position = nonIndexed.getAttribute('position')
    return Array.from({ length: position.count / 3 }, (_, triangleIndex) => (
      [0, 1, 2].map((offset) => (
        new THREE.Vector3().fromBufferAttribute(position, triangleIndex * 3 + offset)
      ))
    ))
  } finally {
    if (nonIndexed !== geometry) nonIndexed.dispose()
  }
}

function createFaceGroups(spec, triangles) {
  return spec.faceValues.map((faceValue) => {
    const materialIndex = spec.materialMap[faceValue]
    const start = materialIndex * spec.trianglesPerFace
    return {
      faceValue,
      materialIndex,
      triangleIndices: Array.from({ length: spec.trianglesPerFace }, (_, offset) => start + offset),
      triangles: triangles.slice(start, start + spec.trianglesPerFace),
    }
  })
}

function uniqueTriangleVertices(triangles) {
  return uniqueVectors(triangles.flat())
}

function uniqueVectors(vectors) {
  return [...new Map(vectors.map((point) => [pointKey(point), point])).values()]
}

function createFaceBasis(normal) {
  const reference = Math.abs(normal.y) > 0.92
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3().crossVectors(reference, normal).normalize()
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize()
  return { tangent, bitangent }
}

function orderPolygonPoints(points) {
  const center = points.reduce(
    (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
    { x: 0, y: 0 },
  )
  return [...points].sort((first, second) => (
    Math.atan2(first.y - center.y, first.x - center.x)
      - Math.atan2(second.y - center.y, second.x - center.x)
  ))
}

function canonicalEdge(points) {
  let selected = null
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]
    const end = points[(index + 1) % points.length]
    const angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI
    const undirected = normalizeUndirectedAngle(angle)
    const candidate = { vertexIndexes: [index, (index + 1) % points.length], angleDegrees: undirected }
    if (!selected || Math.abs(undirected) < Math.abs(selected.angleDegrees)) selected = candidate
  }
  return selected
}

function normalizeUndirectedAngle(angle) {
  return ((angle + 90) % 180 + 180) % 180 - 90
}

function triangleNormal([a, b, c]) {
  return new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
}

function vectorFromArray(value) {
  return new THREE.Vector3(value[0], value[1], value[2])
}

function samePoint(first, second) {
  return first.distanceToSquared(second) < 1e-8
}

function pointKey(point) {
  return point.toArray().map((value) => round(value, 5)).join(',')
}

function roundPoint(point) {
  return { x: round(point.x, 3), y: round(point.y, 3) }
}

function round(value, places = 6) {
  const multiplier = 10 ** places
  const rounded = Math.round(value * multiplier) / multiplier
  return Object.is(rounded, -0) ? 0 : rounded
}
