import { useRef, useMemo, useCallback, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { type DiceShape, createDiceGeometry } from '../../lib/geometries'
import { prepareGeometryForTexturing } from '../../lib/geometryTexturing'
import { getFaceRendererForShape } from '../../lib/faceRenderers'
import { useDiceMaterials } from '../../hooks/useDiceMaterials'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { type RenderDeviceTier, resolveDiceRenderLod } from '../../lib/renderLod'
import type { DicePresentationMetadata } from '../../lib/multiplayerMessages'

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
  const meshRef = useRef<THREE.Mesh>(null)

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

  const materials = useDiceMaterials({
    shape: diceType,
    color: presentation?.baseColor ?? color,
    roughness: 0.7,
    metalness: 0.1,
    faceRenderer: getFaceRendererForShape(diceType),
    lodPolicy,
  })

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
    if (!groupRef.current || !meshRef.current) return

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
    meshRef.current.quaternion.copy(interpQuat)
  })

  if (lodPolicy.materialMode === 'hidden') {
    return null
  }

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={materials}
        castShadow={lodPolicy.castShadow}
        receiveShadow={lodPolicy.receiveShadow}
        userData={{ renderLod: lodPolicy, dicePresentation: presentation }}
        onPointerDown={isOwnedByLocalPlayer ? handlePointerDown : undefined}
        onPointerEnter={isOwnedByLocalPlayer ? handlePointerEnter : undefined}
        onPointerLeave={handlePointerLeave}
      />
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
