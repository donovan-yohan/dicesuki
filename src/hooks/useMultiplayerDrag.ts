import { useCallback, useRef, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import {
  DRAG_PLANE_HEIGHT,
  VELOCITY_HISTORY_SIZE,
  MULTIPLAYER_DRAG_THROTTLE_MS,
} from '../config/physicsConfig'
import type { VelocityHistoryEntry } from '../lib/multiplayerMessages'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useDragStore } from '../store/useDragStore'

/**
 * Hook for handling drag interaction with multiplayer dice.
 * Mirrors useDiceInteraction but sends WebSocket messages instead of
 * manipulating a local rigid body. Client shows optimistic local position
 * while the server applies physics forces.
 */
export function useMultiplayerDrag() {
  const { camera, gl, size } = useThree()
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const dice = useMultiplayerStore((s) => s.dice)
  const startDrag = useMultiplayerStore((s) => s.startDrag)
  const moveDrag = useMultiplayerStore((s) => s.moveDrag)
  const endDrag = useMultiplayerStore((s) => s.endDrag)
  const setLocalDragPosition = useMultiplayerStore((s) => s.setLocalDragPosition)
  const setDraggedDiceId = useDragStore((s) => s.setDraggedDiceId)

  const isDraggingRef = useRef(false)
  const currentDieIdRef = useRef<string | null>(null)
  const currentPointerIdRef = useRef<number | null>(null)
  const dragOffsetRef = useRef<THREE.Vector3 | null>(null)
  const capturedElementRef = useRef<HTMLElement | null>(null)
  const velocityHistoryRef = useRef<VelocityHistoryEntry[]>([])
  const lastSendTimeRef = useRef(0)
  const dragStartTimeRef = useRef(0)

  const raycaster = useRef(new THREE.Raycaster())
  const dragPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -DRAG_PLANE_HEIGHT))

  const getPointerWorldPosition = useCallback((clientX: number, clientY: number): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect()
    const x = ((clientX - rect.left) / size.width) * 2 - 1
    const y = -((clientY - rect.top) / size.height) * 2 + 1
    raycaster.current.setFromCamera(new THREE.Vector2(x, y), camera)
    const intersection = new THREE.Vector3()
    const didIntersect = raycaster.current.ray.intersectPlane(dragPlane.current, intersection)
    return didIntersect ? intersection : null
  }, [camera, gl.domElement, size.width, size.height])

  const onPointerDown = useCallback((event: ThreeEvent<PointerEvent>, dieId: string) => {
    // Check ownership
    const die = dice.get(dieId)
    if (!die || die.ownerId !== localPlayerId) return

    event.stopPropagation()
    currentPointerIdRef.current = event.pointerId
    currentDieIdRef.current = dieId
    setDraggedDiceId(dieId)

    if (event.nativeEvent.target instanceof HTMLElement) {
      event.nativeEvent.target.setPointerCapture(event.pointerId)
      capturedElementRef.current = event.nativeEvent.target
    }

    const worldPos = getPointerWorldPosition(event.nativeEvent.clientX, event.nativeEvent.clientY)
    if (!worldPos) return

    // Calculate grab offset from die center
    const dieCenter = new THREE.Vector3()
    event.object.getWorldPosition(dieCenter)
    const offset = new THREE.Vector3().subVectors(dieCenter, worldPos)
    dragOffsetRef.current = offset

    const targetPos = worldPos.clone().add(offset)
    const pos: [number, number, number] = [targetPos.x, targetPos.y, targetPos.z]
    const grabOff: [number, number, number] = [offset.x, offset.y, offset.z]

    isDraggingRef.current = true
    dragStartTimeRef.current = performance.now()
    velocityHistoryRef.current = [{ position: pos, time: 0 }]
    lastSendTimeRef.current = dragStartTimeRef.current

    startDrag(dieId, grabOff, pos)
    setLocalDragPosition(dieId, pos)
  }, [dice, localPlayerId, getPointerWorldPosition, startDrag, setLocalDragPosition, setDraggedDiceId])

  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!isDraggingRef.current || event.pointerId !== currentPointerIdRef.current) return
    const dieId = currentDieIdRef.current
    if (!dieId) return

    const worldPos = getPointerWorldPosition(event.clientX, event.clientY)
    if (!worldPos) return

    if (dragOffsetRef.current) {
      worldPos.add(dragOffsetRef.current)
    }

    const pos: [number, number, number] = [worldPos.x, worldPos.y, worldPos.z]

    // Always update local visual position (every frame)
    setLocalDragPosition(dieId, pos)

    // Track velocity history (time relative to drag start)
    const now = performance.now()
    const relativeTime = now - dragStartTimeRef.current
    velocityHistoryRef.current.push({ position: pos, time: relativeTime })
    if (velocityHistoryRef.current.length > VELOCITY_HISTORY_SIZE) {
      velocityHistoryRef.current.shift()
    }

    // Throttle server messages
    if (now - lastSendTimeRef.current >= MULTIPLAYER_DRAG_THROTTLE_MS) {
      lastSendTimeRef.current = now
      moveDrag(dieId, pos)
    }
  }, [getPointerWorldPosition, setLocalDragPosition, moveDrag])

  const endDragHandler = useCallback(() => {
    if (!isDraggingRef.current) return
    const dieId = currentDieIdRef.current
    if (!dieId) return

    endDrag(dieId, velocityHistoryRef.current)
    setDraggedDiceId(null)

    // Release pointer capture
    if (capturedElementRef.current && currentPointerIdRef.current !== null) {
      try {
        capturedElementRef.current.releasePointerCapture(currentPointerIdRef.current)
      } catch { /* ignore */ }
    }

    // Clear refs
    isDraggingRef.current = false
    currentDieIdRef.current = null
    currentPointerIdRef.current = null
    dragOffsetRef.current = null
    capturedElementRef.current = null
    velocityHistoryRef.current = []
  }, [endDrag, setDraggedDiceId])

  const onPointerUp = useCallback((event: PointerEvent) => {
    if (!isDraggingRef.current || event.pointerId !== currentPointerIdRef.current) return
    endDragHandler()
  }, [endDragHandler])

  const onPointerCancel = useCallback((event: PointerEvent) => {
    if (!isDraggingRef.current || event.pointerId !== currentPointerIdRef.current) return
    velocityHistoryRef.current = [] // No throw on cancel
    endDragHandler()
  }, [endDragHandler])

  // Register global pointer listeners
  useEffect(() => {
    const canvas = gl.domElement
    canvas.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [gl.domElement, onPointerMove, onPointerUp, onPointerCancel])

  return {
    onPointerDown,
  }
}
