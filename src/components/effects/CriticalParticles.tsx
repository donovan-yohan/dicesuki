import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { CriticalParticleBurst } from '../../themes/tokens'

interface CriticalParticlesProps {
  config: CriticalParticleBurst
  position: THREE.Vector3 // Dice position where particles spawn
  trigger: boolean // Set to true to trigger particle burst
  onComplete?: () => void // Callback when particles finish
}

interface Particle {
  position: THREE.Vector3
  velocity: THREE.Vector3
  life: number // 0-1, decreases over time
  id: number
}

/**
 * Critical hit/failure particle burst effect
 * Spawns particles at dice position that explode outward
 */
export function CriticalParticles({ config, position, trigger, onComplete }: CriticalParticlesProps) {
  const [particles, setParticles] = useState<Particle[]>([])
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null)
  const particleIdCounter = useRef(0)
  const startTimeRef = useRef(0)

  // Spawn particles when triggered
  useEffect(() => {
    if (!trigger || !config.enabled) return

    const newParticles: Particle[] = []
    const now = performance.now()
    startTimeRef.current = now

    for (let i = 0; i < config.count; i++) {
      // Random direction (sphere)
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)

      const x = Math.sin(phi) * Math.cos(theta)
      const y = Math.sin(phi) * Math.sin(theta)
      const z = Math.cos(phi)

      const direction = new THREE.Vector3(x, y, z).normalize()
      const velocity = direction.multiplyScalar(config.speed)

      newParticles.push({
        position: position.clone(),
        velocity,
        life: 1.0,
        id: particleIdCounter.current++,
      })
    }

    setParticles(newParticles)
  }, [trigger, config, position])

  // Animate particles
  useFrame((_, delta) => {
    if (particles.length === 0) return

    const elapsed = performance.now() - startTimeRef.current
    const lifetimeProgress = elapsed / config.lifetime

    if (lifetimeProgress >= 1.0) {
      // Particles expired
      setParticles([])
      onComplete?.()
      return
    }

    // Update particle positions and life
    const updated = particles.map((particle) => {
      const newPos = particle.position.clone()
      newPos.add(particle.velocity.clone().multiplyScalar(delta))

      // Apply gravity if enabled
      if (config.gravity) {
        newPos.y -= 9.8 * delta * delta * 0.5
      }

      return {
        ...particle,
        position: newPos,
        life: 1.0 - lifetimeProgress,
      }
    })

    setParticles(updated)

    // Update instanced mesh
    if (instancedMeshRef.current) {
      const dummy = new THREE.Object3D()

      updated.forEach((particle, i) => {
        dummy.position.copy(particle.position)
        dummy.scale.setScalar(config.size * particle.life) // Shrink as life decreases
        dummy.updateMatrix()
        instancedMeshRef.current!.setMatrixAt(i, dummy.matrix)
      })

      instancedMeshRef.current.instanceMatrix.needsUpdate = true

      // Update opacity based on life
      if (instancedMeshRef.current.material instanceof THREE.MeshBasicMaterial) {
        // Individual particle opacity is handled by scale
        // Global opacity stays at 1
      }
    }
  })

  if (particles.length === 0) return null

  return (
    <instancedMesh ref={instancedMeshRef} args={[undefined, undefined, config.count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color={config.color} transparent opacity={1} />
    </instancedMesh>
  )
}
