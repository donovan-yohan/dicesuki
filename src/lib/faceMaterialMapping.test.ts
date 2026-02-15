import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  FACE_MATERIAL_MAPS,
  getFaceNormals,
  validateFaceNormalRules,
} from './faceMaterialMapping'
import { generateMaterialMapping } from './geometryFaceMapper'
import {
  DiceShape,
  getDiceFaceValue,
  createD4Geometry,
  createD6Geometry,
  createD8Geometry,
  createD10Geometry,
  createD12Geometry,
  createD20Geometry,
} from './geometries'

const GEOMETRY_CREATORS: Record<DiceShape, (size?: number) => THREE.BufferGeometry> = {
  d4: createD4Geometry,
  d6: createD6Geometry,
  d8: createD8Geometry,
  d10: createD10Geometry,
  d12: createD12Geometry,
  d20: createD20Geometry,
}

const DICE_TYPES: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

/**
 * Extract the actual face normals from geometry by computing triangle normals
 * and grouping triangles with nearly-identical normals.
 */
function extractActualGeometryFaces(shape: DiceShape): {
  normal: THREE.Vector3
  triangles: number[]
}[] {
  const geometry = GEOMETRY_CREATORS[shape](1)
  const posAttr = geometry.getAttribute('position')
  const indexAttr = geometry.getIndex()
  const triangleCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3

  const normals: THREE.Vector3[] = []
  for (let i = 0; i < triangleCount; i++) {
    let v1: THREE.Vector3, v2: THREE.Vector3, v3: THREE.Vector3
    if (indexAttr) {
      v1 = new THREE.Vector3().fromBufferAttribute(posAttr, indexAttr.getX(i * 3))
      v2 = new THREE.Vector3().fromBufferAttribute(posAttr, indexAttr.getX(i * 3 + 1))
      v3 = new THREE.Vector3().fromBufferAttribute(posAttr, indexAttr.getX(i * 3 + 2))
    } else {
      v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i * 3)
      v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i * 3 + 1)
      v3 = new THREE.Vector3().fromBufferAttribute(posAttr, i * 3 + 2)
    }
    const edge1 = new THREE.Vector3().subVectors(v2, v1)
    const edge2 = new THREE.Vector3().subVectors(v3, v1)
    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize()
    normals.push(normal)
  }

  const uniqueFaces: { normal: THREE.Vector3; triangles: number[] }[] = []
  for (let i = 0; i < normals.length; i++) {
    const existing = uniqueFaces.find((f) => f.normal.dot(normals[i]) > 0.999)
    if (existing) {
      existing.triangles.push(i)
    } else {
      uniqueFaces.push({ normal: normals[i].clone(), triangles: [i] })
    }
  }

  return uniqueFaces
}

