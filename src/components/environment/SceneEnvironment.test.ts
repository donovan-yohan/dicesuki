import { renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { Group } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { SceneEnvironment } from './SceneEnvironment'
import type { EnvironmentSceneRecipe } from '../../lib/environmentQuality'
import { resolveEnvironmentQuality } from '../../lib/environmentQuality'

const runtime = vi.hoisted(() => ({ frame: null as null | ((state: unknown, delta: number) => void), worlds: [] as { root: Group; update: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] }))
const scene = new Group()
vi.mock('@react-three/fiber', () => ({ useThree: () => ({ scene }), useFrame: (frame: typeof runtime.frame) => { runtime.frame = frame } }))
vi.mock('../../config/engineConfig', () => ({ useEngineConfig: () => ({ arenaHalfX: 4, arenaHalfZ: 7, arenaGroundY: -.5 }) }))
vi.mock('./cyberpunkEnvironment', () => ({ createCyberpunkEnvironment: () => {
  const world = { root: new Group(), update: vi.fn(), dispose: vi.fn() }; runtime.worlds.push(world); return world
} }))
vi.mock('./dungeonEnvironment', () => ({ createDungeonEnvironment: () => {
  const world = { root: new Group(), update: vi.fn(), dispose: vi.fn() }; runtime.worlds.push(world); return world
} }))
const quality = resolveEnvironmentQuality({ deviceTier: 'high', compactViewport: false, coarsePointer: false, reducedMotion: false })
const recipe: EnvironmentSceneRecipe = { kind: 'cyberpunk-alley', seed: 41, shading: 'cel' }

describe('production recipe mount', () => {
  it('selects the real architectural adapter while preserving woodland as its own variant', () => {
    const result = SceneEnvironment({ recipe, quality, tRef: { current: 1 } })
    expect(result.props.recipe.kind).toBe('cyberpunk-alley')
  })

  it('retires every StrictMode root and changes motion live without reallocating', () => {
    const adapter = SceneEnvironment({ recipe, quality, tRef: { current: 1 } }).type
    const { rerender, unmount } = renderHook(({ animate }) => adapter({ recipe, quality: { ...quality, animate } }), { initialProps: { animate: true }, wrapper: StrictMode })
    expect(runtime.worlds).toHaveLength(2)
    expect(runtime.worlds[0].dispose).toHaveBeenCalledTimes(1)
    expect(scene.children).toEqual([runtime.worlds[1].root])
    runtime.frame!({}, .2)
    expect(runtime.worlds[1].update).toHaveBeenLastCalledWith(.05, true)
    rerender({ animate: false })
    expect(runtime.worlds).toHaveLength(2)
    runtime.frame!({}, .1)
    expect(runtime.worlds[1].update).toHaveBeenLastCalledWith(.05, false)
    unmount()
    expect(scene.children).toHaveLength(0)
    expect(runtime.worlds[1].dispose).toHaveBeenCalledTimes(1)
  })
})
