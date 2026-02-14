import { useSearchParams } from 'react-router-dom'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import {
  DiceShape,
  getDiceFaceValue,
  D4_FACE_NORMALS,
  D6_FACE_NORMALS,
  D8_FACE_NORMALS,
  D10_FACE_NORMALS,
  D12_FACE_NORMALS,
  D20_FACE_NORMALS,
  createD4Geometry,
  createD6Geometry,
  createD8Geometry,
  createD10Geometry,
  createD12Geometry,
  createD20Geometry,
} from '../../lib/geometries'
import { useDiceMaterials } from '../../hooks/useDiceMaterials'
import { renderD4Classic } from '../../lib/faceRenderers/d4Renderer'
import { renderStyledNumber } from '../../lib/textureRendering'
import { prepareGeometryForTexturing } from '../../lib/geometryTexturing'

const FACE_NORMALS_MAP: Record<DiceShape, import('../../lib/geometries').DiceFace[]> = {
  d4: D4_FACE_NORMALS,
  d6: D6_FACE_NORMALS,
  d8: D8_FACE_NORMALS,
  d10: D10_FACE_NORMALS,
  d12: D12_FACE_NORMALS,
  d20: D20_FACE_NORMALS,
}

const GEOMETRY_CREATORS: Record<DiceShape, (size?: number) => THREE.BufferGeometry> = {
  d4: createD4Geometry,
  d6: createD6Geometry,
  d8: createD8Geometry,
  d10: createD10Geometry,
  d12: createD12Geometry,
  d20: createD20Geometry,
}

/**
 * Compute quaternion that rotates a face normal to align with the target direction.
 * For d4: target is DOWN (0,-1,0) — the detected face touches ground.
 * For others: target is UP (0,1,0) — the detected face points to ceiling.
 */
function computeAlignmentQuaternion(faceNormal: THREE.Vector3, shape: DiceShape): THREE.Quaternion {
  const target = shape === 'd4'
    ? new THREE.Vector3(0, -1, 0)
    : new THREE.Vector3(0, 1, 0)

  const quaternion = new THREE.Quaternion()
  quaternion.setFromUnitVectors(faceNormal.clone().normalize(), target)
  return quaternion
}

function DieAtOrientation({
  shape,
  quaternion,
  materials,
}: {
  shape: DiceShape
  quaternion: THREE.Quaternion
  materials: THREE.Material | THREE.Material[]
}) {
  const geometry = useMemo(() => {
    const baseGeometry = GEOMETRY_CREATORS[shape](1)
    return prepareGeometryForTexturing(baseGeometry, shape)
  }, [shape])
  const euler = useMemo(() => new THREE.Euler().setFromQuaternion(quaternion), [quaternion])

  return (
    <mesh geometry={geometry} material={materials} rotation={euler} />
  )
}

export default function DiceFaceTestHarness() {
  const [searchParams] = useSearchParams()
  const shape = (searchParams.get('type') || 'd6') as DiceShape
  const faceIndex = parseInt(searchParams.get('face') || '0')

  const faceNormals = FACE_NORMALS_MAP[shape]
  if (!faceNormals || Number.isNaN(faceIndex) || faceIndex >= faceNormals.length || faceIndex < 0) {
    return <div data-testid="dice-test-harness">Invalid params</div>
  }

  const face = faceNormals[faceIndex]
  const quaternion = computeAlignmentQuaternion(face.normal, shape)
  const reportedValue = getDiceFaceValue(quaternion, shape)

  // Use textured materials for visual validation
  const materials = useDiceMaterials({
    shape,
    color: '#ff6b35',
    faceRenderer: shape === 'd4' ? renderD4Classic : renderStyledNumber,
  })

  return (
    <div data-testid="dice-test-harness" style={{ width: '100vw', height: '100vh', background: '#111' }}>
      <div style={{ position: 'absolute', top: 10, left: 10, color: 'white', zIndex: 10, fontFamily: 'monospace' }}>
        <div data-testid="dice-type">{shape}</div>
        <div data-testid="face-index">{faceIndex}</div>
        <div data-testid="expected-value">{face.value}</div>
        <div data-testid="reported-value">{reportedValue}</div>
      </div>
      <Canvas camera={{ position: [0.8, 3, 0.8], fov: 50, near: 0.1, far: 100 }}>
        <ambientLight intensity={1.2} />
        <directionalLight position={[0, 5, 0]} intensity={1.5} />
        <directionalLight position={[2, 3, 2]} intensity={0.5} />
        <DieAtOrientation shape={shape} quaternion={quaternion} materials={materials} />
      </Canvas>
    </div>
  )
}
