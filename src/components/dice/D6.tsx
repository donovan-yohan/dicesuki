import { useRef, useEffect, useImperativeHandle, forwardRef, useMemo, memo } from 'react'
import { RigidBody, RapierRigidBody } from '@react-three/rapier'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { createD6Geometry, createD6Material } from '../../lib/geometries'
import { useFaceDetection } from '../../hooks/useFaceDetection'
import { useDiceInteraction } from '../../hooks/useDiceInteraction'
import { useDeviceMotionRef } from '../../contexts/DeviceMotionContext'

interface D6Props {
  id?: string
  position?: [number, number, number]
  rotation?: [number, number, number]
  size?: number
  color?: string
  onRest?: (id: string, faceValue: number) => void
}

export interface D6Handle {
  applyImpulse: (impulse: THREE.Vector3) => void
  reset: () => void
}

/**
 * D6 (six-sided cube dice) component with physics
 *
 * @param position - Initial position [x, y, z]
 * @param rotation - Initial rotation [x, y, z] in radians
 * @param size - Size of the dice (default: 1)
 * @param color - Color of the dice (default: 'orange')
 * @param onRest - Callback when dice comes to rest with face value
 * @param ref - Imperative handle to control dice (applyImpulse, reset)
 */
const D6Component = forwardRef<D6Handle, D6Props>(({
  id = 'dice-0',
  position = [0, 5, 0],
  rotation: _rotation = [0, 0, 0], // Prefixed with _ to indicate intentionally unused
  size = 1,
  color = 'orange',
  onRest
}, ref) => {
  const rigidBodyRef = useRef<RapierRigidBody>(null)
  const initialPositionRef = useRef(position)
  const { isAtRest, faceValue, updateMotion, readFaceValue, reset: resetFaceDetection } = useFaceDetection()
  const { isDragging, onPointerDown, onPointerMove, onPointerUp, getFlickImpulse } = useDiceInteraction()
  const { isShakingRef } = useDeviceMotionRef()
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
      
      // DEBUG: Log the rotation being applied
      if (import.meta.env.DEV) {
        console.log('🎲 applyImpulse - Setting rotation:', {
          eulerDegrees: `(${(randomRotation.x * 180 / Math.PI).toFixed(1)}°, ${(randomRotation.y * 180 / Math.PI).toFixed(1)}°, ${(randomRotation.z * 180 / Math.PI).toFixed(1)}°)`,
          quaternion: `(${quaternion.x.toFixed(3)}, ${quaternion.y.toFixed(3)}, ${quaternion.z.toFixed(3)}, ${quaternion.w.toFixed(3)})`
        })
      }
      
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

        // Apply impulse directly to current dice (no reset)
        rigidBodyRef.current.applyImpulse(
          { x: flickImpulse.x, y: flickImpulse.y, z: flickImpulse.z },
          true
        )

        // Add some angular impulse for realistic tumbling
        const angularImpulse = new THREE.Vector3(
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5
        )
        rigidBodyRef.current.applyTorqueImpulse(
          { x: angularImpulse.x, y: angularImpulse.y, z: angularImpulse.z },
          true
        )

        // Reset face detection to track new roll
        resetFaceDetection()
        hasNotifiedRef.current = false
      }
    }
  }, [isDragging, getFlickImpulse, resetFaceDetection])

  // Notify parent OUTSIDE of the physics loop using requestAnimationFrame
  useEffect(() => {
    if (isAtRest && faceValue !== null && !hasNotifiedRef.current && onRest) {
      // Store the value to notify
      pendingNotificationRef.current = faceValue

      // Defer notification until next animation frame (after physics loop)
      // This ensures React state updates don't interfere with physics simulation
      requestAnimationFrame(() => {
        // Double-check the dice is still at rest before notifying
        if (pendingNotificationRef.current !== null && !hasNotifiedRef.current && rigidBodyRef.current) {
          const vel = rigidBodyRef.current.linvel()
          const angVel = rigidBodyRef.current.angvel()
          const stillAtRest = Math.sqrt(vel.x**2 + vel.y**2 + vel.z**2) < 0.01 &&
                             Math.sqrt(angVel.x**2 + angVel.y**2 + angVel.z**2) < 0.01

          if (stillAtRest) {
            onRest(id, pendingNotificationRef.current)
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

    // Apply angular impulse when shake is detected
    const isShaking = isShakingRef.current
    if (isShaking && !lastShakeStateRef.current) {
      // Shake just started - add random angular velocity
      const shakeTorque = new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 3
      )
      rigidBodyRef.current.applyTorqueImpulse(
        { x: shakeTorque.x, y: shakeTorque.y, z: shakeTorque.z },
        true
      )

      // Reset face detection to track new roll
      resetFaceDetection()
      hasNotifiedRef.current = false
    }
    lastShakeStateRef.current = isShaking

    // Read face value when at rest
    if (isAtRest) {
      const rotation = rigidBodyRef.current.rotation()
      const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
      readFaceValue(quaternion, 'd6')
    }
  })

  // Memoize geometry and material to prevent recreation on re-renders
  const geometry = useMemo(() => createD6Geometry(size), [size])
  const material = useMemo(() => createD6Material(color), [color])

  return (
    <RigidBody
      ref={rigidBodyRef}
      position={position}
      colliders="cuboid"
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

D6Component.displayName = 'D6'

// Memoize the component to prevent re-renders when parent state changes
export const D6 = memo(D6Component)
