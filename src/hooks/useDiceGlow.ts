/**
 * Dice Glow Effect Hook
 *
 * Applies a pulsing glow effect to a dice material.
 * Animates emissive color and intensity over time.
 */

import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { CriticalGlowEffect } from '../themes/tokens'

interface UseDiceGlowOptions {
  material: THREE.Material | null
  glowConfig: CriticalGlowEffect | null
  trigger: boolean // When to start the effect
}

export function useDiceGlow({ material, glowConfig, trigger }: UseDiceGlowOptions) {
  const startTimeRef = useRef<number | null>(null)
  const isActiveRef = useRef(false)
  const originalEmissiveRef = useRef<THREE.Color | null>(null)
  const originalEmissiveIntensityRef = useRef(0)

  // Start effect when triggered
  useEffect(() => {
    if (trigger && glowConfig && material) {
      // Store original emissive properties
      if (material instanceof THREE.MeshStandardMaterial) {
        originalEmissiveRef.current = material.emissive.clone()
        originalEmissiveIntensityRef.current = material.emissiveIntensity
      }

      startTimeRef.current = performance.now()
      isActiveRef.current = true
    }
  }, [trigger, glowConfig, material])

  // Animate glow
  useFrame(() => {
    if (!isActiveRef.current || !glowConfig || !material || startTimeRef.current === null) {
      return
    }

    if (!(material instanceof THREE.MeshStandardMaterial)) {
      return
    }

    const elapsed = performance.now() - startTimeRef.current
    const duration = glowConfig.duration
    const pulseCount = glowConfig.pulseCount ?? 1

    // Check if effect is complete
    if (elapsed >= duration) {
      // Restore original emissive
      if (originalEmissiveRef.current) {
        material.emissive.copy(originalEmissiveRef.current)
      }
      material.emissiveIntensity = originalEmissiveIntensityRef.current
      isActiveRef.current = false
      startTimeRef.current = null
      return
    }

    // Calculate pulse animation
    const progress = elapsed / duration
    const pulseFrequency = pulseCount * Math.PI * 2
    const pulse = Math.sin(progress * pulseFrequency) * 0.5 + 0.5

    // Fade out towards the end
    const fadeOut = 1 - Math.pow(progress, 2)
    const intensity = pulse * fadeOut * glowConfig.intensity

    // Apply glow
    material.emissive = new THREE.Color(glowConfig.color)
    material.emissiveIntensity = intensity
  })

  return {
    isGlowing: isActiveRef.current,
  }
}
