import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import type { EnvironmentQuality, EnvironmentSceneRecipe } from '../../lib/environmentQuality'
import { createWorldBloomPipeline, type WorldBloomPipeline } from './worldBloomPipeline'

/** Non-neon worlds do not subscribe to the frame loop or allocate any GPU resources. */
export function WorldBloom({ environmentRecipe, environmentQuality }: {
  environmentRecipe: EnvironmentSceneRecipe | undefined
  environmentQuality: EnvironmentQuality
}) {
  return environmentRecipe?.kind === 'cyberpunk-alley'
    ? <CyberpunkBloom tier={environmentQuality.tier} />
    : null
}

function CyberpunkBloom({ tier }: { tier: EnvironmentQuality['tier'] }) {
  const gl = useThree(state => state.gl)
  const size = useThree(state => state.size)
  const dpr = useThree(state => state.viewport.dpr)
  const pipeline = useRef<WorldBloomPipeline | null>(null)

  // Committed ownership: StrictMode's speculative renders never allocate passes.
  useLayoutEffect(() => {
    const owned = createWorldBloomPipeline(gl)
    pipeline.current = owned
    return () => {
      pipeline.current = null
      owned.dispose()
    }
  }, [gl])

  useLayoutEffect(() => {
    pipeline.current?.resize(size.width, size.height, dpr, tier)
  }, [gl, size.width, size.height, dpr, tier])

  // Positive priority disables R3F's automatic draw only for this mounted owner.
  // All ordinary animation/interpolation callbacks have already run.
  useFrame((state, delta) => {
    pipeline.current?.render(state.scene, state.camera, delta)
  }, 1)
  return null
}
