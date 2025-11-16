/**
 * Particles Component
 *
 * Renders animated particles for environmental atmosphere.
 * Supports fireflies, dust motes, and sparkles.
 */

import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Points } from '@react-three/drei'

interface ParticlesProps {
  type: 'dust' | 'sparkles' | 'fireflies' | 'none'
  count: number
  color?: string
  bounds?: { width: number; height: number; depth: number }
}

export function Particles({
  type,
  count,
  color = '#ffffff',
  bounds = { width: 20, height: 6, depth: 15 },
}: ParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null)

  // Create particle positions
  const positions = useMemo(() => {
    const positions = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      const i3 = i * 3

      // Random position within bounds
      positions[i3] = (Math.random() - 0.5) * bounds.width
      positions[i3 + 1] = Math.random() * bounds.height
      positions[i3 + 2] = (Math.random() - 0.5) * bounds.depth
    }

    return positions
  }, [count, bounds])

  // Create particle velocities for animation
  const velocities = useMemo(() => {
    const velocities = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      const i3 = i * 3

      switch (type) {
        case 'fireflies':
          // Random floating motion
          velocities[i3] = (Math.random() - 0.5) * 0.2
          velocities[i3 + 1] = Math.random() * 0.1 + 0.05 // Upward drift
          velocities[i3 + 2] = (Math.random() - 0.5) * 0.2
          break

        case 'dust':
          // Slow downward drift
          velocities[i3] = (Math.random() - 0.5) * 0.05
          velocities[i3 + 1] = -Math.random() * 0.02 // Gentle fall
          velocities[i3 + 2] = (Math.random() - 0.5) * 0.05
          break

        case 'sparkles':
          // Mostly static with slight shimmer
          velocities[i3] = 0
          velocities[i3 + 1] = 0
          velocities[i3 + 2] = 0
          break
      }
    }

    return velocities
  }, [count, type])

  // Particle size based on type
  const size = useMemo(() => {
    switch (type) {
      case 'fireflies':
        return 0.15
      case 'dust':
        return 0.05
      case 'sparkles':
        return 0.1
      default:
        return 0.1
    }
  }, [type])

  // Animate particles
  useFrame(() => {
    if (!pointsRef.current) return

    const positions = pointsRef.current.geometry.attributes.position.array as Float32Array

    for (let i = 0; i < count; i++) {
      const i3 = i * 3

      // Update positions based on velocities
      positions[i3] += velocities[i3] * 0.016 // ~60fps delta
      positions[i3 + 1] += velocities[i3 + 1] * 0.016
      positions[i3 + 2] += velocities[i3 + 2] * 0.016

      // Wrap around bounds
      if (positions[i3] > bounds.width / 2) positions[i3] = -bounds.width / 2
      if (positions[i3] < -bounds.width / 2) positions[i3] = bounds.width / 2
      if (positions[i3 + 1] > bounds.height) positions[i3 + 1] = 0
      if (positions[i3 + 1] < 0) positions[i3 + 1] = bounds.height
      if (positions[i3 + 2] > bounds.depth / 2) positions[i3 + 2] = -bounds.depth / 2
      if (positions[i3 + 2] < -bounds.depth / 2) positions[i3 + 2] = bounds.depth / 2
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true
  })

  if (type === 'none' || count === 0) {
    return null
  }

  return (
    <Points
      ref={pointsRef}
      positions={positions}
      stride={3}
    >
      <pointsMaterial
        size={size}
        color={color}
        transparent
        opacity={type === 'fireflies' ? 0.8 : 0.6}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </Points>
  )
}
