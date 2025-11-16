import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

import { useFrame } from '@react-three/fiber'
import { ContactForcePayload, RapierRigidBody, RigidBody, RoundCuboidCollider } from '@react-three/rapier'
import * as THREE from 'three'
import {
  DICE_FRICTION,
  DICE_RESTITUTION,
  DRAG_DISTANCE_BOOST,
  DRAG_DISTANCE_THRESHOLD,
  DRAG_FOLLOW_SPEED,
  DRAG_SPIN_FACTOR,
  DRAG_ROLL_FACTOR,
  EDGE_CHAMFER_RADIUS,
  MAX_DICE_VELOCITY,
  HAPTIC_MIN_SPEED,
  HAPTIC_MIN_VELOCITY_CHANGE,
  HAPTIC_FORCE_DIRECTION_THRESHOLD,
  HAPTIC_MIN_FORCE,
  HAPTIC_LIGHT_THRESHOLD,
  HAPTIC_MEDIUM_THRESHOLD,
  HAPTIC_HIGH_FORCE_BYPASS,
} from '../../config/physicsConfig'
import { useDeviceMotionRef } from '../../contexts/DeviceMotionContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useCriticalDetection } from '../../hooks/useCriticalDetection'
import { useDiceGlow } from '../../hooks/useDiceGlow'
import { useDiceInteraction } from '../../hooks/useDiceInteraction'
import { useFaceDetection } from '../../hooks/useFaceDetection'
import { useHapticFeedback } from '../../hooks/useHapticFeedback'
import {
  DiceShape,
  createD12Geometry,
  createD20Geometry,
  createD4Geometry,
  createD6Geometry,
  createD8Geometry,
  createD10Geometry,
  createDiceMaterial,
} from '../../lib/geometries'
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
  applyRollImpulse: (impulse: THREE.Vector3) => void // Apply impulse without resetting position
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
const DiceComponent = forwardRef<DiceHandle, DiceProps>(
  (
    {
      id = 'dice-0',
      shape,
      position = [0, 5, 0],
      // rotation = [0, 0, 0], // Not used, removed to fix TS error
      size = 1,
      color = 'orange',
      onRest,
    },
    ref,
  ) => {
    const rigidBodyRef = useRef<RapierRigidBody>(null)
    const initialPositionRef = useRef(position)
    const {
      isAtRest,
      faceValue,
      updateMotion,
      readFaceValue,
      reset: resetFaceDetection,
    } = useFaceDetection()
    const { isDragging, onPointerDown, cancelDrag, getDragState } = useDiceInteraction()
    const { isShakingRef } = useDeviceMotionRef()
    const { currentTheme } = useTheme()
    const { vibrateOnCollision } = useHapticFeedback()
    const motionMode = useUIStore((state) => state.motionMode)
    const hasNotifiedRef = useRef(false)
    const pendingNotificationRef = useRef<number | null>(null)
    const lastShakeStateRef = useRef(false)
    const lastDragPositionRef = useRef<THREE.Vector3 | null>(null)

    // Critical effects state
    const [criticalSuccessTriggered, setCriticalSuccessTriggered] = useState(false)
    const [criticalFailureTriggered, setCriticalFailureTriggered] = useState(false)

    // Critical detection
    useCriticalDetection({
      diceType: shape,
      faceValue,
      isAtRest,
      onCriticalSuccess: () => {
        console.log(`[${id}] Critical success! (${shape} rolled ${faceValue})`)
        setCriticalSuccessTriggered(true)
      },
      onCriticalFailure: () => {
        console.log(`[${id}] Critical failure! (${shape} rolled ${faceValue})`)
        setCriticalFailureTriggered(true)
      },
    })

    // Expose imperative handle
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

        // Apply random rotation
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

        // Reset velocities
        rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true)
        rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true)

        // Apply impulse
        rigidBodyRef.current.applyImpulse(
          { x: impulse.x, y: impulse.y, z: impulse.z },
          true,
        )

        // Add random angular impulse for tumbling
        const angularImpulse = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
        )
        rigidBodyRef.current.applyTorqueImpulse(
          { x: angularImpulse.x, y: angularImpulse.y, z: angularImpulse.z },
          true,
        )

        // Reset face detection
        resetFaceDetection()
        hasNotifiedRef.current = false
      },
      applyRollImpulse: (impulse: THREE.Vector3) => {
        if (!rigidBodyRef.current) return

        // Apply impulse to dice in current position (no reset)
        // This allows spam clicking roll button to shake up dice
        rigidBodyRef.current.applyImpulse(
          { x: impulse.x, y: impulse.y, z: impulse.z },
          true,
        )

        // Add random angular impulse for tumbling
        const angularImpulse = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
        )
        rigidBodyRef.current.applyTorqueImpulse(
          { x: angularImpulse.x, y: angularImpulse.y, z: angularImpulse.z },
          true,
        )

        // Reset face detection
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
        // Wake up the dice when dragging starts
        rigidBodyRef.current.wakeUp()

        // Reset face detection since we're manipulating the dice
        resetFaceDetection()
        hasNotifiedRef.current = false
      } else {
        // When released, just let Rapier continue with accumulated velocity
        resetFaceDetection()
        hasNotifiedRef.current = false
      }
    }, [isDragging, resetFaceDetection])

    // Notify parent OUTSIDE of the physics loop
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

      const { isDragging: dragActive, targetPosition } = getDragState()

      // Apply velocity-based dragging (direct control while maintaining physics)
      if (dragActive && targetPosition) {
        const currentPos = rigidBodyRef.current.translation()
        const currentPosVec = new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z)

        // Calculate displacement and distance to target
        const displacement = targetPosition.clone().sub(currentPosVec)
        const distance = displacement.length()

        // Calculate speed multiplier based on distance
        // When far away (> threshold), apply extra boost to allow overshooting
        // When close, use base speed for precise control
        let speedMultiplier = DRAG_FOLLOW_SPEED
        if (distance > DRAG_DISTANCE_THRESHOLD) {
          // Linear boost: the farther away, the faster it moves
          const distanceFactor =
            (distance - DRAG_DISTANCE_THRESHOLD) / DRAG_DISTANCE_THRESHOLD
          speedMultiplier =
            DRAG_FOLLOW_SPEED + DRAG_DISTANCE_BOOST * Math.min(distanceFactor, 1)
        }

        // Calculate desired velocity to reach target position
        const desiredVelocity = displacement.multiplyScalar(speedMultiplier)

        // Set velocity directly for responsive dragging
        rigidBodyRef.current.setLinvel(
          { x: desiredVelocity.x, y: desiredVelocity.y, z: desiredVelocity.z },
          true,
        )

        // Apply torque based on movement direction and speed (additive, not replacing)
        if (lastDragPositionRef.current) {
          const dragMovement = currentPosVec.clone().sub(lastDragPositionRef.current)
          const moveSpeed = dragMovement.length()

          // Only apply spin if there's meaningful movement
          if (moveSpeed > 0.02) {
            const moveDirection = dragMovement.normalize()
            const upVector = new THREE.Vector3(0, 1, 0)

            // 1. Rolling motion: dice rolls towards cursor like a ball on a surface
            // The rotation axis is perpendicular to movement in the horizontal plane
            // This creates the primary "rolling" feel
            const rollAxis = new THREE.Vector3().crossVectors(upVector, moveDirection)
            const rollTorque = rollAxis.multiplyScalar(moveSpeed * DRAG_ROLL_FACTOR)

            // 2. Tumbling motion: perpendicular spin for natural tumbling
            // Cross product of movement direction with up vector
            const spinAxis = new THREE.Vector3().crossVectors(moveDirection, upVector)
            const spinTorque = spinAxis.multiplyScalar(moveSpeed * DRAG_SPIN_FACTOR)

            // Combine both torques
            const totalTorque = rollTorque.add(spinTorque)

            // Apply combined torque impulse (adds to existing angular velocity)
            rigidBodyRef.current.applyTorqueImpulse(
              { x: totalTorque.x, y: totalTorque.y, z: totalTorque.z },
              true,
            )
          }
        }

        // Store current position for next frame
        lastDragPositionRef.current = currentPosVec.clone()
      } else {
        // Clear drag position when not dragging
        lastDragPositionRef.current = null
      }

      updateMotion(
        new THREE.Vector3(velocity.x, velocity.y, velocity.z),
        new THREE.Vector3(angularVelocity.x, angularVelocity.y, angularVelocity.z),
      )

      // Apply angular impulse when shake is detected (only if motion mode is enabled)
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
        readFaceValue(quaternion, shape)
      }

      // Clamp velocity to prevent wall clipping from spam clicking roll button
      const currentSpeed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
      if (currentSpeed > MAX_DICE_VELOCITY) {
        const scale = MAX_DICE_VELOCITY / currentSpeed
        rigidBodyRef.current.setLinvel(
          { x: velocity.x * scale, y: velocity.y * scale, z: velocity.z * scale },
          true,
        )
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
        case 'd10':
          return createD10Geometry(size)
        case 'd12':
          return createD12Geometry(size)
        case 'd20':
          return createD20Geometry(size)
        default:
          return createD6Geometry(size)
      }
    }, [shape, size])

    const material = useMemo(() => {
      const diceMaterials = currentTheme.dice.materials
      const visualEffects = currentTheme.visualEffects
      const mat = createDiceMaterial(
        color,
        diceMaterials.roughness,
        diceMaterials.metalness,
        diceMaterials.emissiveIntensity,
        visualEffects.shaderStyle,
        visualEffects.toonShader
      )
      // D10 should use flat shading to show distinct kite-shaped faces (only for standard materials)
      if (shape === 'd10' && mat instanceof THREE.MeshStandardMaterial) {
        mat.flatShading = true
        mat.needsUpdate = true
      }
      return mat
    }, [color, shape, currentTheme.dice.materials, currentTheme.visualEffects])

    // Determine which glow config to use
    const activeGlowConfig = criticalSuccessTriggered
      ? currentTheme.visualEffects.criticalEffects?.criticalSuccess?.glow ?? null
      : criticalFailureTriggered
      ? currentTheme.visualEffects.criticalEffects?.criticalFailure?.glow ?? null
      : null

    // Apply glow effect for criticals
    useDiceGlow({
      material,
      glowConfig: activeGlowConfig,
      trigger: criticalSuccessTriggered || criticalFailureTriggered,
    })

    // Reset critical triggers when dice starts moving
    useEffect(() => {
      if (!isAtRest) {
        setCriticalSuccessTriggered(false)
        setCriticalFailureTriggered(false)
      }
    }, [isAtRest])

    // Calculate half-extents for D6 collider
    const halfSize = size / 2

    // Track last velocity to detect actual impacts (change in velocity)
    const lastVelocityVectorRef = useRef<THREE.Vector3>(new THREE.Vector3())

    // Handle contact forces for haptic feedback
    const handleContactForce = useCallback(
      (event: ContactForcePayload) => {
        if (!rigidBodyRef.current) return

        // Get current velocity vector
        const vel = rigidBodyRef.current.linvel()
        const currentVelocity = new THREE.Vector3(vel.x, vel.y, vel.z)
        const speed = currentVelocity.length()

        // Only process if dice is actually moving with significant speed
        if (speed < HAPTIC_MIN_SPEED) {
          lastVelocityVectorRef.current.copy(currentVelocity)
          return
        }

        // Get force direction vector
        const forceDir = new THREE.Vector3(
          event.maxForceDirection.x,
          event.maxForceDirection.y,
          event.maxForceDirection.z
        )
        const forceMagnitude = event.maxForceMagnitude

        // Normalize velocity for direction comparison
        const velocityDir = currentVelocity.clone().normalize()

        // Calculate dot product to determine if force is opposing motion
        // dot < 0 means force is opposite to velocity (impact/collision)
        // dot > 0 means force is same direction as velocity (pushing)
        // dot ≈ 0 means force is perpendicular (could be sliding friction)
        const dot = velocityDir.dot(forceDir.normalize())

        // Only trigger haptic for opposing forces (actual impacts)
        // Exception: Skip direction check for high-force impacts (likely wall collisions)
        // Wall collisions can have positive dot products due to rotation and glancing angles
        const isHighForceImpact = forceMagnitude > HAPTIC_HIGH_FORCE_BYPASS
        if (!isHighForceImpact && dot > HAPTIC_FORCE_DIRECTION_THRESHOLD) {
          lastVelocityVectorRef.current.copy(currentVelocity)
          return
        }

        // Calculate velocity change (delta-v) to detect impact strength
        const velocityChange = currentVelocity.clone().sub(lastVelocityVectorRef.current)
        const deltaSpeed = velocityChange.length()

        // Store current velocity for next comparison
        lastVelocityVectorRef.current.copy(currentVelocity)

        // Require significant velocity change for impact detection
        // This filters out minor contacts and continuous forces
        if (deltaSpeed < HAPTIC_MIN_VELOCITY_CHANGE) {
          return
        }

        // Map force to haptic intensity based on impact strength
        // Thresholds configured in physicsConfig.ts
        if (forceMagnitude < HAPTIC_MIN_FORCE) {
          return // Too weak to vibrate
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

    return (
      <RigidBody
        ref={rigidBodyRef}
        position={position}
        colliders={shape === 'd6' ? false : 'hull'}
        type="dynamic"
        restitution={DICE_RESTITUTION}
        friction={DICE_FRICTION}
        canSleep={false}
        onContactForce={handleContactForce}
      >
        {/* Use RoundCuboid for D6 to add chamfered edges */}
        {shape === 'd6' && (
          <RoundCuboidCollider
            args={[halfSize, halfSize, halfSize, EDGE_CHAMFER_RADIUS]}
          />
        )}

        <mesh
          geometry={geometry}
          material={material}
          castShadow
          receiveShadow
          onPointerDown={(event) => {
            if (rigidBodyRef.current) {
              onPointerDown(event, rigidBodyRef.current, id)
            }
          }}
        />
      </RigidBody>
    )
  },
)

DiceComponent.displayName = 'Dice'

export const Dice = memo(DiceComponent)
