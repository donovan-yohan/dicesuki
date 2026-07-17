import * as THREE from 'three'

export const SUPPORTED_DICE_SHAPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

const MAPS = {
  d4: [0, 1, 2, 3],
  d6: [3, 4, 0, 1, 5, 2],
  d8: [0, 1, 2, 3, 6, 7, 4, 5],
  d10: [0, 6, 1, 5, 2, 9, 3, 8, 4, 7],
  d12: [0, 1, 2, 3, 5, 6, 10, 11, 9, 7, 4, 8],
  d20: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 15, 19, 18, 17, 14, 10, 11, 12, 13],
}

const OPPOSITE_CONVENTIONS = {
  d4: { type: 'vertex-opposite-face', vertexValues: { v0: 2, v1: 4, v2: 3, v3: 1 } },
  d6: { type: 'sum', sum: 7 },
  d8: { type: 'sum', sum: 9 },
  d10: { type: 'sum', sum: 9 },
  d12: { type: 'sum', sum: 13 },
  d20: { type: 'sum', sum: 21 },
}
const FACE_COUNTS = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 }
const TRIANGLES_PER_FACE = { d4: 1, d6: 2, d8: 1, d10: 2, d12: 3, d20: 1 }
const ISLAND_SHAPES = { d4: 'triangle', d6: 'square', d8: 'triangle', d10: 'kite', d12: 'pentagon', d20: 'triangle' }
const COLUMNS = { d4: 2, d6: 3, d8: 4, d10: 5, d12: 4, d20: 5 }

export const THEMED_DICE_SHAPE_SPECS = Object.freeze(Object.fromEntries(
  SUPPORTED_DICE_SHAPES.map((shape) => {
    const faceValues = shape === 'd10'
      ? Array.from({ length: 10 }, (_, value) => value)
      : Array.from({ length: FACE_COUNTS[shape] }, (_, index) => index + 1)
    const materialMap = Object.fromEntries(faceValues.map((value, index) => [value, MAPS[shape][index]]))
    return [shape, Object.freeze({
      shape,
      label: shape.toUpperCase(),
      faceValues,
      canonicalFaceCount: FACE_COUNTS[shape],
      islandShape: ISLAND_SHAPES[shape],
      trianglesPerFace: TRIANGLES_PER_FACE[shape],
      canonicalTriangleCount: FACE_COUNTS[shape] * TRIANGLES_PER_FACE[shape],
      columns: COLUMNS[shape],
      geometry: {
        primitive: shape === 'd4' ? 'TetrahedronGeometry' : shape === 'd6' ? 'BoxGeometry' : shape === 'd8' ? 'OctahedronGeometry' : shape === 'd10' ? 'pentagonal-trapezohedron' : shape === 'd12' ? 'DodecahedronGeometry' : 'IcosahedronGeometry',
        materialGroups: 'one group per canonical face; all triangles in a group share its atlas island and material index',
      },
      materialMap,
      opposingValueConvention: OPPOSITE_CONVENTIONS[shape],
      d10Contract: shape === 'd10' ? {
        faceInterpretation: '10 kite faces, not 20 triangular faces',
        trianglesPerKite: 2,
        sharedMaterialPerKite: true,
        values: '0-9',
      } : undefined,
    })]
  }),
))

export function getThemedDiceShapeSpec(shape) {
  const spec = THEMED_DICE_SHAPE_SPECS[shape]
  if (!spec) throw new Error(`Unsupported themed dice shape: ${shape}`)
  return spec
}

export function createThemedDiceGeometry(shape, radius = 1) {
  getThemedDiceShapeSpec(shape)
  if (shape === 'd4') return new THREE.TetrahedronGeometry(radius, 0)
  if (shape === 'd6') return new THREE.BoxGeometry(radius, radius, radius)
  if (shape === 'd8') return new THREE.OctahedronGeometry(radius, 0)
  if (shape === 'd12') return new THREE.DodecahedronGeometry(radius, 0)
  if (shape === 'd20') return new THREE.IcosahedronGeometry(radius, 0)
  return createD10Geometry(radius)
}

