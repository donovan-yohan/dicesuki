import * as THREE from 'three'
import type { DiceFace } from './geometries'

const MODEL_FACE_DOT_THRESHOLD = 0.995
const UV_AREA_EPSILON = 1e-8

export interface ProductionDiceModelFaceValidation {
  modelNormal: THREE.Vector3
  matchedValue: number
  alignment: number
  uvTriangleCount: number
}

interface ModelTriangle {
  normal: THREE.Vector3
  hasValidUv: boolean
}

export function validateProductionDiceModelFace(
  scene: THREE.Object3D,
  requestedFace: DiceFace,
  faceNormals: DiceFace[],
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

  const triangles = collectModelTriangles(scene).filter((triangle) => triangle.hasValidUv)
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

  const uvTriangleCount = triangles.filter(
    (triangle) => triangle.normal.dot(bestNormal!) >= MODEL_FACE_DOT_THRESHOLD,
  ).length

  return {
    modelNormal: bestNormal.clone(),
    matchedValue: matchedFace.face.value,
    alignment: bestAlignment,
    uvTriangleCount,
  }
}

function collectModelTriangles(scene: THREE.Object3D): ModelTriangle[] {
  const triangles: ModelTriangle[] = []
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
      const indices = [0, 1, 2].map((vertex) => index?.getX(offset + vertex) ?? offset + vertex)
      const vertices = indices.map((vertexIndex) => (
        new THREE.Vector3().fromBufferAttribute(position, vertexIndex).applyMatrix4(object.matrixWorld)
      ))
      const normal = new THREE.Vector3()
        .crossVectors(vertices[1].clone().sub(vertices[0]), vertices[2].clone().sub(vertices[0]))
      if (!isFiniteVector(normal) || normal.lengthSq() === 0) continue
      normal.normalize()

      let hasValidUv = false
      if (uv) {
        const uvPoints = indices.map((vertexIndex) => new THREE.Vector2().fromBufferAttribute(uv, vertexIndex))
        hasValidUv = uvPoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
          && Math.abs(
            (uvPoints[1].x - uvPoints[0].x) * (uvPoints[2].y - uvPoints[0].y)
            - (uvPoints[2].x - uvPoints[0].x) * (uvPoints[1].y - uvPoints[0].y),
          ) > UV_AREA_EPSILON
      }

      triangles.push({ normal, hasValidUv })
    }
  })

  return triangles
}

function isFiniteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)
}
