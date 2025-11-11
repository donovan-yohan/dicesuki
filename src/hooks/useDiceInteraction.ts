import { useState, useCallback, useRef } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'

/**
 * Configuration for interaction behavior
 */
const VELOCITY_THRESHOLD = 0.1 // Minimum velocity to register as a flick (units/s) - LOWERED for sensitivity
const IMPULSE_SCALE = 5 // Scale factor for converting velocity to impulse - INCREASED for stronger flicks
const MAX_IMPULSE = 50 // Maximum impulse magnitude
const MIN_UPWARD_IMPULSE = 2 // Minimum upward component for realistic throw - LOWERED for gentler flicks
const VELOCITY_SAMPLE_WINDOW = 2 // Number of recent samples to average - REDUCED for faster response

interface PointerSample {
  position: THREE.Vector3
  timestamp: number
}

interface DiceInteraction {
  isDragging: boolean
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void
  getFlickImpulse: () => THREE.Vector3 | null
}

/**
 * Hook for handling touch/mouse interaction with dice
 *
 * Tracks pointer movement and calculates flick impulse based on drag velocity.
 * Provides pointer event handlers for integration with Three.js meshes.
 *
 * Usage:
 * ```tsx
 * const { isDragging, onPointerDown, onPointerMove, onPointerUp, getFlickImpulse } = useDiceInteraction()
 *
 * <mesh
 *   onPointerDown={onPointerDown}
 *   onPointerMove={onPointerMove}
 *   onPointerUp={onPointerUp}
 * >
 * ```
 */
export function useDiceInteraction(): DiceInteraction {
  const [isDragging, setIsDragging] = useState(false)

  // Use ref for immediate drag state (not affected by React rendering)
  const isDraggingRef = useRef(false)

  // Track pointer samples for velocity calculation
  const samplesRef = useRef<PointerSample[]>([])
  const flickImpulseRef = useRef<THREE.Vector3 | null>(null)
  const dragStartRef = useRef<{ position: THREE.Vector3; timestamp: number } | null>(null)

  /**
   * Calculate velocity from recent pointer samples
   * Uses average of recent samples to smooth out jitter
   */
  const calculateVelocity = useCallback((): THREE.Vector3 | null => {
    const samples = samplesRef.current
    console.log('📊 Calculating velocity from', samples.length, 'samples')
    if (samples.length < 2) return null

    // Use recent samples for velocity calculation
    const recentSamples = samples.slice(-Math.min(VELOCITY_SAMPLE_WINDOW, samples.length))
    if (recentSamples.length < 2) return null

    const first = recentSamples[0]
    const last = recentSamples[recentSamples.length - 1]

    const timeDelta = (last.timestamp - first.timestamp) / 1000 // Convert to seconds
    if (timeDelta === 0) return null

    const positionDelta = last.position.clone().sub(first.position)
    const velocity = positionDelta.divideScalar(timeDelta)

    console.log('📊 Calculated velocity:', velocity, 'speed:', velocity.length())
    return velocity
  }, [])

  /**
   * Generate impulse vector from drag velocity
   */
  const generateFlickImpulse = useCallback((velocity: THREE.Vector3): THREE.Vector3 | null => {
    const speed = velocity.length()

    // Ignore slow movements
    if (speed < VELOCITY_THRESHOLD) {
      return null
    }

    // Scale velocity to impulse
    const impulse = velocity.clone().multiplyScalar(IMPULSE_SCALE)

    // Add upward component for realistic throw
    // Even horizontal flicks should lift the dice slightly
    impulse.y = Math.max(impulse.y, MIN_UPWARD_IMPULSE)

    // Cap maximum impulse to prevent extreme forces
    if (impulse.length() > MAX_IMPULSE) {
      impulse.normalize().multiplyScalar(MAX_IMPULSE)
    }

    return impulse
  }, [])

  /**
   * Handle pointer down event
   * Start tracking drag
   */
  const onPointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    isDraggingRef.current = true
    setIsDragging(true)

    const sample: PointerSample = {
      position: event.point.clone(),
      timestamp: event.nativeEvent.timeStamp
    }

    samplesRef.current = [sample]
    dragStartRef.current = sample
    flickImpulseRef.current = null
  }, [])

  /**
   * Handle pointer move event
   * Track position for velocity calculation
   */
  const onPointerMove = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!isDraggingRef.current) return

    const sample: PointerSample = {
      position: event.point.clone(),
      timestamp: event.nativeEvent.timeStamp
    }

    samplesRef.current.push(sample)

    // Keep only recent samples to prevent memory growth
    if (samplesRef.current.length > VELOCITY_SAMPLE_WINDOW * 2) {
      samplesRef.current.shift()
    }
  }, [])

  /**
   * Handle pointer up event
   * Calculate final velocity and generate impulse
   */
  const onPointerUp = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!isDraggingRef.current) return

    // Add final sample
    const finalSample: PointerSample = {
      position: event.point.clone(),
      timestamp: event.nativeEvent.timeStamp
    }
    samplesRef.current.push(finalSample)

    // Calculate velocity and generate impulse
    const velocity = calculateVelocity()
    if (velocity) {
      const impulse = generateFlickImpulse(velocity)
      flickImpulseRef.current = impulse
    }

    isDraggingRef.current = false
    setIsDragging(false)
    samplesRef.current = []
    dragStartRef.current = null
  }, [calculateVelocity, generateFlickImpulse])

  /**
   * Retrieve calculated flick impulse
   * Returns null if no valid flick detected
   * Clears impulse after retrieval (one-time use)
   */
  const getFlickImpulse = useCallback((): THREE.Vector3 | null => {
    const impulse = flickImpulseRef.current
    flickImpulseRef.current = null // Clear after retrieval
    return impulse
  }, [])

  return {
    isDragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    getFlickImpulse
  }
}
