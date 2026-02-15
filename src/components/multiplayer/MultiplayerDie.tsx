import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { DiceShape } from '../../lib/geometries'
import { createDiceGeometry } from '../../lib/geometries'

interface MultiplayerDieProps {
  diceType: DiceShape
  color: string
  targetPosition: [number, number, number]
  targetRotation: [number, number, number, number] // quaternion [x, y, z, w]
  prevPosition: [number, number, number]
  prevRotation: [number, number, number, number]
  interpolationT: number // 0-1, how far between prev and target
}

export function MultiplayerDie({
  diceType,
  color,
  targetPosition,
  targetRotation,
  prevPosition,
  prevRotation,
  interpolationT,
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

  useFrame(() => {
    if (!meshRef.current) return

    // Interpolate position (lerp)
    interpPos.set(prevPosition[0], prevPosition[1], prevPosition[2])
    targetPos.set(targetPosition[0], targetPosition[1], targetPosition[2])
    interpPos.lerp(targetPos, interpolationT)
    meshRef.current.position.copy(interpPos)

    // Interpolate rotation (slerp)
    prevQuat.set(prevRotation[0], prevRotation[1], prevRotation[2], prevRotation[3])
    targetQuat.set(targetRotation[0], targetRotation[1], targetRotation[2], targetRotation[3])
    interpQuat.slerpQuaternions(prevQuat, targetQuat, interpolationT)
    meshRef.current.quaternion.copy(interpQuat)
  })

  return (
    <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color={color} />
    </mesh>
  )
}
