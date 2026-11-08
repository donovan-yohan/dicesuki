import { Suspense, useEffect, useRef, useMemo, useCallback, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { type DiceShape, createDiceGeometry } from '../../lib/geometries'
import { prepareGeometryForTexturing } from '../../lib/geometryTexturing'
import { resolveDiceMaterial } from '../../lib/diceMaterial'
import { isBasicDiePresentation } from '../../lib/basicDice'
import { useDiceMaterials } from '../../hooks/useDiceMaterials'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { type RenderDeviceTier, resolveDiceRenderLod } from '../../lib/renderLod'
import type { DicePresentationMetadata } from '../../lib/multiplayerMessages'
import { getBundledGltfDiceAsset } from '../../lib/collectibleCatalog'
import { useGltfDiceLoader } from '../../hooks/useGltfDiceLoader'
import type { GltfDiceAsset } from '../../types/gltfDice'
import { SceneAssetErrorBoundary } from '../SceneAssetErrorBoundary'
import { useGLTF } from '@react-three/drei'
import { useEnvironmentTheme } from '../../hooks/useEnvironmentTheme'
import { ManagedSculptedDieVisual } from '../dice/ManagedSculptedDieVisual'
import { managedSculptedSetId } from '../../lib/managedSculptedDice'
import { createCelPreviewScene } from '../../lib/woodlandCelMaterial'
import {
  shouldPreviewSculptedDie,
  shouldPreviewWoodDie,
  sculptedDiePreviewUrl,
  woodDiePreviewUrl,
} from '../../lib/woodlandExperiment'

/**
 * Owner-attribution ring dimensions. A flat torus encircling the die in its
 * owner's player color so every die on the field visibly indicates who it
 * belongs to, independent of the die's own material/baseColor.
 */
export const OWNER_RING_RADIUS = 1.15
export const OWNER_RING_TUBE = 0.07

interface MultiplayerDieProps {
  dieId: string
  diceType: DiceShape
  /** Owner's player color — drives the attribution ring (and material fallback). */
  color: string
  presentation?: DicePresentationMetadata
  tRef: MutableRefObject<number>
  /**
   * Whether the local player owns this die. Drives interactivity and the
   * owner-attribution ring: the ring is drawn only when this is `false` (under
   * OTHER players' dice), since the local player already knows their own — so a
   * solo room, where every die is local-owned, shows no rings.
   */
  isOwnedByLocalPlayer: boolean
  renderDeviceTier?: RenderDeviceTier
  onDragStart?: (event: ThreeEvent<PointerEvent>, dieId: string) => void
}

export function MultiplayerDie({
  dieId,
  diceType,
  color,
  presentation,
  tRef,
  isOwnedByLocalPlayer,
  renderDeviceTier = 'high',
  onDragStart,
}: MultiplayerDieProps) {
  const groupRef = useRef<THREE.Group>(null)
  const visualRef = useRef<THREE.Group>(null)
  const woodlandDice = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('woodlandDice') : null
  const previewInput = {
    development: import.meta.env.DEV,
    workerRoom: useMultiplayerStore.getState().lastJoin?.transport === 'worker',
    shape: diceType,
    owned: Boolean(presentation?.inventoryDieId || presentation?.customAssetId),
  }
  const previewSculpted = shouldPreviewSculptedDie({ ...previewInput, requested: woodlandDice === 'sculpted' })
  const previewUrl = previewSculpted
    ? sculptedDiePreviewUrl(diceType)
    : shouldPreviewWoodDie({ ...previewInput, requested: woodlandDice === '1' })
      ? woodDiePreviewUrl(renderDeviceTier)
      : null

  const geometry = useMemo(
    () => prepareGeometryForTexturing(createDiceGeometry(diceType), diceType),
    [diceType],
  )

  const lodPolicy = useMemo(
    () => resolveDiceRenderLod({
      context: 'tray',
      deviceTier: renderDeviceTier,
      isVisible: true,
      isFocused: isOwnedByLocalPlayer,
      isInteracting: true,
    }),
    [renderDeviceTier, isOwnedByLocalPlayer],
  )

  // Material look comes from the single resolver (shared with the inventory
  // previews, so they can't drift), keyed on the server physics material
  // (dice.rs::material_physics): metal → glossy faces + matte painted numbers,
  // rubber → pastel tie-dye, everything else the default. A basic die
  // (`lib/basicDice.ts`) overrides all of that with plain black numerals.
  //
  // `presentation?.baseColor ?? color` falls back to the OWNER'S PLAYER COLOUR.
  // Every die this client spawns now carries a presentation block — basics
  // included — so that fallback only ever applies to a presentation-less die
  // originated by some other client.
  const isBasic = isBasicDiePresentation(presentation)
  const resolution = resolveDiceMaterial(
    diceType,
    presentation?.material,
    isBasic ? 'basic' : 'default',
  )
  const materials = useDiceMaterials({
    shape: diceType,
    color: presentation?.baseColor ?? color,
    roughness: resolution.roughness,
    metalness: resolution.metalness,
    faceRenderer: resolution.faceRenderer,
    materialMaskRenderer: resolution.materialMaskRenderer,
    lodPolicy,
  })
  const bundledAsset = useMemo(
    () => {
      if (!presentation?.customAssetId || presentation.unsupportedReason) return null
      const asset = getBundledGltfDiceAsset(
        presentation.customAssetId,
        presentation.customAssetVersionId,
        diceType,
      )
      return asset
    },
    [
      diceType,
      presentation?.customAssetId,
      presentation?.customAssetVersionId,
      presentation?.unsupportedReason,
    ],
  )

  // Reusable objects — avoid allocation in render loop
  const prevQuat = useMemo(() => new THREE.Quaternion(), [])
  const targetQuat = useMemo(() => new THREE.Quaternion(), [])
  const interpQuat = useMemo(() => new THREE.Quaternion(), [])
  const interpPos = useMemo(() => new THREE.Vector3(), [])
  const targetPos = useMemo(() => new THREE.Vector3(), [])

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    onDragStart?.(e, dieId)
  }, [onDragStart, dieId])

  const handlePointerEnter = useCallback(() => {
    document.body.style.cursor = 'grab'
  }, [])

  const handlePointerLeave = useCallback(() => {
    document.body.style.cursor = ''
  }, [])

  useFrame(() => {
    if (!groupRef.current || !visualRef.current) return

    // Read all state directly from store every frame to avoid stale props.
    // Props only update on re-render (~20Hz snapshots); useFrame runs at ~60fps.
    const currentDie = useMultiplayerStore.getState().dice.get(dieId)
    if (!currentDie) return

    // Interpolate position between prev and target snapshots using live t value.
    // Position drives the group so the owner ring travels with the die; the
    // tumbling rotation applies to the die mesh only, keeping the ring flat.
    const t = tRef.current
    interpPos.set(currentDie.prevPosition[0], currentDie.prevPosition[1], currentDie.prevPosition[2])
    targetPos.set(currentDie.targetPosition[0], currentDie.targetPosition[1], currentDie.targetPosition[2])
    interpPos.lerp(targetPos, t)
    groupRef.current.position.copy(interpPos)

    // Interpolate rotation (slerp)
    prevQuat.set(currentDie.prevRotation[0], currentDie.prevRotation[1], currentDie.prevRotation[2], currentDie.prevRotation[3])
    targetQuat.set(currentDie.targetRotation[0], currentDie.targetRotation[1], currentDie.targetRotation[2], currentDie.targetRotation[3])
    interpQuat.slerpQuaternions(prevQuat, targetQuat, t)
    visualRef.current.quaternion.copy(interpQuat)
  })

  if (lodPolicy.materialMode === 'hidden') {
    return null
  }

  return (
    <group ref={groupRef}>
      <group
        ref={visualRef}
        userData={{ renderLod: lodPolicy, dicePresentation: presentation }}
        onPointerDown={isOwnedByLocalPlayer ? handlePointerDown : undefined}
        onPointerEnter={isOwnedByLocalPlayer ? handlePointerEnter : undefined}
        onPointerLeave={handlePointerLeave}
      >
        {previewUrl ? (
          <SceneAssetErrorBoundary resetKey={previewUrl} fallback={(
            <ProceduralDieVisual geometry={geometry} materials={materials} castShadow={lodPolicy.castShadow} receiveShadow={lodPolicy.receiveShadow} />
          )}>
            <Suspense fallback={(
              <ProceduralDieVisual geometry={geometry} materials={materials} castShadow={lodPolicy.castShadow} receiveShadow={lodPolicy.receiveShadow} />
            )}>
              <WoodlandDieProof
                url={previewUrl}
                sculptedShape={previewSculpted ? diceType : undefined}
                castShadow={lodPolicy.castShadow}
                receiveShadow={lodPolicy.receiveShadow}
              />
            </Suspense>
          </SceneAssetErrorBoundary>
        ) : bundledAsset ? (
          <SceneAssetErrorBoundary
            resetKey={bundledAsset.modelUrl}
            fallback={(
              <ProceduralDieVisual
                geometry={geometry}
                materials={materials}
                castShadow={lodPolicy.castShadow}
                receiveShadow={lodPolicy.receiveShadow}
              />
            )}
          >
            <Suspense fallback={(
              <ProceduralDieVisual
                geometry={geometry}
                materials={materials}
                castShadow={lodPolicy.castShadow}
                receiveShadow={lodPolicy.receiveShadow}
              />
            )}>
              <BundledDieVisual
                asset={bundledAsset}
                castShadow={lodPolicy.castShadow}
                receiveShadow={lodPolicy.receiveShadow}
              />
            </Suspense>
          </SceneAssetErrorBoundary>
        ) : (
          <ProceduralDieVisual
            geometry={geometry}
            materials={materials}
            castShadow={lodPolicy.castShadow}
            receiveShadow={lodPolicy.receiveShadow}
          />
        )}
      </group>
      {/* Owner attribution ring — flat torus in the owner's player color.
          Only drawn under other players' dice; the local player knows their own. */}
      {!isOwnedByLocalPlayer && (
        <mesh rotation={[Math.PI / 2, 0, 0]} renderOrder={1}>
          <torusGeometry args={[OWNER_RING_RADIUS, OWNER_RING_TUBE, 8, 32]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.85}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  )
}

/** Dev-only visual proof. Sculpted exports already include canonical Y-up/world scale. */
function WoodlandDieProof({ url, sculptedShape, castShadow, receiveShadow }: {
  url: string
  sculptedShape?: DiceShape
  castShadow: boolean
  receiveShadow: boolean
}) {
  const { scene } = useGLTF(url, false)
  const theme = useEnvironmentTheme()
  const cel = Boolean(sculptedShape && theme.environment.scene?.shading === 'cel')
  const resources = useMemo(() => {
    const preview = cel ? createCelPreviewScene(scene) : { scene: scene.clone(true), dispose() {} }
    const result = preview.scene
    result.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = castShadow
        child.receiveShadow = receiveShadow
      }
    })
    if (sculptedShape) result.userData.woodlandSculptedPreview = { shape: sculptedShape, url }
    return { ...preview, users: 0 }
  }, [scene, cel, castShadow, receiveShadow, sculptedShape, url])
  useEffect(() => {
    resources.users++
    return () => {
      resources.users--
      // StrictMode replays setup before this microtask can retire materials.
      queueMicrotask(() => { if (resources.users === 0) resources.dispose() })
    }
  }, [resources])
  return <primitive object={resources.scene} scale={sculptedShape ? 1 : 1.1} dispose={null} />
}

