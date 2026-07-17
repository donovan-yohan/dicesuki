import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Canvas } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { getDiceFaceValue, type DiceFace } from '../../lib/geometries'
import type { DiceMetadata } from '../../types/customDice'

function toDiceFaces(metadata: DiceMetadata): DiceFace[] {
  return metadata.faceNormals.map((face) => ({
    value: face.value,
    normal: new THREE.Vector3(face.normal[0], face.normal[1], face.normal[2]),
  }))
}

function rotationFromFaceToCamera(face: DiceFace): THREE.Euler {
  const normal = face.normal.clone().normalize()
  const { tangent, bitangent } = createFaceBasis(normal)
  const sourceBasis = new THREE.Matrix4().makeBasis(tangent, bitangent, normal)
  const targetBasis = new THREE.Matrix4().identity()
  const rotationMatrix = targetBasis.multiply(sourceBasis.invert())
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotationMatrix)
  return new THREE.Euler().setFromQuaternion(quaternion)
}

function createFaceBasis(normal: THREE.Vector3): {
  tangent: THREE.Vector3
  bitangent: THREE.Vector3
} {
  const reference = Math.abs(normal.y) > 0.92
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3().crossVectors(reference, normal).normalize()
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize()
  return { tangent, bitangent }
}

function ProductionDiceModel({
  modelUrl,
  metadata,
  face,
}: {
  modelUrl: string
  metadata: DiceMetadata
  face: DiceFace
}) {
  const gltf = useGLTF(modelUrl)
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  const rotation = useMemo(() => rotationFromFaceToCamera(face), [face])

  return <primitive object={scene} rotation={rotation} scale={metadata.scale} />
}

export default function ProductionDicePreviewHarness() {
  const [searchParams] = useSearchParams()
  const setId = searchParams.get('set') || 'fantasy-set'
  const diceId = searchParams.get('dice') || 'emerald-d20'
  const requestedFaceValue = Number(searchParams.get('faceValue') || '0')
  const [metadata, setMetadata] = useState<DiceMetadata | null>(null)
  const [error, setError] = useState<string | null>(null)

  const metadataUrl = `/dice/${setId}/${diceId}/metadata.json`
  const modelUrl = `/dice/${setId}/${diceId}/model.glb`

  useEffect(() => {
    let mounted = true
    setMetadata(null)
    setError(null)

    fetch(metadataUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load ${metadataUrl}`)
        }
        return response.json()
      })
      .then((loadedMetadata: DiceMetadata) => {
        if (mounted) setMetadata(loadedMetadata)
      })
      .catch((loadError) => {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load metadata')
        }
      })

    return () => {
      mounted = false
    }
  }, [metadataUrl])

  const faceNormals = useMemo(() => metadata ? toDiceFaces(metadata) : [], [metadata])
  const face = useMemo(() => {
    if (faceNormals.length === 0) return null
    return faceNormals.find((candidate) => candidate.value === requestedFaceValue) ?? faceNormals[faceNormals.length - 1]
  }, [faceNormals, requestedFaceValue])

  const reportedValue = useMemo(() => {
    if (!metadata || !face) return null
    const readingTarget = metadata.diceType === 'd4'
      ? new THREE.Vector3(0, -1, 0)
      : new THREE.Vector3(0, 1, 0)
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      face.normal.clone().normalize(),
      readingTarget,
    )
    return getDiceFaceValue(quaternion, metadata.diceType, faceNormals)
  }, [face, faceNormals, metadata])

  if (error) {
    return <div data-testid="production-dice-preview">Error: {error}</div>
  }

  if (!metadata || !face || reportedValue === null) {
    return (
      <div
        data-testid="production-dice-preview"
        style={{ width: '100vw', height: '100vh', display: 'grid', placeItems: 'center', background: '#111827', color: '#f9fafb' }}
      >
        Loading production die...
      </div>
    )
  }

  return (
    <div data-testid="production-dice-preview" style={{ width: '100vw', height: '100vh', background: '#0f172a' }}>
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10, color: '#f8fafc', fontFamily: 'monospace', fontSize: 14, lineHeight: 1.5 }}>
        <div data-testid="production-dice-id">{setId}/{diceId}</div>
        <div data-testid="production-dice-type">{metadata.diceType}</div>
        <div data-testid="expected-value">{face.value}</div>
        <div data-testid="reported-value">{reportedValue}</div>
      </div>
      <Canvas camera={{ position: [0, 0, 3], fov: 36, near: 0.1, far: 100 }}>
        <color attach="background" args={['#0f172a']} />
        <ambientLight intensity={1.15} />
        <directionalLight position={[1.8, 2.2, 3]} intensity={1.6} />
        <directionalLight position={[-2, -1, 2]} intensity={0.45} />
        <Suspense fallback={null}>
          <ProductionDiceModel modelUrl={modelUrl} metadata={metadata} face={face} />
        </Suspense>
      </Canvas>
    </div>
  )
}
