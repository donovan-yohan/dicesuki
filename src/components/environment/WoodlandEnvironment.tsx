import { useEffect, useRef, useState, type ReactElement, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector2, type Group } from 'three'
import { useEngineConfig } from '../../config/engineConfig'
import type { EnvironmentQuality, WoodlandRecipe } from '../../lib/environmentQuality'
import { createWoodlandResources } from './woodlandGeometry'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'

interface WoodlandEnvironmentProps {
  recipe: WoodlandRecipe
  quality: EnvironmentQuality
  tRef?: MutableRefObject<number>
}

/** Visual replacement for the legacy arena; lighting and colliders stay caller-owned. */
export function WoodlandEnvironment({ recipe, quality, tRef }: WoodlandEnvironmentProps): ReactElement<{ object: Group }> | null {
  const config = useEngineConfig()
  const halfX = config?.arenaHalfX
  const halfZ = config?.arenaHalfZ
  const groundY = config?.arenaGroundY ?? -.5
  // Primitive dependencies avoid rebuilding GPU resources for a live motion/DPR
  // preference or an equivalent recipe object supplied by a theme merge.
  const { seed, grass: { base, tip }, sunlight, pollen, shading } = recipe
  const { tier, grassCount, particleCount, shaftCount } = quality
  const [root, setRoot] = useState<Group | null>(null)
  const resources = useRef<ReturnType<typeof createWoodlandResources> | null>(null)
  useEffect(() => {
    if (halfX === undefined || halfZ === undefined) { setRoot(null); return }
    const built = createWoodlandResources({
      arenaHalfX: halfX, arenaHalfZ: halfZ, groundY,
      recipe: { kind: 'woodland', seed, grass: { base, tip }, sunlight, pollen, shading },
      quality: { tier, grassCount, particleCount, shaftCount },
    })
    resources.current = built
    setRoot(built.root)
    return () => {
      if (resources.current === built) resources.current = null
      built.dispose()
    }
  }, [halfX, halfZ, groundY, seed, base, tip, sunlight, pollen, shading, tier, grassCount, particleCount, shaftCount])

  const drawingBufferSize = useState(() => new Vector2())[0]
  useFrame((state, delta) => {
    state.gl?.getDrawingBufferSize(drawingBufferSize)
    resources.current?.update(delta, quality.animate, useMultiplayerStore.getState().dice, tRef?.current ?? 1, config?.arenaGroundY ?? -0.5, state.camera, drawingBufferSize)
  })

  // No loaders or suspense: scene readiness never waits for decorative assets.
  return root ? <primitive object={root} dispose={null} /> : null
}
