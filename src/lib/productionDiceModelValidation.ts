import * as THREE from 'three'
import type { DiceFace } from './geometries'

const MODEL_FACE_DOT_THRESHOLD = 0.995
const UV_AREA_EPSILON = 1e-8

export interface ProductionDiceModelFaceValidation {
  modelNormal: THREE.Vector3
  matchedValue: number
  alignment: number
  uvTriangleCount: number
  materialIndex: number
}

interface ModelTriangle {
  triangleIndex: number
  normal: THREE.Vector3
  uv?: [THREE.Vector2, THREE.Vector2, THREE.Vector2]
}

interface CanonicalUvPoint {
  u: number
  v: number
}

interface CanonicalUvIsland {
  faceValue: number
  materialIndex: number
  triangleIndices?: number[]
  uvByTriangle?: CanonicalUvPoint[][]
  uvByVertex?: CanonicalUvPoint[]
}

export interface CanonicalDiceUvManifest {
  shape: string
  islands: CanonicalUvIsland[]
}

export function validateProductionDiceModelFace(
  scene: THREE.Object3D,
  diceType: string,
  requestedFace: DiceFace,
  faceNormals: DiceFace[],
  manifest: CanonicalDiceUvManifest,
): ProductionDiceModelFaceValidation {
  const values = new Set(faceNormals.map((face) => face.value))
  if (values.size !== faceNormals.length) {
    throw new Error('Dice metadata contains duplicate face values')
  }
  if (!values.has(requestedFace.value)) {
    throw new Error(`Requested face ${requestedFace.value} is missing from dice metadata`)
  }

  const requestedNormal = requestedFace.normal.clone()
  if (!isFiniteVector(requestedNormal) || requestedNormal.lengthSq() === 0) {
    throw new Error(`Requested face ${requestedFace.value} has an invalid normal`)
  }
  requestedNormal.normalize()

  if (manifest.shape !== diceType) {
    throw new Error(`Canonical UV manifest shape ${manifest.shape} does not match dice type ${diceType}`)
  }
  const matchingIslands = manifest.islands.filter((island) => island.faceValue === requestedFace.value)
  if (matchingIslands.length !== 1) {
    throw new Error(`Canonical UV manifest must contain exactly one island for face ${requestedFace.value}`)
  }
  const materialIndexes = new Set(manifest.islands.map((island) => island.materialIndex))
  if (materialIndexes.size !== manifest.islands.length) {
    throw new Error('Canonical UV manifest contains duplicate material indexes')
  }
  const canonicalIsland = matchingIslands[0]
  const expectedUvTriangles = getExpectedUvTriangles(canonicalIsland)
  const expectedTriangleIndices = getExpectedTriangleIndices(canonicalIsland, expectedUvTriangles.length)

  const triangles = collectModelTriangles(scene).filter((triangle) => triangle.uv)
  if (triangles.length === 0) {
    throw new Error('GLB model has no non-degenerate UV-mapped triangles')
  }

  let bestAlignment = -Infinity
  let bestNormal: THREE.Vector3 | null = null
  for (const triangle of triangles) {
    const alignment = triangle.normal.dot(requestedNormal)
    if (alignment > bestAlignment) {
      bestAlignment = alignment
      bestNormal = triangle.normal
    }
  }

  if (!bestNormal || bestAlignment < MODEL_FACE_DOT_THRESHOLD) {
    throw new Error(
      `GLB geometry has no UV-mapped face matching requested face ${requestedFace.value} `
      + `(best alignment ${bestAlignment.toFixed(4)})`,
    )
  }

  const rankedFaces = faceNormals
    .map((face) => ({
      face,
      alignment: bestNormal!.dot(face.normal.clone().normalize()),
    }))
    .sort((left, right) => right.alignment - left.alignment)
  const matchedFace = rankedFaces[0]
  const runnerUp = rankedFaces[1]
  if (matchedFace.face.value !== requestedFace.value) {
    throw new Error(
      `GLB geometry for requested face ${requestedFace.value} maps most closely to metadata face ${matchedFace.face.value}`,
    )
  }
  if (runnerUp && matchedFace.alignment - runnerUp.alignment < 1e-4) {
    throw new Error(`GLB geometry for requested face ${requestedFace.value} is ambiguous`)
  }

  const alignedTriangles = triangles.filter(
    (triangle) => triangle.normal.dot(bestNormal!) >= MODEL_FACE_DOT_THRESHOLD,
  )
  if (!triangleIndexesMatch(alignedTriangles, expectedTriangleIndices)) {
    throw new Error(
      `GLB triangle group for face ${requestedFace.value} does not match canonical `
      + `material island ${canonicalIsland.materialIndex}`,
    )
  }
  if (!uvTriangleGroupsMatch(alignedTriangles, expectedUvTriangles)) {
    throw new Error(
      `GLB UV mapping for face ${requestedFace.value} does not match canonical `
      + `material island ${canonicalIsland.materialIndex}`,
    )
  }

  return {
    modelNormal: bestNormal.clone(),
    matchedValue: matchedFace.face.value,
    alignment: bestAlignment,
    uvTriangleCount: alignedTriangles.length,
    materialIndex: canonicalIsland.materialIndex,
  }
}

