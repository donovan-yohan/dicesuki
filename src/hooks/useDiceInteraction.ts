import { useState, useCallback, useRef, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import type { RapierRigidBody } from '@react-three/rapier'
import {
  DRAG_PLANE_HEIGHT,
  THROW_VELOCITY_SCALE,
  THROW_UPWARD_BOOST,
  MIN_THROW_SPEED,
  MAX_THROW_SPEED,
  VELOCITY_HISTORY_SIZE,
} from '../config/physicsConfig'
import { useDragStore } from '../store/useDragStore'

interface VelocityHistoryEntry {
  position: THREE.Vector3
  time: number
}

interface DragState {
  isDragging: boolean
  targetPosition: THREE.Vector3 | null
  throwVelocity: THREE.Vector3 | null
}

interface DiceInteraction {
  isDragging: boolean
  onPointerDown: (event: ThreeEvent<PointerEvent>, rigidBody: RapierRigidBody, diceId: string) => void
  getDragState: () => DragState
  cancelDrag: () => void
}

/**
 * Hook for handling velocity-based drag interaction with dice
 *
 * Uses direct velocity manipulation for responsive dragging while maintaining
 * full physics interaction. On release, calculates throw velocity from drag motion.
 * Supports drag-to-delete by checking for trash zone on release.
 */
export function useDiceInteraction(): DiceInteraction {
  const { camera, gl, size } = useThree()
  const setDraggedDiceId = useDragStore((state) => state.setDraggedDiceId)
  const onDiceDelete = useDragStore((state) => state.onDiceDelete)

  const [isDragging, setIsDragging] = useState(false)

  // Refs for state that updates every frame (avoid re-renders)
  const isDraggingRef = useRef(false)
  const targetPositionRef = useRef<THREE.Vector3 | null>(null)
  const throwVelocityRef = useRef<THREE.Vector3 | null>(null)
  const dragOffsetRef = useRef<THREE.Vector3 | null>(null)
  const currentPointerIdRef = useRef<number | null>(null)
  const capturedElementRef = useRef<HTMLElement | null>(null)
  const rigidBodyRef = useRef<RapierRigidBody | null>(null)
  const currentDiceIdRef = useRef<string | null>(null)

  // Velocity tracking for throw calculation
  const velocityHistoryRef = useRef<VelocityHistoryEntry[]>([])
  
  // Raycasting
  const raycaster = useRef(new THREE.Raycaster())
  const dragPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -DRAG_PLANE_HEIGHT))

  /**
   * Project pointer screen coordinates onto the drag plane
   */
  const getPointerWorldPosition = useCallback((clientX: number, clientY: number): THREE.Vector3 | null => {
    // Convert screen coordinates to normalized device coordinates (-1 to +1)
    const rect = gl.domElement.getBoundingClientRect()
    const x = ((clientX - rect.left) / size.width) * 2 - 1
    const y = -((clientY - rect.top) / size.height) * 2 + 1

    // Update raycaster with camera and pointer position
    raycaster.current.setFromCamera(new THREE.Vector2(x, y), camera)

    // Intersect ray with drag plane
    const intersection = new THREE.Vector3()
    const didIntersect = raycaster.current.ray.intersectPlane(dragPlane.current, intersection)

    return didIntersect ? intersection : null
  }, [camera, gl.domElement, size.width, size.height])

  /**
   * Calculate throw velocity from velocity history
   */
  const calculateThrowVelocity = useCallback((): THREE.Vector3 | null => {
    const history = velocityHistoryRef.current
    if (history.length < 2) return null

    // Use last few entries to calculate average velocity
    const recentHistory = history.slice(-Math.min(3, history.length))
    const velocities: THREE.Vector3[] = []

    for (let i = 1; i < recentHistory.length; i++) {
      const prev = recentHistory[i - 1]
      const curr = recentHistory[i]
      const dt = (curr.time - prev.time) / 1000 // Convert to seconds
      
      if (dt > 0) {
        const velocity = curr.position.clone().sub(prev.position).divideScalar(dt)
        velocities.push(velocity)
      }
    }

    if (velocities.length === 0) return null

    // Average the velocities
    const avgVelocity = velocities.reduce((acc, v) => acc.add(v), new THREE.Vector3())
      .divideScalar(velocities.length)

    // Check if speed is above minimum threshold
    const speed = avgVelocity.length()
    if (speed < MIN_THROW_SPEED) return null

    // Scale and clamp velocity
    avgVelocity.multiplyScalar(THROW_VELOCITY_SCALE)
    const clampedSpeed = Math.min(speed * THROW_VELOCITY_SCALE, MAX_THROW_SPEED)
    avgVelocity.normalize().multiplyScalar(clampedSpeed)

    // Add upward component for more dynamic throws
    avgVelocity.y += THROW_UPWARD_BOOST

    return avgVelocity
  }, [])

  /**
   * Handle pointer down on dice mesh
   */
  const onPointerDown = useCallback((event: ThreeEvent<PointerEvent>, rigidBody: RapierRigidBody, diceId: string) => {
    event.stopPropagation()

    currentPointerIdRef.current = event.pointerId
    rigidBodyRef.current = rigidBody
    currentDiceIdRef.current = diceId

    // Update drag store
    setDraggedDiceId(diceId)

    // Capture pointer for continuous tracking
    if (event.nativeEvent.target instanceof HTMLElement) {
      event.nativeEvent.target.setPointerCapture(event.pointerId)
      capturedElementRef.current = event.nativeEvent.target
    }

    // Get initial world position from pointer projection
    const worldPos = getPointerWorldPosition(event.nativeEvent.clientX, event.nativeEvent.clientY)
    if (!worldPos) return

    // Calculate offset from dice center to pointer projection
    const diceCenter = new THREE.Vector3()
    event.object.getWorldPosition(diceCenter)
    const offset = new THREE.Vector3().subVectors(diceCenter, worldPos)

    isDraggingRef.current = true
    setIsDragging(true)
    dragOffsetRef.current = offset
    throwVelocityRef.current = null

    // Set initial target position
    const targetPos = worldPos.add(offset)
    targetPositionRef.current = targetPos

    // Initialize velocity tracking
    velocityHistoryRef.current = [{
      position: targetPos.clone(),
      time: performance.now()
    }]

    // Wake up the rigid body
    rigidBody.wakeUp()
  }, [getPointerWorldPosition, setDraggedDiceId])

  /**
   * Handle pointer move (global listener for continuous tracking)
   */
  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!isDraggingRef.current || event.pointerId !== currentPointerIdRef.current) return

    // Project current pointer position onto drag plane
    const worldPos = getPointerWorldPosition(event.clientX, event.clientY)
    if (!worldPos) return

    // Apply the stored offset to maintain grab point
    if (dragOffsetRef.current) {
      worldPos.add(dragOffsetRef.current)
    }

    // Update target position
    targetPositionRef.current = worldPos

    // Track position for velocity calculation
    const now = performance.now()
    const history = velocityHistoryRef.current
    
    history.push({
      position: worldPos.clone(),
      time: now
    })

    // Keep only recent history
    if (history.length > VELOCITY_HISTORY_SIZE) {
      history.shift()
    }

    // Remove old entries (older than 100ms)
    const cutoffTime = now - 100
    while (history.length > 0 && history[0].time < cutoffTime) {
      history.shift()
    }
  }, [getPointerWorldPosition])

  /**
   * Check if pointer is over the trash drop zone
   */
  const isOverTrashZone = useCallback((clientX: number, clientY: number): boolean => {
    const trashZone = document.getElementById('trash-drop-zone')
    if (!trashZone) return false

    const rect = trashZone.getBoundingClientRect()
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    )
  }, [])

  /**
   * Clear drag state and release pointer capture
   */
  const endDrag = useCallback((pointerEvent?: PointerEvent) => {
    if (!isDraggingRef.current) return

    // Check if released over trash zone
    const diceId = currentDiceIdRef.current
    if (pointerEvent && diceId && isOverTrashZone(pointerEvent.clientX, pointerEvent.clientY)) {
      // Delete the dice instead of throwing
      if (onDiceDelete) {
        onDiceDelete(diceId)
      }
    } else {
      // Calculate throw velocity before clearing state
      const throwVel = calculateThrowVelocity()
      throwVelocityRef.current = throwVel

      // Apply throw velocity to rigid body
      if (throwVel && rigidBodyRef.current) {
        rigidBodyRef.current.setLinvel({
          x: throwVel.x,
          y: throwVel.y,
          z: throwVel.z
        }, true)

        // Add some random spin for realism
        const randomSpin = new THREE.Vector3(
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4
        )
        rigidBodyRef.current.setAngvel({
          x: randomSpin.x,
          y: randomSpin.y,
          z: randomSpin.z
        }, true)
      }
    }

    // Release pointer capture
    if (capturedElementRef.current && currentPointerIdRef.current !== null) {
      try {
        capturedElementRef.current.releasePointerCapture(currentPointerIdRef.current)
      } catch (error) {
        console.warn('Failed to release pointer capture', error)
      }
    }

    // Clear drag store
    setDraggedDiceId(null)

    // Clear refs
    capturedElementRef.current = null
    isDraggingRef.current = false
    targetPositionRef.current = null
    dragOffsetRef.current = null
    currentPointerIdRef.current = null
    rigidBodyRef.current = null
    currentDiceIdRef.current = null
    velocityHistoryRef.current = []

    setIsDragging(false)
  }, [calculateThrowVelocity, isOverTrashZone, onDiceDelete, setDraggedDiceId])

  /**
   * Handle pointer up (global listener)
   */
  const onPointerUp = useCallback((event: PointerEvent) => {
    if (!isDraggingRef.current || event.pointerId !== currentPointerIdRef.current) return
    endDrag(event)
  }, [endDrag])

  /**
   * Handle pointer cancel cases (system interrupts)
   */
  const onPointerCancel = useCallback((event: PointerEvent) => {
    if (!isDraggingRef.current || event.pointerId !== currentPointerIdRef.current) return
    // Don't apply throw velocity on cancel
    throwVelocityRef.current = null
    endDrag(event)
  }, [endDrag])

  /**
   * Handle lost pointer capture (e.g., DOM changes)
   */
  const onLostPointerCapture = useCallback((event: PointerEvent) => {
    if (!isDraggingRef.current || event.pointerId !== currentPointerIdRef.current) return
    endDrag(event)
  }, [endDrag])

  /**
   * Cancel drag without applying throw velocity
   */
  const cancelDrag = useCallback(() => {
    if (!isDraggingRef.current) return
    
    throwVelocityRef.current = null
    endDrag()
  }, [endDrag])

  /**
   * Get current drag state (called every frame from Dice component)
   */
  const getDragState = useCallback((): DragState => ({
    isDragging: isDraggingRef.current,
    targetPosition: targetPositionRef.current,
    throwVelocity: throwVelocityRef.current
  }), [])

  // Global pointer event listeners
  useEffect(() => {
    const canvas = gl.domElement

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerCancel)
    canvas.addEventListener('lostpointercapture', onLostPointerCapture as any)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)

    return () => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerCancel)
      canvas.removeEventListener('lostpointercapture', onLostPointerCapture as any)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [gl.domElement, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture])

  return {
    isDragging,
    onPointerDown,
    getDragState,
    cancelDrag
  }
}