function createD10Geometry(size) {
  const vertices = [0, size, 0, 0, -size, 0]
  const altitude = size / (5 + 2 * Math.sqrt(5))
  for (let index = 0; index < 10; index += 1) {
    const angle = index * Math.PI * 2 / 10
    // The alternating sign is chosen so each two-triangle kite is coplanar.
    vertices.push(-Math.cos(angle) * size, altitude * (index % 2 ? -1 : 1), -Math.sin(angle) * size)
  }
  const indices = [
    0, 3, 2, 0, 4, 3, 0, 5, 4, 0, 6, 5, 0, 7, 6, 0, 8, 7, 0, 9, 8, 0, 10, 9, 0, 11, 10, 0, 2, 11,
    1, 3, 4, 1, 4, 5, 1, 5, 6, 1, 6, 7, 1, 7, 8, 1, 8, 9, 1, 9, 10, 1, 10, 11, 1, 11, 2, 1, 2, 3,
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  return geometry
}

function round(value, places = 6) {
  return Number(value.toFixed(places))
}

function roundPoint(point) {
  return { x: round(point.x, 3), y: round(point.y, 3) }
}

function regularPolygon(center, radius, sides, rotation = -Math.PI / 2) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + index * Math.PI * 2 / sides
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
  })
}

function islandPoints(shape, center, radius) {
  if (shape === 'square') return [
    { x: center.x - radius, y: center.y - radius }, { x: center.x + radius, y: center.y - radius },
    { x: center.x + radius, y: center.y + radius }, { x: center.x - radius, y: center.y + radius },
  ]
  if (shape === 'kite') return [
    { x: center.x, y: center.y - radius }, { x: center.x + radius * 0.58, y: center.y },
    { x: center.x, y: center.y + radius }, { x: center.x - radius * 0.58, y: center.y },
  ]
  return regularPolygon(center, radius, shape === 'pentagon' ? 5 : 3)
}

function canonicalEdge(points) {
  let selected = null
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]
    const end = points[(index + 1) % points.length]
    const angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI
    const undirected = ((angle + 90) % 180 + 180) % 180 - 90
    const candidate = { vertexIndexes: [index, (index + 1) % points.length], angleDegrees: undirected }
    if (!selected || Math.abs(undirected) < Math.abs(selected.angleDegrees)) selected = candidate
  }
  return selected
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

function createFaceBasis(normal) {
  const reference = Math.abs(normal.y) > 0.92
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3().crossVectors(reference, normal).normalize()
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize()
  return { tangent, bitangent }
}

function getTriangles(geometry) {
  const indexed = geometry.index ? geometry.toNonIndexed() : geometry
  const position = indexed.getAttribute('position')
  const triangles = []
  for (let triangleIndex = 0; triangleIndex < position.count / 3; triangleIndex += 1) {
    triangles.push([0, 1, 2].map((offset) => new THREE.Vector3().fromBufferAttribute(position, triangleIndex * 3 + offset)))
  }
  if (indexed !== geometry) indexed.dispose()
  return triangles
}

function faceGroups(shape, triangles) {
  const spec = getThemedDiceShapeSpec(shape)
  return spec.faceValues.map((faceValue) => {
    const materialIndex = spec.materialMap[faceValue]
    const start = materialIndex * spec.trianglesPerFace
    return { faceValue, materialIndex, triangleIndices: Array.from({ length: spec.trianglesPerFace }, (_, offset) => start + offset), triangles: triangles.slice(start, start + spec.trianglesPerFace) }
  })
}