function collectModelTriangles(scene: THREE.Object3D): ModelTriangle[] {
  const triangles: ModelTriangle[] = []
  let triangleIndex = 0
  scene.updateWorldMatrix(true, true)

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const geometry = object.geometry
    const position = geometry.getAttribute('position')
    if (!position) return
    const uv = geometry.getAttribute('uv')
    const index = geometry.index
    const indexCount = index?.count ?? position.count

    for (let offset = 0; offset + 2 < indexCount; offset += 3) {
      const currentTriangleIndex = triangleIndex++
      const indices = [0, 1, 2].map((vertex) => index?.getX(offset + vertex) ?? offset + vertex)
      const vertices = indices.map((vertexIndex) => (
        new THREE.Vector3().fromBufferAttribute(position, vertexIndex).applyMatrix4(object.matrixWorld)
      ))
      const normal = new THREE.Vector3()
        .crossVectors(vertices[1].clone().sub(vertices[0]), vertices[2].clone().sub(vertices[0]))
      if (!isFiniteVector(normal) || normal.lengthSq() === 0) continue
      normal.normalize()

      let triangleUv: ModelTriangle['uv']
      if (uv) {
        const uvPoints = indices.map(
          (vertexIndex) => new THREE.Vector2().fromBufferAttribute(uv, vertexIndex),
        ) as [THREE.Vector2, THREE.Vector2, THREE.Vector2]
        const hasValidUv = uvPoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
          && Math.abs(
            (uvPoints[1].x - uvPoints[0].x) * (uvPoints[2].y - uvPoints[0].y)
            - (uvPoints[2].x - uvPoints[0].x) * (uvPoints[1].y - uvPoints[0].y),
          ) > UV_AREA_EPSILON
        if (hasValidUv) triangleUv = uvPoints
      }

      triangles.push({ triangleIndex: currentTriangleIndex, normal, uv: triangleUv })
    }
  })

  return triangles
}

function getExpectedUvTriangles(island: CanonicalUvIsland): CanonicalUvPoint[][] {
  const triangles = island.uvByTriangle
    ?? (island.uvByVertex ? [island.uvByVertex] : [])
  const expectedTriangleCount = island.triangleIndices?.length ?? triangles.length
  if (triangles.length === 0 || triangles.length !== expectedTriangleCount) {
    throw new Error(`Canonical UV island for face ${island.faceValue} has an invalid triangle contract`)
  }
  if (triangles.some((triangle) => triangle.length !== 3)) {
    throw new Error(`Canonical UV island for face ${island.faceValue} contains a non-triangle UV mapping`)
  }
  return triangles
}

function triangleIndexesMatch(
  actualTriangles: ModelTriangle[],
  expectedTriangleIndices: number[],
): boolean {
  if (actualTriangles.length !== expectedTriangleIndices.length) return false
  const actual = actualTriangles.map((triangle) => triangle.triangleIndex).sort((left, right) => left - right)
  const expected = [...expectedTriangleIndices].sort((left, right) => left - right)
  return actual.every((triangleIndex, index) => triangleIndex === expected[index])
}

function getExpectedTriangleIndices(island: CanonicalUvIsland, triangleCount: number): number[] {
  const materialTriangleIndices = Array.from(
    { length: triangleCount },
    (_, offset) => island.materialIndex * triangleCount + offset,
  )
  if (!island.triangleIndices) return materialTriangleIndices

  const declared = [...island.triangleIndices].sort((left, right) => left - right)
  if (!declared.every((triangleIndex, index) => triangleIndex === materialTriangleIndices[index])) {
    throw new Error(`Canonical material island ${island.materialIndex} has inconsistent triangle indices`)
  }
  return declared
}

function uvTriangleGroupsMatch(
  actualTriangles: ModelTriangle[],
  expectedTriangles: CanonicalUvPoint[][],
): boolean {
  if (actualTriangles.length !== expectedTriangles.length) return false
  const unmatched = [...expectedTriangles]

  for (const actual of actualTriangles) {
    if (!actual.uv) return false
    const matchIndex = unmatched.findIndex((expected) => uvTrianglesMatch(actual.uv!, expected))
    if (matchIndex === -1) return false
    unmatched.splice(matchIndex, 1)
  }

  return unmatched.length === 0
}

function uvTrianglesMatch(
  actual: [THREE.Vector2, THREE.Vector2, THREE.Vector2],
  expected: CanonicalUvPoint[],
): boolean {
  const unmatched = [...expected]
  for (const point of actual) {
    const matchIndex = unmatched.findIndex(
      (candidate) => Math.abs(candidate.u - point.x) <= 1e-5 && Math.abs(candidate.v - point.y) <= 1e-5,
    )
    if (matchIndex === -1) return false
    unmatched.splice(matchIndex, 1)
  }
  return unmatched.length === 0
}

function isFiniteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)
}