interface ProceduralDieVisualProps {
  geometry: THREE.BufferGeometry
  materials: THREE.Material | THREE.Material[]
  castShadow: boolean
  receiveShadow: boolean
}

function ProceduralDieVisual({
  geometry,
  materials,
  castShadow,
  receiveShadow,
}: ProceduralDieVisualProps) {
  return (
    <mesh
      geometry={geometry}
      material={materials}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  )
}

function BundledDieVisual({
  asset,
  castShadow,
  receiveShadow,
}: {
  asset: GltfDiceAsset
  castShadow: boolean
  receiveShadow: boolean
}) {
  const { scene, metadata, animations } = useGltfDiceLoader(asset, {
    useDraco: false,
    castShadow,
    receiveShadow,
  })
  const theme = useEnvironmentTheme()
  if (!scene) return null
  return managedSculptedSetId(asset) ? (
    <group scale={metadata?.scale ?? 1}>
      <ManagedSculptedDieVisual scene={scene} asset={asset} animations={animations} cel={theme.environment.scene?.shading === 'cel'} response={theme.environment.scene?.kind === 'cyberpunk-alley' || theme.environment.scene?.kind === 'monster-dungeon' ? 'night' : 'original'} />
    </group>
  ) : <primitive object={scene} scale={metadata?.scale ?? 1} dispose={null} />
}
