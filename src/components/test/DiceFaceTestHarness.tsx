import { useSearchParams } from 'react-router-dom'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  type DiceShape,
  createDiceGeometry,
  D4_FACE_NORMALS,
  D6_FACE_NORMALS,
  D8_FACE_NORMALS,
  D10_FACE_NORMALS,
  D10TENS_FACE_NORMALS,
  D12_FACE_NORMALS,
  D20_FACE_NORMALS,
} from '../../lib/geometries'
import { useDiceMaterials } from '../../hooks/useDiceMaterials'
import { getFaceRendererForShape, type DiceFaceStyle } from '../../lib/faceRenderers'
import { prepareGeometryForTexturing } from '../../lib/geometryTexturing'
import { BASIC_DIE_BASE_COLOR } from '../../lib/basicDice'

/**
 * Reports the first frame the renderer actually draws.
 *
 * The harness's only observable "I have painted something" edge. It deliberately
 * has no `Scene`, no `StartupGate` and no splash — it is a bare `<Canvas>` — so
 * it cannot publish `data-table-revealed` the way `SoloRoom` does, and importing
 * the scene's own signal here would couple a test surface to the production
 * render path for no gain. A local `useFrame` one-shot is the honest equivalent.
 *
 * A first frame is a COMPLETE signal here, not an approximation: `useDiceMaterials`
 * builds its face textures synchronously inside `useMemo`, so by the time any
 * frame is drawn the numerals are already painted into it. Nothing else loads.
 */
function FirstFrameSignal({ onDrawn }: { onDrawn: () => void }) {
  const didSignalRef = useRef(false)

  useFrame(() => {
    if (didSignalRef.current) return
    didSignalRef.current = true
    onDrawn()
  })

  return null
}

const FACE_NORMALS_MAP: Record<DiceShape, import('../../lib/geometries').DiceFace[]> = {
  d4: D4_FACE_NORMALS,
  d6: D6_FACE_NORMALS,
  d8: D8_FACE_NORMALS,
  d10: D10_FACE_NORMALS,
  d10tens: D10TENS_FACE_NORMALS,
  d12: D12_FACE_NORMALS,
  d20: D20_FACE_NORMALS,
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
    return prepareGeometryForTexturing(createDiceGeometry(shape), shape)
  }, [shape])
  const euler = useMemo(() => new THREE.Euler().setFromQuaternion(quaternion), [quaternion])

  return (
    <mesh geometry={geometry} material={materials} rotation={euler} />
  )
}

/**
 * `/test/dice-faces` — a RENDERING harness, not a detection harness.
 *
 * It parks a die at a known rotation (face `?face=` turned toward the camera
 * axis) and publishes the numeral that face is supposed to carry, so an e2e
 * spec can sample the real pixels. It deliberately does not ask the client
 * "which face is up?" — that is `dicesuki-core`'s answer (Shared-ADR-005), and
 * asking it here would only re-confirm the face-normal table against itself.
 *
 * Live consumer: `e2e/basic-dice.spec.ts` (`npm run test:e2e:basic-dice`).
 */
export default function DiceFaceTestHarness() {
  const [searchParams] = useSearchParams()
  const shape = (searchParams.get('type') || 'd6') as DiceShape
  const faceIndex = parseInt(searchParams.get('face') || '0')
  // `?style=basic` renders the infinite fallback die (`lib/basicDice.ts`) with
  // the exact colours it spawns with, so its white body and black numerals can
  // be verified as real rendered pixels instead of asserted metadata.
  const faceStyle: DiceFaceStyle = searchParams.get('style') === 'basic' ? 'basic' : 'default'

  const [frameDrawn, setFrameDrawn] = useState(false)

  const faceNormals = FACE_NORMALS_MAP[shape]
  const isValidFaceIndex = faceNormals && !Number.isNaN(faceIndex) && faceIndex < faceNormals.length && faceIndex >= 0

  const face = isValidFaceIndex ? faceNormals[faceIndex] : null
  const quaternion = face ? computeAlignmentQuaternion(face.normal, shape) : null

  // Use textured materials for visual validation
  const materials = useDiceMaterials({
    shape,
    color: faceStyle === 'basic' ? BASIC_DIE_BASE_COLOR : '#ff6b35',
    faceRenderer: getFaceRendererForShape(shape, faceStyle),
  })

  if (!face || !quaternion) {
    return <div data-testid="dice-test-harness">Invalid params</div>
  }

  return (
    <div
      data-testid="dice-test-harness"
      data-frame-drawn={frameDrawn ? 'true' : 'false'}
      style={{ width: '100vw', height: '100vh', background: '#111' }}
    >
      <div style={{ position: 'absolute', top: 10, left: 10, color: 'white', zIndex: 10, fontFamily: 'monospace' }}>
        <div data-testid="dice-type">{shape}</div>
        <div data-testid="face-style">{faceStyle}</div>
        <div data-testid="face-index">{faceIndex}</div>
        <div data-testid="expected-value">{face.value}</div>
      </div>
      <Canvas camera={{ position: [0.8, 3, 0.8], fov: 50, near: 0.1, far: 100 }}>
        <FirstFrameSignal onDrawn={() => setFrameDrawn(true)} />
        <ambientLight intensity={1.2} />
        <directionalLight position={[0, 5, 0]} intensity={1.5} />
        <directionalLight position={[2, 3, 2]} intensity={0.5} />
        <DieAtOrientation shape={shape} quaternion={quaternion} materials={materials} />
      </Canvas>
    </div>
  )
}