describe('Face Material Mapping', () => {
  describe('FACE_MATERIAL_MAPS completeness', () => {
    for (const shape of DICE_TYPES) {
      it(`${shape} mapping should be non-empty`, () => {
        const mapping = FACE_MATERIAL_MAPS[shape]
        expect(mapping.length).toBeGreaterThan(0)
      })
    }
  })

  describe('Triangle count verification', () => {
    const expectedTriangleCounts: Record<DiceShape, number> = {
      d4: 4,
      d6: 12,
      d8: 8,
      d10: 20,
      d12: 36,
      d20: 20,
    }

    for (const shape of DICE_TYPES) {
      it(`${shape} has expected triangle count`, () => {
        const geometry = GEOMETRY_CREATORS[shape](1)
        const posAttr = geometry.getAttribute('position')
        const indexAttr = geometry.getIndex()

        const triangleCount = indexAttr
          ? indexAttr.count / 3
          : posAttr.count / 3

        expect(triangleCount).toBe(expectedTriangleCounts[shape])
      })
    }
  })

  describe('Face normals match geometry', () => {
    // d4, d8, d20: 1 triangle per face — normals must match 1:1
    for (const shape of ['d4', 'd8', 'd20'] as DiceShape[]) {
      it(`${shape} face normals match geometry triangle normals`, () => {
        const faces = extractActualGeometryFaces(shape)
        const faceNormals = getFaceNormals(shape)

        expect(faces.length).toBe(faceNormals.length)

        // For each geometry face, there should be exactly one face normal
        // with dot product > 0.999
        for (const geoFace of faces) {
          const match = faceNormals.find(
            (fn) => fn.normal.dot(geoFace.normal) > 0.999
          )
          expect(match).toBeDefined()
        }
      })
    }

    it('d12 face normals match geometry (3 triangles per face)', () => {
      const faces = extractActualGeometryFaces('d12')
      const faceNormals = getFaceNormals('d12')

      expect(faces.length).toBe(12)
      expect(faceNormals.length).toBe(12)

      for (const geoFace of faces) {
        const match = faceNormals.find(
          (fn) => fn.normal.dot(geoFace.normal) > 0.999
        )
        expect(match).toBeDefined()
      }
    })

    it('d10 face normals are 10 unique unit vectors with y-components', () => {
      const faceNormals = getFaceNormals('d10')

      expect(faceNormals.length).toBe(10)

      for (const fn of faceNormals) {
        // Should be unit length
        expect(fn.normal.length()).toBeCloseTo(1.0, 4)
      }

      // Upper kites (0-4) should have positive y, lower kites (5-9) negative y
      // Values: kites 0-4 get even values (0,2,4,6,8), kites 5-9 get odd-mapped values
      // We verify by checking the normals have non-zero y
      const upperNormals = faceNormals.filter(fn => [0, 2, 4, 6, 8].includes(fn.value))
      const lowerNormals = faceNormals.filter(fn => [3, 1, 9, 7, 5].includes(fn.value))
      expect(upperNormals.length).toBe(5)
      expect(lowerNormals.length).toBe(5)

      for (const fn of upperNormals) {
        expect(fn.normal.y).toBeGreaterThan(0)
      }
      for (const fn of lowerNormals) {
        expect(fn.normal.y).toBeLessThan(0)
      }

      // All normals should be unique (no two should be nearly identical)
      for (let i = 0; i < faceNormals.length; i++) {
        for (let j = i + 1; j < faceNormals.length; j++) {
          expect(faceNormals[i].normal.dot(faceNormals[j].normal)).toBeLessThan(0.95)
        }
      }
    })
  })

  describe('Mapping matches geometry triangle normals', () => {
    // d4, d8, d20: simple 1:1 triangle-to-material mapping
    for (const shape of ['d4', 'd8', 'd20'] as DiceShape[]) {
      it(`${shape} material mapping is consistent with geometry`, () => {
        const geometry = GEOMETRY_CREATORS[shape](1)
        const faceNormals = getFaceNormals(shape)
        const computedMapping = generateMaterialMapping(geometry, faceNormals, shape)
        const declaredMapping = FACE_MATERIAL_MAPS[shape]

        const numFaces = faceNormals.length

        for (let faceValue = 1; faceValue <= numFaces; faceValue++) {
          const materialIndex = declaredMapping[faceValue]
          expect(materialIndex).toBeDefined()
          expect(materialIndex).not.toBe(-1)
          // 1:1 mapping: material index = triangle index
          expect(computedMapping[materialIndex]).toBe(faceValue)
        }
      })
    }

    it('d6 material mapping is consistent with geometry', () => {
      const geometry = createD6Geometry(1)
      const faceNormals = getFaceNormals('d6')
      const computedMapping = generateMaterialMapping(geometry, faceNormals, 'd6')
      const declaredMapping = FACE_MATERIAL_MAPS.d6

      // d6: BoxGeometry has 2 triangles per face
      for (let faceValue = 1; faceValue <= 6; faceValue++) {
        const materialIndex = declaredMapping[faceValue]
        // First triangle of the material group
        const firstTriangle = materialIndex * 2
        expect(computedMapping[firstTriangle]).toBe(faceValue)
      }
    })

    it('d12 material mapping is consistent with geometry', () => {
      const geometry = createD12Geometry(1)
      const faceNormals = getFaceNormals('d12')
      const computedMapping = generateMaterialMapping(geometry, faceNormals, 'd12')
      const declaredMapping = FACE_MATERIAL_MAPS.d12

      // d12: 3 triangles per pentagonal face
      for (let faceValue = 1; faceValue <= 12; faceValue++) {
        const materialIndex = declaredMapping[faceValue]
        expect(materialIndex).toBeDefined()
        expect(materialIndex).not.toBe(-1)
        // First triangle of the group
        const firstTriangle = materialIndex * 3
        expect(computedMapping[firstTriangle]).toBe(faceValue)
      }
    })

    it('d10 structural mapping: each face value maps to a valid kite index (0-9)', () => {
      // D10 has 10 kite faces, geometry groups pair 2 triangles per kite.
      // Material index = kite index (0-9).
      const declaredMapping = FACE_MATERIAL_MAPS.d10

      for (let faceValue = 0; faceValue <= 9; faceValue++) {
        const kiteIndex = declaredMapping[faceValue]
        expect(kiteIndex).toBeGreaterThanOrEqual(0)
        expect(kiteIndex).toBeLessThan(10)
      }

      // All 10 kite indices should be used exactly once
      const usedIndices = new Set(declaredMapping)
      expect(usedIndices.size).toBe(10)
    })
  })

  describe('Face normal rules (opposite faces sum)', () => {
    for (const shape of ['d6', 'd8', 'd10', 'd12', 'd20'] as DiceShape[]) {
      it(`${shape} opposite faces sum correctly`, () => {
        const result = validateFaceNormalRules(shape)
        expect(result.valid).toBe(true)
        if (!result.valid) {
          console.error(`${shape} validation errors:`, result.errors)
        }
      })
    }

    it('d10 opposite-pair normals point in opposing directions (dot < -0.5)', () => {
      const faceNormals = getFaceNormals('d10')
      // Opposite pairs: values that sum to 9
      const pairs = [[0, 9], [1, 8], [2, 7], [3, 6], [4, 5]]

      for (const [a, b] of pairs) {
        const normalA = faceNormals.find(fn => fn.value === a)!
        const normalB = faceNormals.find(fn => fn.value === b)!
        const dot = normalA.normal.dot(normalB.normal)
        expect(dot).toBeLessThan(-0.5)
      }
    })
  })

  describe('getDiceFaceValue consistency for all dice types', () => {
    for (const shape of DICE_TYPES) {
      const faceNormals = getFaceNormals(shape)
      const target = shape === 'd4'
        ? new THREE.Vector3(0, -1, 0)
        : new THREE.Vector3(0, 1, 0)

      for (const face of faceNormals) {
        it(`${shape} face ${face.value}: detected correctly when aligned with target`, () => {
          const quaternion = new THREE.Quaternion()
          quaternion.setFromUnitVectors(face.normal.clone().normalize(), target)

          const detected = getDiceFaceValue(quaternion, shape)
          expect(detected).toBe(face.value)
        })
      }
    }
  })

  describe('Each face value maps to a unique material index', () => {
    for (const shape of DICE_TYPES) {
      it(`${shape} has no duplicate material indices`, () => {
        const mapping = FACE_MATERIAL_MAPS[shape]
        const faceNormals = getFaceNormals(shape)

        const materialIndices: number[] = []
        const startValue = shape === 'd10' ? 0 : 1
        const endValue = shape === 'd10' ? 9 : faceNormals.length

        for (let v = startValue; v <= endValue; v++) {
          const idx = mapping[v]
          expect(idx).not.toBe(-1)
          expect(materialIndices).not.toContain(idx)
          materialIndices.push(idx)
        }
      })
    }
  })
})
