import { useRef, useMemo, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { DiceShape } from '../../lib/geometries'
import { createDiceGeometry } from '../../lib/geometries'

interface MultiplayerDieProps {
  dieId: string
  diceType: DiceShape
  color: string
  targetPosition: [number, number, number]
  targetRotation: [number, number, number, number] // quaternion [x, y, z, w]
  prevPosition: [number, number, number]
  prevRotation: [number, number, number, number]
  interpolationT: number // 0-1, how far between prev and target
  isLocallyDragged: boolean
  localDragPosition: [number, number, number] | null
  isOwnedByLocalPlayer: boolean
  onDragStart?: (event: ThreeEvent<PointerEvent>, dieId: string) => void
}

export function MultiplayerDie({
  dieId,
  diceType,
  color,
  targetPosition,
  targetRotation,
  prevPosition,
  prevRotation,
  interpolationT,
  isLocallyDragged,
  localDragPosition,
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

    if (isLocallyDragged && localDragPosition) {
      // Optimistic: show die at local drag position
      meshRef.current.position.set(localDragPosition[0], localDragPosition[1], localDragPosition[2])
    } else {
      // Normal interpolation from server snapshots
      interpPos.set(prevPosition[0], prevPosition[1], prevPosition[2])
      targetPos.set(targetPosition[0], targetPosition[1], targetPosition[2])
      interpPos.lerp(targetPos, interpolationT)
      meshRef.current.position.copy(interpPos)

      // Interpolate rotation (slerp)
      prevQuat.set(prevRotation[0], prevRotation[1], prevRotation[2], prevRotation[3])
      targetQuat.set(targetRotation[0], targetRotation[1], targetRotation[2], targetRotation[3])
      interpQuat.slerpQuaternions(prevQuat, targetQuat, interpolationT)
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
