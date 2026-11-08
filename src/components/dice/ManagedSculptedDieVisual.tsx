import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import type { GltfDiceAsset } from '../../types/gltfDice'
import { createManagedSculptedVisual } from '../../lib/managedSculptedDice'
import type { CelLightingResponse } from '../../lib/woodlandCelMaterial'

const NO_ANIMATIONS: THREE.AnimationClip[] = []

/** Allocate after commit so discarded/StrictMode renders cannot strand GPU owners. */
export function ManagedSculptedDieVisual({ scene, asset, cel, animations = NO_ANIMATIONS, response = 'original' }: {
  scene: THREE.Group
  asset: GltfDiceAsset
  cel: boolean
  animations?: THREE.AnimationClip[]
  response?: CelLightingResponse
}) {
  const [visual, setVisual] = useState<ReturnType<typeof createManagedSculptedVisual> | null>(null)
  const active = useRef<ReturnType<typeof createManagedSculptedVisual> | null>(null)
  const lightingResponse = useRef(response)
  const reducedMotion = useRef(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotion.current = media.matches
    const change = (event: MediaQueryListEvent) => { reducedMotion.current = event.matches }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  useFrame((_, delta) => active.current?.update(delta, reducedMotion.current))
  useEffect(() => {
    lightingResponse.current = response
    active.current?.setLightingResponse(response)
  }, [response])
  useEffect(() => {
    const owned = createManagedSculptedVisual(scene, asset, cel, animations, lightingResponse.current)
    active.current = owned
    setVisual(owned)
    return () => {
      if (active.current === owned) active.current = null
      owned.dispose()
    }
  }, [scene, asset, cel, animations])

  return visual ? <primitive object={visual.scene} dispose={null} /> : null
}
