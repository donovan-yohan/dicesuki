import { useRef, useEffect, useImperativeHandle, forwardRef, useMemo, memo } from 'react'
import { RigidBody, RapierRigidBody } from '@react-three/rapier'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  DiceShape,
  createD4Geometry,
  createD6Geometry,
  createD8Geometry,
  createD12Geometry,
  createD20Geometry,
  createDiceMaterial
} from '../../lib/geometries'
import { useFaceDetection } from '../../hooks/useFaceDetection'
import { useDiceInteraction } from '../../hooks/useDiceInteraction'
import { useDeviceMotionRef } from '../../contexts/DeviceMotionContext'
import { useUIStore } from '../../store/useUIStore'

interface DiceProps {
  id?: string
  shape: DiceShape
  position?: [number, number, number]
  rotation?: [number, number, number]
  size?: number
  color?: string
  onRest?: (id: string, faceValue: number, diceType: string) => void
}

export interface DiceHandle {
  applyImpulse: (impulse: THREE.Vector3) => void
  reset: () => void
}

/**
 * Generic dice component supporting all dice shapes
 *
 * @param shape - Dice shape (d4, d6, d8, d12, d20)
 * @param position - Initial position [x, y, z]
 * @param rotation - Initial rotation [x, y, z] in radians
 * @param size - Size of the dice (default: 1)
 * @param color - Color of the dice
 * @param onRest - Callback when dice comes to rest with face value
 * @param ref - Imperative handle to control dice (applyImpulse, reset)
 */