export function createThemedDiceManifest(shape, options = {}) {
  const spec = getThemedDiceShapeSpec(shape)
  const canvasSize = options.canvasSize ?? 2048
  const margin = options.margin ?? Math.round(canvasSize * 0.047)
  const gap = options.gap ?? Math.round(canvasSize * 0.027)
  const rows = Math.ceil(spec.canonicalFaceCount / spec.columns)
  const cellWidth = (canvasSize - margin * 2 - gap * (spec.columns - 1)) / spec.columns
  const cellHeight = (canvasSize - margin * 2 - gap * (rows - 1)) / rows
  const targetExtent = Math.min(cellWidth, cellHeight) * 0.78
  const geometry = createThemedDiceGeometry(shape, options.radius ?? 1)
  const triangles = getTriangles(geometry)
  const groups = faceGroups(shape, triangles)
  const islands = groups.map((group, atlasIndex) => {
    const value = group.faceValue
    const column = atlasIndex % spec.columns
    const row = Math.floor(atlasIndex / spec.columns)
    const center = { x: margin + column * (cellWidth + gap) + cellWidth / 2, y: margin + row * (cellHeight + gap) + cellHeight / 2 }
    const rawPoints = group.triangles.flat().map((point) => point.toArray().map((part) => round(part, 5)).join(','))
    const unique = [...new Map(rawPoints.map((key) => [key, key.split(',').map(Number)])).values()]
    const normal = new THREE.Vector3().crossVectors(group.triangles[0][1].clone().sub(group.triangles[0][0]), group.triangles[0][2].clone().sub(group.triangles[0][0])).normalize()
    const { tangent, bitangent } = createFaceBasis(normal)
    const centroid = unique.reduce(
      (sum, [x, y, z]) => sum.add(new THREE.Vector3(x, y, z)),
      new THREE.Vector3(),
    ).divideScalar(unique.length)
    const projected = unique.map(([x, y, z]) => {
      const point = new THREE.Vector3(x, y, z).sub(centroid)
      return { x: point.dot(tangent), y: point.dot(bitangent) }
    })
    const minX = Math.min(...projected.map((point) => point.x)); const maxX = Math.max(...projected.map((point) => point.x))
    const minY = Math.min(...projected.map((point) => point.y)); const maxY = Math.max(...projected.map((point) => point.y))
    const scale = targetExtent / Math.max(maxX - minX, maxY - minY)
    const toAtlas = (point) => ({ x: center.x + (point.x - (minX + maxX) / 2) * scale, y: center.y - (point.y - (minY + maxY) / 2) * scale })
    const atlasPolygon = orderPolygonPoints(projected.map(toAtlas))
    const baseline = canonicalEdge(atlasPolygon)
    const uvForPoint = (point) => { const key = point.toArray().map((part) => round(part, 5)).join(','); const index = rawPoints.indexOf(key); const projectedPoint = projected[unique.findIndex((candidate) => candidate.join(',') === key)] ; return { vertexIndex: index, u: round((center.x + (projectedPoint.x - (minX + maxX) / 2) * scale) / canvasSize), v: round((center.y - (projectedPoint.y - (minY + maxY) / 2) * scale) / canvasSize) } }
    const triangleUv = group.triangles.map((triangle) => triangle.map(uvForPoint))
    return { id: `${shape}-face-${value}`, faceValue: value, materialIndex: group.materialIndex, islandShape: spec.islandShape, triangleIndices: group.triangleIndices, triangleCount: group.triangleIndices.length, center: roundPoint(center), points: atlasPolygon.map(roundPoint), safePoints: atlasPolygon.map((point) => roundPoint({ x: center.x + (point.x - center.x) * 0.66, y: center.y + (point.y - center.y) * 0.66 })), baselineEdge: baseline.vertexIndexes, baselineAngleDegrees: round(baseline.angleDegrees, 3), uvByTriangle: triangleUv, uvByVertex: triangleUv[0], sharedAtlasIsland: true }
  })
  geometry.dispose()
  const manifest = { version: '1.0', shape, label: spec.label, canvasSize, columns: spec.columns, rows, coordinateSystem: { pixels: 'top-left atlas coordinates', uv: 'glTF normalized top-left coordinates', numberBaseline: 'persisted baseline edge is parallel to the selected canonical island edge' }, geometry: spec.geometry, faceValues: spec.faceValues, canonicalFaceCount: spec.canonicalFaceCount, canonicalTriangleCount: spec.canonicalTriangleCount, trianglesPerFace: spec.trianglesPerFace, islandShape: spec.islandShape, materialMap: spec.materialMap, opposingValueConvention: spec.opposingValueConvention, d10Contract: spec.d10Contract, islands }
  const result = validateThemedDiceManifest(manifest)
  if (!result.valid) throw new Error(`Generated ${shape} manifest is invalid:\n${result.errors.join('\n')}`)
  return manifest
}

export function getThemedDiceFaceNormals(shape, radius = 1) {
  const geometry = createThemedDiceGeometry(shape, radius)
  const groups = faceGroups(shape, getTriangles(geometry))
  const normals = groups.map((group) => {
    const [a, b, c] = group.triangles[0]
    const normal = new THREE.Vector3()
      .crossVectors(b.clone().sub(a), c.clone().sub(a))
      .normalize()
    return {
      value: group.faceValue,
      normal: [round(normal.x, 6), round(normal.y, 6), round(normal.z, 6)],
    }
  })
  geometry.dispose()
  return normals
}

