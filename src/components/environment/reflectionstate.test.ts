import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createCyberpunkEnvironment } from './cyberpunkEnvironment'
import { resolveEnvironmentQuality } from '../../lib/environmentQuality'

const quality = resolveEnvironmentQuality({ deviceTier: 'low', compactViewport: false, coarsePointer: false, reducedMotion: false })
beforeEach(() => {
  // Canvas collaborator only: keep the reflection renderer and assertions intact.
  const context = document.createElement('canvas').getContext('2d')!
  Object.assign(context, { strokeRect: vi.fn(), arc: vi.fn(), stroke: vi.fn() })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
})
afterEach(() => vi.restoreAllMocks())

function fixture({ dpr = 1, offscreen = true, cube = false, throws = false, visible = true, autoClear = false } = {}) {
  const world = createCyberpunkEnvironment({ quality, arenaHalfX: 4, arenaHalfZ: 7, groundY: -.5, seed: 41 })
  const scene = new THREE.Scene()
  scene.add(world.root)
  scene.updateMatrixWorld(true)
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 100)
  camera.position.set(0, 8, 5)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  // Native Reflector writes this to WebGLState even for a regular camera.
  // The outer owner must still restore the caller's bound target viewport.
  Object.assign(camera, { viewport: new THREE.Vector4(9, 8, 7, 6) })
  const originalTarget = offscreen ? (cube ? new THREE.WebGLCubeRenderTarget(32) : new THREE.WebGLRenderTarget(32, 32)) : null
  if (originalTarget) {
    originalTarget.viewport.set(2, 3, 12, 13)
    originalTarget.scissor.set(3, 4, 10, 11)
    originalTarget.scissorTest = true
  }
  const globalViewport = new THREE.Vector4(1, 2, 20, 30)
  const globalScissor = new THREE.Vector4(4, 5, 18, 19)
  const currentViewport = new THREE.Vector4()
  const glViewport = new THREE.Vector4()
  const currentScissor = new THREE.Vector4()
  let scissorTest = false
  let target: THREE.WebGLRenderTarget | null = null
  let face = 0
  let mip = 0
  const failure = new Error('injected reflection render failure')
  const innerStates: { hidden: boolean; xr: boolean; shadow: boolean; layerMask: number; target: THREE.WebGLRenderTarget | null }[] = []
  // Instrumented facade follows installed WebGLRenderer's logical-vs-current
  // viewport, DPR and setRenderTarget semantics. Native WebGL is probed separately.
  const renderer = {
    autoClear,
    xr: { enabled: true },
    shadowMap: { autoUpdate: true },
    state: {
      viewport: (value: THREE.Vector4) => glViewport.copy(value),
      buffers: { depth: { setMask: vi.fn() } },
    },
    getRenderTarget: () => target,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => mip,
    getViewport: (value: THREE.Vector4) => value.copy(globalViewport),
    getCurrentViewport: (value: THREE.Vector4) => value.copy(currentViewport),
    setViewport: (value: THREE.Vector4) => {
      globalViewport.copy(value)
      currentViewport.copy(value).multiplyScalar(dpr).round()
      glViewport.copy(currentViewport)
    },
    setRenderTarget: (value: THREE.WebGLRenderTarget | null, activeFace = 0, activeMip = 0) => {
      target = value
      face = activeFace
      mip = activeMip
      currentViewport.copy(value ? value.viewport : globalViewport.clone().multiplyScalar(dpr).floor())
      currentScissor.copy(value ? value.scissor : globalScissor.clone().multiplyScalar(dpr).floor())
      scissorTest = value ? value.scissorTest : false
      glViewport.copy(currentViewport)
    },
    clear: vi.fn(),
    render: vi.fn((_scene: THREE.Scene, reflectionCamera: THREE.Camera) => {
      innerStates.push({ hidden: !world.reflectionSurface.visible, xr: renderer.xr.enabled, shadow: renderer.shadowMap.autoUpdate, layerMask: reflectionCamera.layers.mask, target })
      // An actual recursive callback must be fenced, not merely hidden.
      invoke()
      if (throws) throw failure
    }),
  }
  renderer.setRenderTarget(originalTarget, cube ? 3 : 0, offscreen ? 1 : 0)
  world.reflectionSurface.visible = visible
  function invoke() {
    const surface = world.reflectionSurface
    surface.onBeforeRender(renderer as unknown as THREE.WebGLRenderer, scene, camera, surface.geometry, surface.material as THREE.Material, null as never)
  }
  function snapshot() {
    return {
      target, face, mip,
      globalViewport: globalViewport.toArray(), currentViewport: currentViewport.toArray(), glViewport: glViewport.toArray(),
      globalScissor: globalScissor.toArray(), currentScissor: currentScissor.toArray(), scissorTest,
      autoClear: renderer.autoClear, xr: renderer.xr.enabled, shadow: renderer.shadowMap.autoUpdate, visible: world.reflectionSurface.visible,
      cameraViewport: (camera as THREE.PerspectiveCamera & { viewport: THREE.Vector4 }).viewport.toArray(),
    }
  }
  function dispose() {
    world.dispose()
    originalTarget?.dispose()
  }
  return { world, camera, renderer, invoke, snapshot, dispose, failure, innerStates }
}

