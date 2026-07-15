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
import { getRoller } from '../lib/multiplayerMessages'
import { isOverTrashZone } from '../lib/trashDropZone'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useDragStore } from '../store/useDragStore'

/**
 * Hook for handling drag interaction with multiplayer dice.
 * Sends WebSocket messages (drag_start, drag_move, drag_end) to the server.
 * Dice rendering is server-authoritative via snapshot interpolation.
 */
export function useMultiplayerDrag() {
  const { camera, gl, size } = useThree()
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const dice = useMultiplayerStore((s) => s.dice)
  const roomSettings = useMultiplayerStore((s) => s.roomSettings)
  const startDrag = useMultiplayerStore((s) => s.startDrag)
  const moveDrag = useMultiplayerStore((s) => s.moveDrag)
  const endDrag = useMultiplayerStore((s) => s.endDrag)
  const setDraggedDiceId = useDragStore((s) => s.setDraggedDiceId)
  const onDiceDelete = useDragStore((s) => s.onDiceDelete)

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
  const ndcVec = useRef(new THREE.Vector2())
  const intersectionVec = useRef(new THREE.Vector3())
  const dieCenterVec = useRef(new THREE.Vector3())
  const offsetVec = useRef(new THREE.Vector3())

  const getPointerWorldPosition = useCallback((clientX: number, clientY: number): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect()
    ndcVec.current.set(
      ((clientX - rect.left) / size.width) * 2 - 1,
      -((clientY - rect.top) / size.height) * 2 + 1
    )
    raycaster.current.setFromCamera(ndcVec.current, camera)
    const didIntersect = raycaster.current.ray.intersectPlane(dragPlane.current, intersectionVec.current)
    return didIntersect ? intersectionVec.current : null
  }, [camera, gl.domElement, size.width, size.height])

  const onPointerDown = useCallback((event: ThreeEvent<PointerEvent>, dieId: string) => {
    // Only the die's owner may drag it — unless the local player is the room's
    // delegated roller, who controls every die on the table (#73).
    const die = dice.get(dieId)
    if (!die) return
    const isRoller = getRoller(roomSettings) === localPlayerId
    if (die.ownerId !== localPlayerId && !isRoller) return

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

    // Calculate grab offset from die center (reuse pre-allocated vectors). The
    // offset preserves WHERE on the die you grabbed on X/Z (so it doesn't snap its
    // center to the cursor), but its Y is zeroed: we want the die to lift up to the
    // drag plane (DRAG_PLANE_HEIGHT) when grabbed, not stay at its resting height.
    event.object.getWorldPosition(dieCenterVec.current)
    offsetVec.current.subVectors(dieCenterVec.current, worldPos)
    offsetVec.current.y = 0
    dragOffsetRef.current = offsetVec.current.clone()

    // Apply offset to get the die-centered target position
    worldPos.add(dragOffsetRef.current)
    const pos: [number, number, number] = [worldPos.x, worldPos.y, worldPos.z]
    const grabOff: [number, number, number] = [dragOffsetRef.current.x, dragOffsetRef.current.y, dragOffsetRef.current.z]

    isDraggingRef.current = true
    dragStartTimeRef.current = performance.now()
    velocityHistoryRef.current = [{ position: pos, time: 0 }]
    lastSendTimeRef.current = dragStartTimeRef.current

    startDrag(dieId, grabOff, pos)
  }, [dice, roomSettings, localPlayerId, getPointerWorldPosition, startDrag, setDraggedDiceId])

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
  }, [getPointerWorldPosition, moveDrag])

  const endDragHandler = useCallback((pointerEvent?: PointerEvent) => {
    if (!isDraggingRef.current) return
    const dieId = currentDieIdRef.current
    if (!dieId) return

    // Released over the trash target → delete the die instead of throwing it.
    // `removeDie` fully drops the die (and its physics body) server-side, drag
    // state included, so there is no `drag_end`/throw to send first.
    const overTrash =
      pointerEvent != null && isOverTrashZone(pointerEvent.clientX, pointerEvent.clientY)
    if (overTrash && onDiceDelete) {
      onDiceDelete(dieId)
    } else {
      endDrag(dieId, velocityHistoryRef.current)
    }
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
  }, [endDrag, setDraggedDiceId, onDiceDelete])

  const onPointerUp = useCallback((event: PointerEvent) => {
    if (!isDraggingRef.current || event.pointerId !== currentPointerIdRef.current) return
    endDragHandler(event)
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
