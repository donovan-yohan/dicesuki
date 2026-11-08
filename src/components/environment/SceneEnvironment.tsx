import { useEffect, useRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useEngineConfig } from '../../config/engineConfig'
import type { EnvironmentQuality, EnvironmentSceneRecipe } from '../../lib/environmentQuality'
import { createEnvironmentOwner } from './environmentRuntime'
import { createCyberpunkEnvironment } from './cyberpunkEnvironment'
import { createDungeonEnvironment } from './dungeonEnvironment'
import { WoodlandEnvironment } from './WoodlandEnvironment'

type WorldRecipe = Exclude<EnvironmentSceneRecipe, { kind: 'woodland' }>

/** The shared R3F renderer and clock are the only render/update owners. */
function ArchitecturalEnvironment({ recipe, quality }: { recipe: WorldRecipe; quality: EnvironmentQuality }) {
  const { scene } = useThree()
  const config = useEngineConfig()
  const owner = useRef<ReturnType<typeof createEnvironmentOwner> | null>(null)
  const halfX = config?.arenaHalfX, halfZ = config?.arenaHalfZ, groundY = config?.arenaGroundY
  const { kind, seed } = recipe
  const { tier, shadowMapSize } = quality
  useEffect(() => {
    if (halfX === undefined || halfZ === undefined || groundY === undefined) return
    const options = { quality: { tier, shadowMapSize, maxDpr: 1, grassCount: 0, particleCount: 0, shaftCount: 0, animate: true }, arenaHalfX: halfX, arenaHalfZ: halfZ, groundY, seed }
    const resources = kind === 'cyberpunk-alley' ? createCyberpunkEnvironment(options) : createDungeonEnvironment(options)
    const mounted = createEnvironmentOwner(scene, resources)
    owner.current = mounted
    return () => {
      if (owner.current === mounted) owner.current = null
      mounted.dispose()
    }
    // Motion/DPR changes do not rebuild GPU resources. Tier owns structural budgets.
  }, [scene, kind, seed, halfX, halfZ, groundY, tier, shadowMapSize])
  useFrame((_, delta) => owner.current?.update(delta, quality.animate))
  return null
}

export function SceneEnvironment({ recipe, quality, tRef }: {
  recipe: EnvironmentSceneRecipe
  quality: EnvironmentQuality
  tRef: MutableRefObject<number>
}) {
  return recipe.kind === 'woodland'
    ? <WoodlandEnvironment recipe={recipe} quality={quality} tRef={tRef} />
    : <ArchitecturalEnvironment recipe={recipe} quality={quality} />
}
