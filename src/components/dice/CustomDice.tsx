/**
 * Custom Dice Component
 *
 * Renders custom dice loaded from GLB files with custom physics and face detection.
 * Similar to the standard Dice component, but uses loaded 3D models instead of
 * procedurally generated geometry.
 */

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { ContactForcePayload, RapierRigidBody, RigidBody, RoundCuboidCollider } from '@react-three/rapier'
import * as THREE from 'three'
import {
  MAX_DICE_VELOCITY,
  HAPTIC_MIN_SPEED,
  HAPTIC_MIN_VELOCITY_CHANGE,
  HAPTIC_FORCE_DIRECTION_THRESHOLD,
  HAPTIC_MIN_FORCE,
  HAPTIC_LIGHT_THRESHOLD,
  HAPTIC_MEDIUM_THRESHOLD,
  HAPTIC_HIGH_FORCE_BYPASS,
  DRAG_FOLLOW_SPEED,
  DRAG_DISTANCE_THRESHOLD,
  DRAG_DISTANCE_BOOST,
  DRAG_SPIN_FACTOR,
  DRAG_ROLL_FACTOR,
} from '../../config/physicsConfig'
import { useDeviceMotionRef } from '../../contexts/DeviceMotionContext'
import { useDiceInteraction } from '../../hooks/useDiceInteraction'
import { useFaceDetection } from '../../hooks/useFaceDetection'
import { useHapticFeedback } from '../../hooks/useHapticFeedback'
import { useCustomDiceLoader } from '../../hooks/useCustomDiceLoader'
import { CustomDiceAsset } from '../../types/customDice'
import { useUIStore } from '../../store/useUIStore'
import { DiceHandle } from './Dice'

interface CustomDiceProps {
  /** Custom dice asset with model and metadata */
  asset: CustomDiceAsset

  /** Unique identifier for this dice instance */
  id?: string

  /** Initial position [x, y, z] */
  position?: [number, number, number]

  /** Callback when dice comes to rest with face value */
  onRest?: (id: string, faceValue: number, diceType: string) => void
}

/**
 * Custom dice component with GLB model loading
 *
 * Supports all the same physics interactions as standard dice:
 * - Rolling with impulses
 * - Dragging and throwing
 * - Device motion (tilt/shake)
 * - Haptic feedback on collisions
 * - Face detection when at rest
 */
