import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Canvas } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { DiceFace } from '../../lib/geometries'
import {
  validateProductionDiceModelFace,
  type CanonicalDiceUvManifest,
  type ProductionDiceModelFaceValidation,
} from '../../lib/productionDiceModelValidation'
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
  faceNormals,
  uvManifest,
  onValidation,
}: {
  modelUrl: string
  metadata: DiceMetadata
  face: DiceFace
  faceNormals: DiceFace[]
  uvManifest: CanonicalDiceUvManifest
  onValidation: (validation: ModelValidationReport) => void
}) {
  const gltf = useGLTF(modelUrl)
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  const validation = useMemo<ModelValidationReport>(() => {
    try {
      return {
        result: validateProductionDiceModelFace(
          scene,
          metadata.diceType,
          face,
          faceNormals,
          uvManifest,
        ),
      }
    } catch (validationError) {
      return {
        error: validationError instanceof Error
          ? validationError.message
          : 'Failed to validate GLB model geometry',
      }
    }
  }, [face, faceNormals, metadata.diceType, scene, uvManifest])
  const rotation = useMemo(
    () => validation.result
      ? rotationFromFaceToCamera({ ...face, normal: validation.result.modelNormal })
      : new THREE.Euler(),
    [face, validation],
  )

  useEffect(() => {
    onValidation(validation)
  }, [onValidation, validation])

  if (!validation.result) return null

  return <primitive object={scene} rotation={rotation} scale={metadata.scale} />
}

interface ModelValidationReport {
  result?: ProductionDiceModelFaceValidation
  error?: string
}

export default function ProductionDicePreviewHarness() {
  const [searchParams] = useSearchParams()
  const setId = searchParams.get('set') || 'fantasy-set'
  const diceId = searchParams.get('dice') || 'aurelian-imagegen-d20'
  const faceValueParam = searchParams.get('faceValue')
  const requestedFaceValue = faceValueParam === null ? Number.NaN : Number(faceValueParam)
  const [metadata, setMetadata] = useState<DiceMetadata | null>(null)
  const [uvManifest, setUvManifest] = useState<CanonicalDiceUvManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modelValidation, setModelValidation] = useState<ModelValidationReport | null>(null)

  const metadataUrl = `/dice/${setId}/${diceId}/metadata.json`
  const modelUrl = `/dice/${setId}/${diceId}/model.glb`

  useEffect(() => {
    let mounted = true
    setMetadata(null)
    setUvManifest(null)
    setError(null)
    setModelValidation(null)

    fetchJson<DiceMetadata>(metadataUrl)
      .then(async (loadedMetadata) => {
        if (!loadedMetadata.uvManifestUrl) {
          throw new Error(`${setId}/${diceId} does not declare a canonical uvManifestUrl`)
        }
        const loadedManifest = await fetchJson<CanonicalDiceUvManifest>(loadedMetadata.uvManifestUrl)
        if (mounted) {
          setMetadata(loadedMetadata)
          setUvManifest(loadedManifest)
        }
      })
      .catch((loadError) => {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load metadata')
        }
      })

    return () => {
      mounted = false
    }
  }, [diceId, metadataUrl, setId])

  useEffect(() => {
    setModelValidation(null)
  }, [requestedFaceValue])

  const faceNormals = useMemo(() => metadata ? toDiceFaces(metadata) : [], [metadata])
  const face = useMemo(
    () => faceNormals.find((candidate) => candidate.value === requestedFaceValue) ?? null,
    [faceNormals, requestedFaceValue],
  )
  const handleModelValidation = useCallback((validation: ModelValidationReport) => {
    setModelValidation(validation)
  }, [])
  const requestedFaceError = !Number.isInteger(requestedFaceValue)
    ? 'faceValue must be an explicit integer'
    : metadata && !face
      ? `Requested face ${requestedFaceValue} is missing from ${setId}/${diceId} metadata`
      : null
  const proofError = error ?? requestedFaceError ?? modelValidation?.error ?? null

  if (proofError) {
    return (
      <div data-testid="production-dice-preview" style={{ padding: 24, background: '#111827', color: '#f9fafb' }}>
        Error: <span data-testid="production-dice-preview-error">{proofError}</span>
      </div>
    )
  }

  if (!metadata || !face || !uvManifest) {
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
        <div data-testid="requested-value">{requestedFaceValue}</div>
        <div data-testid="model-face-value">{modelValidation?.result?.matchedValue ?? 'validating'}</div>
        <div data-testid="model-face-alignment">{modelValidation?.result?.alignment.toFixed(4) ?? 'validating'}</div>
        <div data-testid="model-face-uv-triangles">{modelValidation?.result?.uvTriangleCount ?? 'validating'}</div>
        <div data-testid="canonical-material-index">{modelValidation?.result?.materialIndex ?? 'validating'}</div>
        <div data-testid="canonical-uv-status">{modelValidation?.result ? 'matched' : 'validating'}</div>
        <div data-testid="validation-status">{modelValidation?.result ? 'validated' : 'validating'}</div>
      </div>
      <Canvas camera={{ position: [0, 0, 3], fov: 36, near: 0.1, far: 100 }}>
        <color attach="background" args={['#0f172a']} />
        <ambientLight intensity={1.15} />
        <directionalLight position={[1.8, 2.2, 3]} intensity={1.6} />
        <directionalLight position={[-2, -1, 2]} intensity={0.45} />
        <Suspense fallback={null}>
          <ProductionDiceModel
            modelUrl={modelUrl}
            metadata={metadata}
            face={face}
            faceNormals={faceNormals}
            uvManifest={uvManifest}
            onValidation={handleModelValidation}
          />
        </Suspense>
      </Canvas>
    </div>
  )
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load ${url}`)
  return response.json() as Promise<T>
}
