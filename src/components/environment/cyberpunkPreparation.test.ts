import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DataTexture, Mesh, MeshToonMaterial, ShaderMaterial, Texture } from 'three'
import { createCyberpunkEnvironment } from './cyberpunkEnvironment'
import * as surfaces from './cyberpunkSurfaces'
import { resolveEnvironmentQuality } from '../../lib/environmentQuality'

const quality = resolveEnvironmentQuality({ deviceTier: 'high', compactViewport: false, coarsePointer: false, reducedMotion: false })
const options = { quality, arenaHalfX: 4, arenaHalfZ: 7, groundY: -.5, seed: 41 }

class ControlledWorker {
  static instances: ControlledWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor(readonly url: URL, readonly options: WorkerOptions) { ControlledWorker.instances.push(this) }
  complete(data: surfaces.SurfaceSet) { this.onmessage?.({ data } as MessageEvent) }
}
function pixels(size: surfaces.SurfaceSize) {
  return Object.fromEntries(surfaces.surfaceKinds.map((kind, index) => [kind, {
    albedo: new Uint8Array(size * size * 4).fill(index + 30), normal: new Uint8Array(size * size * 4).fill(127),
  }])) as surfaces.SurfaceSet
}
function litMaterials(world: ReturnType<typeof createCyberpunkEnvironment>) {
  const result = new Set<MeshToonMaterial>()
  world.root.traverse(object => {
    if (object instanceof Mesh && object.material instanceof MeshToonMaterial && !object.name.startsWith('physical-sign')) result.add(object.material)
  })
  return [...result]
}
beforeEach(() => {
  vi.resetModules()
  ControlledWorker.instances = []
  vi.stubGlobal('Worker', ControlledWorker)
  const context = document.createElement('canvas').getContext('2d')!
  Object.assign(context, { strokeRect: vi.fn(), arc: vi.fn(), stroke: vi.fn() })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('mounts the real cold factory without evaluating any procedural surface pixels on the main thread', () => {
  const pixelGenerator = vi.spyOn(surfaces, 'surfacePixels')
  const world = createCyberpunkEnvironment(options)
  try {
    expect(pixelGenerator).not.toHaveBeenCalled()
    const lit = litMaterials(world)
    expect(lit.length).toBeGreaterThan(5)
    expect(lit.every(material => material.map === null && material.normalMap === null)).toBe(true)
    expect(lit.every(material => Math.max(...material.color.toArray()) > 0)).toBe(true)
  } finally { world.dispose() }
})

it('shares one native tier job and private cached copies without sharing owners', async () => {
  const { prepareCyberpunkSurfaces } = await import('./cyberpunkSurfacePreparation')
  expect(ControlledWorker.instances).toHaveLength(0)
  const first = prepareCyberpunkSurfaces(256), peer = prepareCyberpunkSurfaces(256)
  const high = prepareCyberpunkSurfaces(512)
  expect(ControlledWorker.instances).toHaveLength(2)
  const worker = ControlledWorker.instances[0]
  expect(worker.options).toEqual({ type: 'module' })
  expect(worker.url.pathname).toContain('cyberpunkSurfaceWorker.ts')
  expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith(256)
  const original = pixels(256)
  worker.complete(original)
  const a = await first.ready, b = await peer.ready
  expect(a.status).toBe('ready'); expect(b.status).toBe('ready')
  if (a.status !== 'ready' || b.status !== 'ready') throw new Error('Missing surface data')
  a.pixels.paving.albedo.fill(0)
  expect(b.pixels.paving.albedo[0]).toBe(30)
  expect(original.paving.albedo[0]).toBe(30)
  first.release(); peer.release()
  const fresh = prepareCyberpunkSurfaces(256), c = await fresh.ready
  expect(c.status).toBe('ready')
  if (c.status !== 'ready') throw new Error('Missing cached surface data')
  expect(c.pixels.paving.albedo[0]).toBe(30)
  expect(c.pixels.paving.albedo).not.toBe(b.pixels.paving.albedo)
  expect(ControlledWorker.instances).toHaveLength(2)
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  fresh.release(); high.release()
  expect(ControlledWorker.instances[1].terminate).toHaveBeenCalledTimes(1)
})

it('cancels only the last pending peer and permanently rejects retained callbacks on fresh return', async () => {
  const { prepareCyberpunkSurfaces } = await import('./cyberpunkSurfacePreparation')
  const first = prepareCyberpunkSurfaces(256), peer = prepareCyberpunkSurfaces(256)
  const worker = ControlledWorker.instances[0], late = worker.onmessage!
  first.release(); first.release()
  expect(await first.ready).toEqual({ status: 'cancelled' })
  expect(worker.terminate).not.toHaveBeenCalled()
  peer.release()
  expect(await peer.ready).toEqual({ status: 'cancelled' })
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(worker.onmessage).toBeNull()
  const fresh = prepareCyberpunkSurfaces(256)
  expect(ControlledWorker.instances).toHaveLength(2)
  late({ data: pixels(256) } as MessageEvent)
  const data = pixels(256); data.paving.albedo.fill(99)
  ControlledWorker.instances[1].complete(data)
  const result = await fresh.ready
  expect(result.status).toBe('ready')
  if (result.status !== 'ready') throw new Error('Missing fresh result')
  expect(result.pixels.paving.albedo[0]).toBe(99)
  fresh.release()
})

it.each(['onerror', 'onmessageerror', 'malformed', 'timeout', 'constructor', 'dispatch'] as const)('keeps %s failure retryable without a synchronous generator fallback', async mode => {
  const { prepareCyberpunkSurfaces } = await import('./cyberpunkSurfacePreparation')
  if (mode === 'constructor') vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked') } })
  if (mode === 'timeout') vi.useFakeTimers()
  if (mode === 'dispatch') vi.stubGlobal('Worker', class extends ControlledWorker { postMessage = vi.fn(() => { throw new Error('dispatch refused') }) })
  const lease = prepareCyberpunkSurfaces(256)
  const worker = ControlledWorker.instances[0]
  if (mode === 'onerror' || mode === 'onmessageerror') worker[mode]!()
  if (mode === 'malformed') worker.complete({} as surfaces.SurfaceSet)
  if (mode === 'timeout') vi.advanceTimersByTime(15000)
  expect(await lease.ready).toMatchObject({ status: 'unavailable', error: expect.any(String) })
  if (worker) expect(worker.terminate).toHaveBeenCalledTimes(1)
  lease.release()
  vi.stubGlobal('Worker', ControlledWorker)
  const fresh = prepareCyberpunkSurfaces(256)
  const replacement = ControlledWorker.instances[ControlledWorker.instances.length - 1]
  replacement.complete(pixels(256))
  expect(await fresh.ready).toMatchObject({ status: 'ready' })
  fresh.release()
})

it('publishes accepted per-factory maps once and disposes them without breaking a live peer', async () => {
  const { createCyberpunkEnvironment: create } = await import('./cyberpunkEnvironment')
  const first = create(options), peer = create(options)
  const fallback = (first.reflectionSurface.material as ShaderMaterial).uniforms.uGround.value as Texture
  const fallbackDisposal = vi.spyOn(fallback, 'dispose')
  const firstLit = litMaterials(first), peerLit = litMaterials(peer)
  try {
    ControlledWorker.instances[0].complete(pixels(512))
    expect(await first.surfacesReady).toBe('ready'); expect(await peer.surfacesReady).toBe('ready')
    expect(fallbackDisposal).toHaveBeenCalledTimes(1)
    const firstTextures = new Set(firstLit.flatMap(m => [m.map, m.normalMap]).filter((t): t is Texture => !!t))
    const peerTextures = new Set(peerLit.flatMap(m => [m.map, m.normalMap]).filter((t): t is Texture => !!t))
    expect(firstTextures.size).toBeGreaterThanOrEqual(8)
    expect([...firstTextures].every(t => t instanceof DataTexture && !peerTextures.has(t))).toBe(true)
    const disposals = [...firstTextures].map(t => vi.spyOn(t, 'dispose'))
    const peerDisposals = [...peerTextures].map(t => vi.spyOn(t, 'dispose'))
    first.dispose(); first.dispose()
    expect(disposals.every(dispose => dispose.mock.calls.length === 1)).toBe(true)
    expect(peerDisposals.every(dispose => dispose.mock.calls.length === 0)).toBe(true)
    expect(fallbackDisposal).toHaveBeenCalledTimes(1)
    const fresh = create(options)
    expect(await fresh.surfacesReady).toBe('ready')
    expect(ControlledWorker.instances).toHaveLength(1)
    fresh.dispose()
  } finally { first.dispose(); peer.dispose() }
})

it('never allocates late textures or mutates disposed materials after a queued success', async () => {
  const { createCyberpunkEnvironment: create } = await import('./cyberpunkEnvironment')
  const world = create(options), lit = litMaterials(world), before = world.stats().textures
  const dispose = vi.spyOn(Texture.prototype, 'dispose')
  const worker = ControlledWorker.instances[0], retained = worker.onmessage!
  worker.complete(pixels(512))
  world.dispose()
  retained({ data: pixels(512) } as MessageEvent)
  expect(await world.surfacesReady).toBe('cancelled')
  expect(lit.every(material => material.map === null && material.normalMap === null)).toBe(true)
  expect(world.stats()).toMatchObject({ surfaceStatus: 'cancelled', disposed: true, textures: before })
  expect(dispose).toHaveBeenCalledTimes(before)
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})

it('disposes textures created during a reentrant retirement instead of publishing them', async () => {
  const { createCyberpunkEnvironment: create } = await import('./cyberpunkEnvironment')
  const world = create(options), lit = litMaterials(world)
  const dispose = vi.spyOn(Texture.prototype, 'dispose')
  const native = Object.getOwnPropertyDescriptor(Texture.prototype, 'needsUpdate')!.set!
  let retired = false
  vi.spyOn(Texture.prototype, 'needsUpdate', 'set').mockImplementation(function(this: Texture, value: boolean) {
    native.call(this, value)
    if (!retired) { retired = true; world.dispose() }
  })
  ControlledWorker.instances[0].complete(pixels(512))
  expect(await world.surfacesReady).toBe('cancelled')
  expect(lit.every(material => material.map === null)).toBe(true)
  // Four canvas signs, one fallback and ten late albedo/normal textures.
  expect(dispose).toHaveBeenCalledTimes(15)
})

it('leaves a readable native lit fallback after worker failure and permits a fresh mounted factory retry', async () => {
  const { createCyberpunkEnvironment: create } = await import('./cyberpunkEnvironment')
  const world = create(options)
  try {
    ControlledWorker.instances[0].onerror!()
    expect(await world.surfacesReady).toBe('unavailable')
    expect(world.stats()).toMatchObject({ surfaceStatus: 'unavailable', surfaceError: expect.any(String) })
    expect(litMaterials(world).every(m => m.map === null && m.normalMap === null && m.color.getHex() > 0)).toBe(true)
    const fresh = create(options)
    ControlledWorker.instances[1].complete(pixels(512))
    expect(await fresh.surfacesReady).toBe('ready')
    fresh.dispose()
    expect(litMaterials(world).every(m => m.map === null)).toBe(true)
  } finally { world.dispose() }
})