const DiceComponent = forwardRef<DiceHandle, DiceProps>(({
  id = 'dice-0',
  shape,
  position = [0, 5, 0],
  rotation: _rotation = [0, 0, 0],
  size = 1,
  color = 'orange',
  onRest
}, ref) => {
  const rigidBodyRef = useRef<RapierRigidBody>(null)
  const initialPositionRef = useRef(position)
  const { isAtRest, faceValue, updateMotion, readFaceValue, reset: resetFaceDetection } = useFaceDetection()
  const { isDragging, onPointerDown, onPointerMove, onPointerUp, getFlickImpulse } = useDiceInteraction()
  const { isShakingRef } = useDeviceMotionRef()
  const motionMode = useUIStore((state) => state.motionMode)
  const hasNotifiedRef = useRef(false)
  const pendingNotificationRef = useRef<number | null>(null)
  const lastShakeStateRef = useRef(false)

  // Expose imperative handle
  useImperativeHandle(ref, () => ({
    applyImpulse: (impulse: THREE.Vector3) => {
      if (!rigidBodyRef.current) return

      // Reset dice to initial position with random rotation
      rigidBodyRef.current.setTranslation(
        { x: initialPositionRef.current[0], y: initialPositionRef.current[1], z: initialPositionRef.current[2] },
        true
      )

      // Apply random rotation
      const randomRotation = new THREE.Euler(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      )
      const quaternion = new THREE.Quaternion().setFromEuler(randomRotation)

      rigidBodyRef.current.setRotation(
        { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
        true
      )

      // Reset velocities
      rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)
      rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true)

      // Apply impulse
      rigidBodyRef.current.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true)

      // Add random angular impulse for tumbling
      const angularImpulse = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      )
      rigidBodyRef.current.applyTorqueImpulse(
        { x: angularImpulse.x, y: angularImpulse.y, z: angularImpulse.z },
        true
      )

      // Reset face detection
      resetFaceDetection()
      hasNotifiedRef.current = false
    },
    reset: () => {
      if (!rigidBodyRef.current) return

      rigidBodyRef.current.setTranslation(
        { x: initialPositionRef.current[0], y: initialPositionRef.current[1], z: initialPositionRef.current[2] },
        true
      )
      rigidBodyRef.current.setRotation(
        { x: 0, y: 0, z: 0, w: 1 },
        true
      )
      rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)
      rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true)

      resetFaceDetection()
      hasNotifiedRef.current = false
    }
  }))

  // Reset notification flag when dice moves
  useEffect(() => {
    if (!isAtRest) {
      hasNotifiedRef.current = false
      pendingNotificationRef.current = null
    }
  }, [isAtRest])

  // Handle flick impulse when pointer is released
  useEffect(() => {
    if (!isDragging) {
      const flickImpulse = getFlickImpulse()
      if (flickImpulse && rigidBodyRef.current) {
        rigidBodyRef.current.applyImpulse(
          { x: flickImpulse.x, y: flickImpulse.y, z: flickImpulse.z },
          true
        )

        const angularImpulse = new THREE.Vector3(
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5
        )
        rigidBodyRef.current.applyTorqueImpulse(
          { x: angularImpulse.x, y: angularImpulse.y, z: angularImpulse.z },
          true
        )

        resetFaceDetection()
        hasNotifiedRef.current = false
      }
    }
  }, [isDragging, getFlickImpulse, resetFaceDetection])

  // Notify parent OUTSIDE of the physics loop
  useEffect(() => {
    if (isAtRest && faceValue !== null && !hasNotifiedRef.current && onRest) {
      pendingNotificationRef.current = faceValue

      requestAnimationFrame(() => {
        if (pendingNotificationRef.current !== null && !hasNotifiedRef.current && rigidBodyRef.current) {
          const vel = rigidBodyRef.current.linvel()
          const angVel = rigidBodyRef.current.angvel()
          const stillAtRest = Math.sqrt(vel.x**2 + vel.y**2 + vel.z**2) < 0.01 &&
                             Math.sqrt(angVel.x**2 + angVel.y**2 + angVel.z**2) < 0.01

          if (stillAtRest) {
            onRest(id, pendingNotificationRef.current, shape)
            hasNotifiedRef.current = true
          }
          pendingNotificationRef.current = null
        }
      })
    }
  }, [isAtRest, faceValue, onRest, id])

  // Update physics state every frame
  useFrame(() => {
    if (!rigidBodyRef.current) return

    const velocity = rigidBodyRef.current.linvel()
    const angularVelocity = rigidBodyRef.current.angvel()

    updateMotion(
      new THREE.Vector3(velocity.x, velocity.y, velocity.z),
      new THREE.Vector3(angularVelocity.x, angularVelocity.y, angularVelocity.z)
    )

    // Apply angular impulse when shake is detected (only if motion mode is enabled)
    if (motionMode) {
      const isShaking = isShakingRef.current
      if (isShaking && !lastShakeStateRef.current) {
        const shakeTorque = new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 3
        )
        rigidBodyRef.current.applyTorqueImpulse(
          { x: shakeTorque.x, y: shakeTorque.y, z: shakeTorque.z },
          true
        )

        resetFaceDetection()
        hasNotifiedRef.current = false
      }
      lastShakeStateRef.current = isShaking
    }

    // Read face value when at rest
    if (isAtRest) {
      const rotation = rigidBodyRef.current.rotation()
      const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
      readFaceValue(quaternion, shape)
    }
  })

  // Select geometry based on shape
  const geometry = useMemo(() => {
    switch (shape) {
      case 'd4':
        return createD4Geometry(size)
      case 'd6':
        return createD6Geometry(size)
      case 'd8':
        return createD8Geometry(size)
      case 'd12':
        return createD12Geometry(size)
      case 'd20':
        return createD20Geometry(size)
      default:
        return createD6Geometry(size)
    }
  }, [shape, size])

  const material = useMemo(() => createDiceMaterial(color), [color])

  // Select collider shape based on dice type
  const colliderType = shape === 'd6' ? 'cuboid' : 'hull'

  return (
    <RigidBody
      ref={rigidBodyRef}
      position={position}
      colliders={colliderType}
      type="dynamic"
      restitution={0.3}
      friction={0.6}
      canSleep={false}
    >
      <mesh
        geometry={geometry}
        material={material}
        castShadow
        receiveShadow
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </RigidBody>
  )
})

DiceComponent.displayName = 'Dice'

export const Dice = memo(DiceComponent)