export function validateThemedDiceManifest(manifest) {
  const errors = []
  const spec = manifest && THEMED_DICE_SHAPE_SPECS[manifest.shape]
  if (!spec) return { valid: false, errors: [`unsupported shape ${manifest?.shape}`] }
  if (manifest.canonicalFaceCount !== spec.canonicalFaceCount) errors.push(`expected ${spec.canonicalFaceCount} canonical faces, got ${manifest.canonicalFaceCount}`)
  if (manifest.canonicalTriangleCount !== spec.canonicalTriangleCount) errors.push(`expected ${spec.canonicalTriangleCount} triangles, got ${manifest.canonicalTriangleCount}`)
  if (!Array.isArray(manifest.islands) || manifest.islands.length !== spec.canonicalFaceCount) errors.push(`expected ${spec.canonicalFaceCount} islands, got ${manifest.islands?.length}`)
  const values = new Set(); const materials = new Set(); const triangles = new Set()
  for (const island of manifest.islands ?? []) {
    if (values.has(island.faceValue)) errors.push(`duplicate face value ${island.faceValue}`); values.add(island.faceValue)
    if (!spec.faceValues.includes(island.faceValue)) errors.push(`out-of-range face value ${island.faceValue}`)
    if (materials.has(island.materialIndex)) errors.push(`duplicate material index ${island.materialIndex}`); materials.add(island.materialIndex)
    if (island.materialIndex !== spec.materialMap[island.faceValue]) errors.push(`face ${island.faceValue} maps to material ${island.materialIndex}, expected ${spec.materialMap[island.faceValue]}`)
    if (island.triangleCount !== spec.trianglesPerFace || island.triangleIndices?.length !== spec.trianglesPerFace) errors.push(`face ${island.faceValue} must contain exactly ${spec.trianglesPerFace} triangles`)
    for (const triangleIndex of island.triangleIndices ?? []) { if (triangles.has(triangleIndex)) errors.push(`duplicate triangle index ${triangleIndex}`); triangles.add(triangleIndex) }
    const points = island.points ?? []
    if (island.baselineEdge?.length !== 2 || island.baselineEdge.some((index) => index < 0 || index >= points.length)) errors.push(`face ${island.faceValue} has invalid baseline edge`)
    else { const a = points[island.baselineEdge[0]]; const b = points[island.baselineEdge[1]]; const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; const normalized = ((angle - island.baselineAngleDegrees + 90) % 180 + 180) % 180 - 90; if (Math.abs(normalized) > 0.01) errors.push(`face ${island.faceValue} baseline is not parallel to persisted angle`) }
    for (const triangle of island.uvByTriangle ?? []) for (const uv of triangle) if (uv.u < 0 || uv.u > 1 || uv.v < 0 || uv.v > 1) errors.push(`face ${island.faceValue} has out-of-range UV`)
  }
  if (spec.shape === 'd10') {
    if (manifest.faceValues?.join(',') !== '0,1,2,3,4,5,6,7,8,9') errors.push('D10 values must be exactly 0-9')
    const d10Geometry = createThemedDiceGeometry('d10')
    const d10Triangles = getTriangles(d10Geometry)
    for (const island of manifest.islands ?? []) {
      if (island.triangleCount !== 2 || island.sharedAtlasIsland !== true) errors.push(`D10 face ${island.faceValue} must pair exactly two triangles on one island`)
      const expectedStart = island.materialIndex * 2
      if (island.triangleIndices?.[0] !== expectedStart || island.triangleIndices?.[1] !== expectedStart + 1) {
        errors.push(`D10 face ${island.faceValue} must map to consecutive triangle pair ${expectedStart},${expectedStart + 1}`)
        continue
      }
      const [first, second] = d10Triangles.slice(expectedStart, expectedStart + 2)
      const firstNormal = triangleNormal(first)
      const secondNormal = triangleNormal(second)
      const shared = first.filter((point) => second.some((candidate) => samePoint(point, candidate)))
      const unique = [...new Map([...first, ...second].map((point) => [pointKey(point), point])).values()]
      const sharedApex = shared.filter((point) => Math.abs(Math.abs(point.y) - 1) < 1e-4)
      const ringVertices = unique.filter((point) => Math.abs(Math.abs(point.y) - 1) >= 1e-4)
      if (shared.length !== 2 || unique.length !== 4 || sharedApex.length !== 1 || ringVertices.length !== 3) {
        errors.push(`D10 face ${island.faceValue} is not a valid two-triangle kite with shared apex-ring edge`)
      }
      if (firstNormal.dot(secondNormal) < 0.9999) {
        errors.push(`D10 face ${island.faceValue} triangles are not coplanar`)
      }
    }
    d10Geometry.dispose()
  }
  if (values.size !== spec.canonicalFaceCount) errors.push('missing face values')
  if (materials.size !== spec.canonicalFaceCount) errors.push('missing material mappings')
  if (triangles.size !== spec.canonicalTriangleCount) errors.push('missing triangle mappings')
  return { valid: errors.length === 0, errors }
}

function pointKey(point) {
  return point.toArray().map((value) => value.toFixed(5)).join(',')
}

function samePoint(first, second) {
  return first.distanceToSquared(second) < 1e-8
}

function triangleNormal([a, b, c]) {
  return new THREE.Vector3()
    .crossVectors(b.clone().sub(a), c.clone().sub(a))
    .normalize()
}
