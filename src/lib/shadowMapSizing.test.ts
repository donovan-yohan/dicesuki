import { describe, expect, it, vi } from 'vitest'
import { DirectionalLight, WebGLRenderTarget } from 'three'
import { setDirectionalShadowMapSize } from './shadowMapSizing'

function allocatedShadow(size: number) {
  const light = new DirectionalLight()
  light.shadow.mapSize.set(size, size)
  light.shadow.map = new WebGLRenderTarget(size, size)
  light.shadow.mapPass = new WebGLRenderTarget(size, size)
  return light.shadow
}

describe('setDirectionalShadowMapSize', () => {
  it.each([[2048, 512], [512, 2048]])('releases %i targets before the next %i allocation, even if mapSize was already changed', (oldSize, nextSize) => {
    const shadow = allocatedShadow(oldSize)
    const map = vi.spyOn(shadow.map!, 'dispose')
    const pass = vi.spyOn(shadow.mapPass!, 'dispose')
    const camera = shadow.camera
    const projection = camera.projectionMatrix.clone()
    // Reproduce a reconciler changing the Vector2 without resizing the targets.
    shadow.mapSize.set(nextSize, nextSize)
    setDirectionalShadowMapSize(shadow, nextSize)
    expect(map).toHaveBeenCalledOnce()
    expect(pass).toHaveBeenCalledOnce()
    expect(shadow.map).toBeNull()
    expect(shadow.mapPass).toBeNull()
    expect(shadow.mapSize.toArray()).toEqual([nextSize, nextSize])
    expect(shadow.needsUpdate).toBe(true)
    expect(shadow.camera).toBe(camera)
    expect(camera.projectionMatrix).toEqual(projection)
    // A replay before Three allocates again must not double-dispose targets.
    setDirectionalShadowMapSize(shadow, nextSize)
    expect(map).toHaveBeenCalledOnce()
    expect(pass).toHaveBeenCalledOnce()
  })

  it('preserves matching GPU targets and their update policy', () => {
    const shadow = allocatedShadow(512)
    const map = shadow.map
    const pass = shadow.mapPass
    const disposed = vi.spyOn(map!, 'dispose')
    shadow.needsUpdate = false
    setDirectionalShadowMapSize(shadow, 512)
    expect(shadow.map).toBe(map)
    expect(shadow.mapPass).toBe(pass)
    expect(disposed).not.toHaveBeenCalled()
    expect(shadow.needsUpdate).toBe(false)
    shadow.dispose()
  })

  it('initializes an unallocated shadow without changing camera bounds', () => {
    const { shadow } = new DirectionalLight()
    shadow.camera.left = -37
    setDirectionalShadowMapSize(shadow, 2048)
    expect(shadow.mapSize.toArray()).toEqual([2048, 2048])
    expect(shadow.map).toBeNull()
    expect(shadow.mapPass).toBeNull()
    expect(shadow.needsUpdate).toBe(true)
    expect(shadow.camera.left).toBe(-37)
  })

  it('also releases a stale VSM pass when the depth target already matches', () => {
    const shadow = allocatedShadow(512)
    shadow.mapPass!.setSize(2048, 2048)
    const disposed = vi.spyOn(shadow.mapPass!, 'dispose')
    setDirectionalShadowMapSize(shadow, 512)
    expect(disposed).toHaveBeenCalledOnce()
    expect(shadow.mapPass).toBeNull()
    expect(shadow.map).toBeNull()
  })
})
