/**
 * GrassField Component
 *
 * Renders instanced grass blades for forest/nature themes.
 * Uses InstancedMesh for performance with many grass instances.
 */

import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

interface GrassFieldProps {
  density: number // Number of grass blades
  color: string // Grass color
  height: number // Height of grass blades
  floorBounds?: { width: number; height: number } // Floor dimensions
}

export function GrassField({
  density,
  color,
  height,
  floorBounds = { width: 20, height: 15 },
}: GrassFieldProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)

  // Create grass geometry (simple blade shape)
  const geometry = useMemo(() => {
    const shape = new THREE.Shape()
    const width = 0.05

    // Draw a tapered blade shape
    shape.moveTo(-width / 2, 0)
    shape.lineTo(-width / 4, height)
    shape.lineTo(width / 4, height)
    shape.lineTo(width / 2, 0)

    return new THREE.ShapeGeometry(shape)
  }, [height])

  // Create grass material
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0.0,
    })
  }, [color])

  // Position grass instances
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useMemo(() => {
    if (!meshRef.current) return

    for (let i = 0; i < density; i++) {
      // Random position on floor
      const x = (Math.random() - 0.5) * floorBounds.width * 0.8 // Keep grass within 80% of floor
      const z = (Math.random() - 0.5) * floorBounds.height * 0.8

      // Random rotation around Y axis
      const rotation = Math.random() * Math.PI * 2

      // Slight random scale variation
      const scale = 0.8 + Math.random() * 0.4

      dummy.position.set(x, 0, z)
      dummy.rotation.set(0, rotation, 0)
      dummy.scale.set(scale, scale, scale)
      dummy.updateMatrix()

      meshRef.current.setMatrixAt(i, dummy.matrix)
    }

    meshRef.current.instanceMatrix.needsUpdate = true
  }, [density, floorBounds, dummy])

  // Gentle wind animation
  useFrame(({ clock }) => {
    if (!meshRef.current) return

    const time = clock.getElapsedTime()

    for (let i = 0; i < density; i++) {
      meshRef.current.getMatrixAt(i, dummy.matrix)
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale)

      // Gentle sway
      const swayAmount = Math.sin(time * 2 + i * 0.1) * 0.03
      dummy.rotation.z = swayAmount

      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)
    }

    meshRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, density]}
      receiveShadow
    />
  )
}
