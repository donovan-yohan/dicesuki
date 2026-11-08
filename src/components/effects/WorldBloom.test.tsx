import { useLayoutEffect } from 'react'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveEnvironmentQuality, type EnvironmentSceneRecipe } from '../../lib/environmentQuality'
import { WorldBloom } from './WorldBloom'

const host = vi.hoisted(() => ({
  create: vi.fn(), useThree: vi.fn(), frame: vi.fn(),
  state: { gl: {}, scene: {}, camera: {}, size: { width: 800, height: 600 }, viewport: { dpr: 2 } },
  liveFrames: new Set<{ callback: (state: unknown, delta: number) => void; priority: number }>(),
}))
vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: typeof host.state) => unknown) => {
    host.useThree()
    return selector(host.state)
  },
  useFrame: (callback: (state: unknown, delta: number) => void, priority: number) => {
    host.frame(priority)
    useLayoutEffect(() => {
      const entry = { callback, priority }
      host.liveFrames.add(entry)
      return () => { host.liveFrames.delete(entry) }
    }, [callback, priority])
  },
}))
vi.mock('./worldBloomPipeline', () => ({ createWorldBloomPipeline: host.create }))

const cyber: EnvironmentSceneRecipe = { kind: 'cyberpunk-alley', seed: 41, shading: 'cel' }
const quality = resolveEnvironmentQuality({ deviceTier: 'high', compactViewport: false, coarsePointer: false, reducedMotion: false })

beforeEach(() => {
  vi.clearAllMocks()
  host.state.size = { width: 800, height: 600 }
  host.state.viewport = { dpr: 2 }
  host.liveFrames.clear()
  host.create.mockImplementation(() => ({ resize: vi.fn(), render: vi.fn(), dispose: vi.fn() }))
})

describe('WorldBloom render ownership', () => {
  it('leaves classic, absent recipe, woodland and dungeon on native R3F rendering without resources or subscriptions', () => {
    const view = render(<WorldBloom environmentRecipe={undefined} environmentQuality={quality} />)
    for (const recipe of [
      { kind: 'monster-dungeon', seed: 41, shading: 'cel' },
      { kind: 'woodland', seed: 41, grass: { base: '#000', tip: '#fff' }, sunlight: '#fff', pollen: '#fff' },
    ] satisfies EnvironmentSceneRecipe[]) {
      view.rerender(<WorldBloom environmentRecipe={recipe} environmentQuality={quality} />)
    }
    expect(host.useThree).not.toHaveBeenCalled()
    expect(host.frame).not.toHaveBeenCalled()
    expect(host.create).not.toHaveBeenCalled()
  })

  it('commits one positive-priority owner and retires StrictMode resources before classic resumes', () => {
    const view = render(<WorldBloom environmentRecipe={cyber} environmentQuality={quality} />, { reactStrictMode: true })
    expect(host.create).toHaveBeenCalledTimes(2)
    const first = host.create.mock.results[0].value
    const current = host.create.mock.results[1].value
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(current.dispose).not.toHaveBeenCalled()
    expect(host.liveFrames.size).toBe(1)
    const frame = [...host.liveFrames][0]
    expect(frame.priority).toBe(1)
    frame.callback(host.state, 0.016)
    expect(first.render).not.toHaveBeenCalled()
    expect(current.render).toHaveBeenCalledWith(host.state.scene, host.state.camera, 0.016)
    expect(current.resize).toHaveBeenCalledWith(800, 600, 2, 'high')
    view.rerender(<WorldBloom environmentRecipe={undefined} environmentQuality={quality} />)
    expect(current.dispose).toHaveBeenCalledTimes(1)
    expect(host.liveFrames.size).toBe(0)
    view.unmount()
    expect(current.dispose).toHaveBeenCalledTimes(1)
  })

  it('resizes and lowers its budget without recreating the composer', () => {
    const view = render(<WorldBloom environmentRecipe={cyber} environmentQuality={quality} />)
    const pipeline = host.create.mock.results[0].value
    host.state.size = { width: 390, height: 844 }
    host.state.viewport = { dpr: 1 }
    view.rerender(<WorldBloom environmentRecipe={cyber} environmentQuality={{ ...quality, tier: 'low' }} />)
    expect(host.create).toHaveBeenCalledTimes(1)
    expect(pipeline.resize).toHaveBeenLastCalledWith(390, 844, 1, 'low')
    view.unmount()
    expect(pipeline.dispose).toHaveBeenCalledTimes(1)
  })
})
