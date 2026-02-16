import { useRef, useMemo, useCallback, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { DiceShape } from '../../lib/geometries'
import { createDiceGeometry } from '../../lib/geometries'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'

interface MultiplayerDieProps {
  dieId: string
  diceType: DiceShape
  color: string
  tRef: MutableRefObject<number>
  isOwnedByLocalPlayer: boolean
  onDragStart?: (event: ThreeEvent<PointerEvent>, dieId: string) => void
}

export function MultiplayerDie({
  dieId,
  diceType,
  color,
  tRef,
  isOwnedByLocalPlayer,
  onDragStart,
}: MultiplayerDieProps) {
  const meshRef = useRef<THREE.Mesh>(null)

  // Memoize geometry creation
  const geometry = useMemo(() => createDiceGeometry(diceType), [diceType])

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
    if (!meshRef.current) return

    // Read all state directly from store every frame to avoid stale props.
    // Props only update on re-render (~20Hz snapshots); useFrame runs at ~60fps.
    const currentDie = useMultiplayerStore.getState().dice.get(dieId)
    if (!currentDie) return

    if (currentDie.isLocallyDragged && currentDie.localDragPosition) {
      // Optimistic: show die at local drag position
      const dragPos = currentDie.localDragPosition
      meshRef.current.position.set(dragPos[0], dragPos[1], dragPos[2])
    } else {
      // Interpolate between prev and target snapshots using live t value
      const t = tRef.current
      interpPos.set(currentDie.prevPosition[0], currentDie.prevPosition[1], currentDie.prevPosition[2])
      targetPos.set(currentDie.targetPosition[0], currentDie.targetPosition[1], currentDie.targetPosition[2])
      interpPos.lerp(targetPos, t)
      meshRef.current.position.copy(interpPos)

      // Interpolate rotation (slerp)
      prevQuat.set(currentDie.prevRotation[0], currentDie.prevRotation[1], currentDie.prevRotation[2], currentDie.prevRotation[3])
      targetQuat.set(currentDie.targetRotation[0], currentDie.targetRotation[1], currentDie.targetRotation[2], currentDie.targetRotation[3])
      interpQuat.slerpQuaternions(prevQuat, targetQuat, t)
      meshRef.current.quaternion.copy(interpQuat)
    }
  })

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      castShadow
      receiveShadow
      onPointerDown={isOwnedByLocalPlayer ? handlePointerDown : undefined}
      onPointerEnter={isOwnedByLocalPlayer ? handlePointerEnter : undefined}
      onPointerLeave={handlePointerLeave}
    >
      <meshStandardMaterial color={color} />
    </mesh>
  )
}