const CustomDiceComponent = forwardRef<DiceHandle, CustomDiceProps>(
  (
    {
      asset,
      id = 'custom-dice-0',
      position = [0, 5, 0],
      onRest,
    },
    ref,
  ) => {
    const rigidBodyRef = useRef<RapierRigidBody>(null)
    const initialPositionRef = useRef(position)

    // Load the custom dice model and metadata
    const { scene, faceNormals, metadata } = useCustomDiceLoader(asset)

    // Use face detection with custom normals
    const {
      isAtRest,
      faceValue,
      updateMotion,
      readFaceValue,
      reset: resetFaceDetection,
    } = useFaceDetection(faceNormals)

    const { isDragging, onPointerDown, cancelDrag, getDragState } = useDiceInteraction()
    const { isShakingRef } = useDeviceMotionRef()
    const { vibrateOnCollision } = useHapticFeedback()
    const motionMode = useUIStore((state) => state.motionMode)

    const hasNotifiedRef = useRef(false)
    const pendingNotificationRef = useRef<number | null>(null)
    const lastShakeStateRef = useRef(false)
    const lastDragPositionRef = useRef<THREE.Vector3 | null>(null)
    const lastVelocityVectorRef = useRef<THREE.Vector3>(new THREE.Vector3())

    // Get physics properties from metadata
    const physicsProps = metadata?.physics || {
      mass: 1.0,
      restitution: 0.3,
      friction: 0.6,
    }

    const colliderConfig = metadata?.colliderType || 'hull'
    const colliderArgs = metadata?.colliderArgs || {}
    const scale = metadata?.scale || 1.0
    const diceType = metadata?.diceType || 'd6'

    // Expose imperative handle (same as standard Dice)
    useImperativeHandle(ref, () => ({
      applyImpulse: (impulse: THREE.Vector3) => {
        if (!rigidBodyRef.current) return

        cancelDrag()

        // Reset dice to initial position with random rotation
        rigidBodyRef.current.setTranslation(
          {
            x: initialPositionRef.current[0],
            y: initialPositionRef.current[1],
            z: initialPositionRef.current[2],
          },
          true,
        )

        const randomRotation = new THREE.Euler(
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
        )
        const quaternion = new THREE.Quaternion().setFromEuler(randomRotation)

        rigidBodyRef.current.setRotation(
          { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
          true,
        )

        rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)
        rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true)

        rigidBodyRef.current.applyImpulse(
          { x: impulse.x, y: impulse.y, z: impulse.z },
          true,
        )

        const angularImpulse = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
        )
        rigidBodyRef.current.applyTorqueImpulse(
          { x: angularImpulse.x, y: angularImpulse.y, z: angularImpulse.z },
          true,
        )

        resetFaceDetection()
        hasNotifiedRef.current = false
      },

      applyRollImpulse: (impulse: THREE.Vector3) => {
        if (!rigidBodyRef.current) return

        rigidBodyRef.current.applyImpulse(
          { x: impulse.x, y: impulse.y, z: impulse.z },
          true,
        )

        const angularImpulse = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
        )
        rigidBodyRef.current.applyTorqueImpulse(
          { x: angularImpulse.x, y: angularImpulse.y, z: angularImpulse.z },
          true,
        )

        resetFaceDetection()
        hasNotifiedRef.current = false
      },

      reset: () => {
        if (!rigidBodyRef.current) return

        cancelDrag()

        rigidBodyRef.current.setTranslation(
          {
            x: initialPositionRef.current[0],
            y: initialPositionRef.current[1],
            z: initialPositionRef.current[2],
          },
          true,
        )
        rigidBodyRef.current.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
        rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)
        rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true)

        resetFaceDetection()
        hasNotifiedRef.current = false
      },
    }))

    // Reset notification flag when dice moves
    useEffect(() => {
      if (!isAtRest) {
        hasNotifiedRef.current = false
        pendingNotificationRef.current = null
      }
    }, [isAtRest])

    // Handle drag state changes
    useEffect(() => {
      if (!rigidBodyRef.current) return

      if (isDragging) {
        rigidBodyRef.current.wakeUp()
        resetFaceDetection()
        hasNotifiedRef.current = false
      } else {
        resetFaceDetection()
        hasNotifiedRef.current = false
      }
    }, [isDragging, resetFaceDetection])

    // Notify parent when dice comes to rest
    useEffect(() => {
      if (isAtRest && faceValue !== null && !hasNotifiedRef.current && onRest) {
        pendingNotificationRef.current = faceValue

        requestAnimationFrame(() => {
          if (
            pendingNotificationRef.current !== null &&
            !hasNotifiedRef.current &&
            rigidBodyRef.current
          ) {
            const vel = rigidBodyRef.current.linvel()
            const angVel = rigidBodyRef.current.angvel()
            const stillAtRest =
              Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2) < 0.01 &&
              Math.sqrt(angVel.x ** 2 + angVel.y ** 2 + angVel.z ** 2) < 0.01

            if (stillAtRest) {
              onRest(id, pendingNotificationRef.current, diceType)
              hasNotifiedRef.current = true
            }
            pendingNotificationRef.current = null
          }
        })
      }
    }, [isAtRest, faceValue, onRest, id, diceType])

    // Physics loop
    useFrame(() => {
      if (!rigidBodyRef.current) return

      const velocity = rigidBodyRef.current.linvel()
      const angularVelocity = rigidBodyRef.current.angvel()

      const { isDragging: dragActive, targetPosition } = getDragState()

      // Apply velocity-based dragging
      if (dragActive && targetPosition) {
        const currentPos = rigidBodyRef.current.translation()
        const currentPosVec = new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z)

        const displacement = targetPosition.clone().sub(currentPosVec)
        const distance = displacement.length()

        let speedMultiplier = DRAG_FOLLOW_SPEED
        if (distance > DRAG_DISTANCE_THRESHOLD) {
          const distanceFactor =
            (distance - DRAG_DISTANCE_THRESHOLD) / DRAG_DISTANCE_THRESHOLD
          speedMultiplier =
            DRAG_FOLLOW_SPEED + DRAG_DISTANCE_BOOST * Math.min(distanceFactor, 1)
        }

        const desiredVelocity = displacement.multiplyScalar(speedMultiplier)

        rigidBodyRef.current.setLinvel(
          { x: desiredVelocity.x, y: desiredVelocity.y, z: desiredVelocity.z },
          true,
        )

        if (lastDragPositionRef.current) {
          const dragMovement = currentPosVec.clone().sub(lastDragPositionRef.current)
          const moveSpeed = dragMovement.length()

          if (moveSpeed > 0.02) {
            const moveDirection = dragMovement.normalize()
            const upVector = new THREE.Vector3(0, 1, 0)

            const rollAxis = new THREE.Vector3().crossVectors(upVector, moveDirection)
            const rollTorque = rollAxis.multiplyScalar(moveSpeed * DRAG_ROLL_FACTOR)

            const spinAxis = new THREE.Vector3().crossVectors(moveDirection, upVector)
            const spinTorque = spinAxis.multiplyScalar(moveSpeed * DRAG_SPIN_FACTOR)

            const totalTorque = rollTorque.add(spinTorque)

            rigidBodyRef.current.applyTorqueImpulse(
              { x: totalTorque.x, y: totalTorque.y, z: totalTorque.z },
              true,
            )
          }
        }

        lastDragPositionRef.current = currentPosVec.clone()
      } else {
        lastDragPositionRef.current = null
      }

      updateMotion(
        new THREE.Vector3(velocity.x, velocity.y, velocity.z),
        new THREE.Vector3(angularVelocity.x, angularVelocity.y, angularVelocity.z),
      )

      // Apply shake torque
      if (motionMode) {
        const isShaking = isShakingRef.current
        if (isShaking && !lastShakeStateRef.current) {
          const shakeTorque = new THREE.Vector3(
            (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 3,
          )
          rigidBodyRef.current.applyTorqueImpulse(
            { x: shakeTorque.x, y: shakeTorque.y, z: shakeTorque.z },
            true,
          )

          resetFaceDetection()
          hasNotifiedRef.current = false
        }
        lastShakeStateRef.current = isShaking
      }

      // Read face value when at rest
      if (isAtRest) {
        const rotation = rigidBodyRef.current.rotation()
        const quaternion = new THREE.Quaternion(
          rotation.x,
          rotation.y,
          rotation.z,
          rotation.w,
        )
        readFaceValue(quaternion, diceType)
      }

      // Clamp velocity
      const currentSpeed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
      if (currentSpeed > MAX_DICE_VELOCITY) {
        const scale = MAX_DICE_VELOCITY / currentSpeed
        rigidBodyRef.current.setLinvel(
          { x: velocity.x * scale, y: velocity.y * scale, z: velocity.z * scale },
          true,
        )
      }
    })

    // Handle contact forces for haptic feedback
    const handleContactForce = useCallback(
      (event: ContactForcePayload) => {
        if (!rigidBodyRef.current) return

        const vel = rigidBodyRef.current.linvel()
        const currentVelocity = new THREE.Vector3(vel.x, vel.y, vel.z)
        const speed = currentVelocity.length()

        if (speed < HAPTIC_MIN_SPEED) {
          lastVelocityVectorRef.current.copy(currentVelocity)
          return
        }

        const forceDir = new THREE.Vector3(
          event.maxForceDirection.x,
          event.maxForceDirection.y,
          event.maxForceDirection.z
        )
        const forceMagnitude = event.maxForceMagnitude

        const velocityDir = currentVelocity.clone().normalize()
        const dot = velocityDir.dot(forceDir.normalize())

        const isHighForceImpact = forceMagnitude > HAPTIC_HIGH_FORCE_BYPASS
        if (!isHighForceImpact && dot > HAPTIC_FORCE_DIRECTION_THRESHOLD) {
          lastVelocityVectorRef.current.copy(currentVelocity)
          return
        }

        const velocityChange = currentVelocity.clone().sub(lastVelocityVectorRef.current)
        const deltaSpeed = velocityChange.length()

        lastVelocityVectorRef.current.copy(currentVelocity)

        if (deltaSpeed < HAPTIC_MIN_VELOCITY_CHANGE) {
          return
        }

        if (forceMagnitude < HAPTIC_MIN_FORCE) {
          return
        }

        if (forceMagnitude < HAPTIC_LIGHT_THRESHOLD) {
          vibrateOnCollision('light')
        } else if (forceMagnitude < HAPTIC_MEDIUM_THRESHOLD) {
          vibrateOnCollision('medium')
        } else {
          vibrateOnCollision('strong')
        }
      },
      [vibrateOnCollision],
    )

    // Don't render if scene isn't loaded yet
    if (!scene) {
      return null
    }

    return (
      <RigidBody
        ref={rigidBodyRef}
        position={position}
        colliders={colliderConfig === 'hull' ? 'hull' : false}
        type="dynamic"
        restitution={physicsProps.restitution}
        friction={physicsProps.friction}
        mass={physicsProps.mass}
        canSleep={false}
        onContactForce={handleContactForce}
      >
        {/* Use RoundCuboidCollider for roundCuboid type */}
        {colliderConfig === 'roundCuboid' && colliderArgs.halfExtents && (
          <RoundCuboidCollider
            args={[
              colliderArgs.halfExtents[0],
              colliderArgs.halfExtents[1],
              colliderArgs.halfExtents[2],
              colliderArgs.borderRadius || 0.08,
            ]}
          />
        )}

        {/* Render the loaded GLB scene */}
        <primitive
          object={scene}
          scale={scale}
          onPointerDown={(event: any) => {
            if (rigidBodyRef.current) {
              onPointerDown(event, rigidBodyRef.current, id)
            }
          }}
        />
      </RigidBody>
    )
  },
)

CustomDiceComponent.displayName = 'CustomDice'

export const CustomDice = memo(CustomDiceComponent)