function expectReflectionPass(f: ReturnType<typeof fixture>, count = 1) {
  expect(f.renderer.render).toHaveBeenCalledTimes(count)
  expect(f.innerStates).toHaveLength(count)
  for (const state of f.innerStates) {
    expect(state).toEqual({ hidden: true, xr: false, shadow: false, layerMask: 2, target: f.world.reflectionSurface.getRenderTarget() })
  }
}

describe('Cyberpunk reflection renderer state', () => {
  it.each([1, 2])('preserves a bound target viewport independently of the logical default at DPR %s', dpr => {
    const f = fixture({ dpr })
    try {
      const before = f.snapshot()
      f.invoke()
      expectReflectionPass(f)
      expect(f.snapshot().target).toBe(before.target)
      expect({ ...f.snapshot(), target: null }).toEqual({ ...before, target: null })
    } finally { f.dispose() }
  })

  it.each([1, 2])('preserves cube face, mip and target viewport at DPR %s', dpr => {
    const f = fixture({ dpr, cube: true })
    try {
      const before = f.snapshot()
      f.invoke()
      expectReflectionPass(f)
      expect(f.snapshot().target).toBe(before.target)
      expect({ ...f.snapshot(), target: null }).toEqual({ ...before, target: null })
    } finally { f.dispose() }
  })

  it.each([1, 2])('retains default-canvas logical viewport and DPR scaling at DPR %s', dpr => {
    const f = fixture({ dpr, offscreen: false, autoClear: true })
    try {
      const before = f.snapshot()
      f.invoke()
      expectReflectionPass(f)
      expect(f.renderer.clear).not.toHaveBeenCalled()
      expect(f.snapshot().target).toBe(before.target)
      expect({ ...f.snapshot(), target: null }).toEqual({ ...before, target: null })
    } finally { f.dispose() }
  })

  it.each([false, true])('restores renderer state after an inner exception with initial visibility %s', visible => {
    const f = fixture({ dpr: 2, cube: true, throws: true, visible })
    try {
      const before = f.snapshot()
      expect(f.invoke).toThrow(f.failure)
      expectReflectionPass(f)
      expect(f.renderer.clear).toHaveBeenCalledTimes(1)
      expect(f.snapshot().target).toBe(before.target)
      expect({ ...f.snapshot(), target: null }).toEqual({ ...before, target: null })
      // A thrown pass must release the reentry guard for a new explicit refresh.
      f.world.invalidateReflection()
      expect(f.invoke).toThrow(f.failure)
      expectReflectionPass(f, 2)
      expect(f.snapshot().target).toBe(before.target)
      expect({ ...f.snapshot(), target: null }).toEqual({ ...before, target: null })
    } finally { f.dispose() }
  })

  it('keeps motion-freeze, camera invalidation, rate limiting and reflection disable behavior', () => {
    const f = fixture()
    try {
      f.invoke()
      expectReflectionPass(f)
      f.invoke()
      f.world.update(.05, false)
      f.invoke()
      expectReflectionPass(f)
      expect(f.world.stats().time).toBe(0)
      f.camera.position.x += 1
      f.camera.updateMatrixWorld(true)
      f.invoke()
      expectReflectionPass(f, 2)
      f.world.update(.05, true)
      f.invoke()
      expectReflectionPass(f, 2)
      f.world.update(.05, true)
      f.invoke()
      expectReflectionPass(f, 3)
      f.world.setReflections(false)
      f.world.invalidateReflection()
      f.invoke()
      expectReflectionPass(f, 3)
      f.world.setReflections(true)
      f.invoke()
      expectReflectionPass(f, 4)
      f.world.dispose()
      f.world.invalidateReflection()
      f.invoke()
      expectReflectionPass(f, 4)
    } finally { f.dispose() }
  })
})
