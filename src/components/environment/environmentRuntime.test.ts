import { describe, expect, it, vi } from 'vitest'
import { Group, Texture } from 'three'
import { createEnvironmentOwner, createTextureOwner, resolveWorldLayout } from './environmentRuntime'

describe('environment runtime ownership', () => {
  it('mounts exactly one factory root and permanently retires stale frame callbacks', () => {
    const scene = new Group()
    const root = new Group()
    const update = vi.fn()
    const dispose = vi.fn()
    const owner = createEnvironmentOwner(scene, { root, update, dispose })
    expect(scene.children).toEqual([root])
    owner.update(0.2, true)
    expect(update).toHaveBeenCalledWith(0.05, true)
    owner.dispose()
    owner.dispose()
    owner.update(0.1, true)
    expect(update).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(scene.children).toEqual([])
  })

  it('disposes late texture completions without publishing them to a retired world', () => {
    const owner = createTextureOwner()
    const early = new Texture()
    const late = new Texture()
    const earlyDispose = vi.spyOn(early, 'dispose')
    const lateDispose = vi.spyOn(late, 'dispose')
    const publish = vi.fn()
    owner.accept(early, publish)
    owner.dispose()
    owner.accept(late, publish)
    owner.dispose()
    expect(publish).toHaveBeenCalledExactlyOnceWith(early)
    expect(earlyDispose).toHaveBeenCalledTimes(1)
    expect(lateDispose).toHaveBeenCalledTimes(1)
  })

  it('positions decoration from live arena bounds without scaling the world', () => {
    const layout = resolveWorldLayout(3, 8)
    expect(layout.edgeX(5.1)).toBeCloseTo(3.2)
    expect(layout.edgeX(-5.1)).toBeCloseTo(-3.2)
    expect(layout.edgeX(0)).toBe(0)
    expect(layout.edgeZ(-5.7)).toBeCloseTo(-8.5)
    expect(layout.groundSize).toBeGreaterThan(32)
  })
})
