import { Camera, Color, Scene, Texture, Vector2, Vector4, WebGLRenderTarget, type WebGLRenderer } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { createWorldBloomPipeline } from './worldBloomPipeline'

function rendererFixture() {
  let target: WebGLRenderTarget | null = null
  let face = 0, mip = 0, alpha = 0.4, scissorTest = true
  const color = new Color('#102030')
  const viewport = new Vector4(1, 2, 800, 600)
  const currentViewport = viewport.clone()
  const renderer = {
    autoClear: true, autoClearColor: true, autoClearDepth: false, autoClearStencil: true,
    toneMapping: 4, toneMappingExposure: 0.85, outputColorSpace: 'srgb',
    xr: { enabled: false },
    getSize: (out: Vector2) => out.set(800, 600), getPixelRatio: () => 2,
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget: (next: WebGLRenderTarget | null, nextFace = 0, nextMip = 0) => {
      target = next; face = nextFace; mip = nextMip
      currentViewport.copy(next?.viewport ?? viewport)
    },
    getClearColor: (out: Color) => out.copy(color), getClearAlpha: () => alpha,
    setClearColor: (next: Color, nextAlpha = 1) => { color.copy(next); alpha = nextAlpha },
    getViewport: (out: Vector4) => out.copy(viewport), getCurrentViewport: (out: Vector4) => out.copy(currentViewport),
    getScissorTest: () => scissorTest, setScissorTest: (value: boolean) => { scissorTest = value },
    clear: vi.fn(), render: vi.fn(),
  }
  return renderer as unknown as WebGLRenderer
}

afterEach(() => vi.restoreAllMocks())

describe('installed Three bloom pipeline', () => {
  it('uses HDR native passes, quality-bounded half/quarter bloom and full-resolution base', () => {
    const renderer = rendererFixture()
    const sizes = vi.spyOn(UnrealBloomPass.prototype, 'setSize')
    const passes = vi.spyOn(EffectComposer.prototype, 'addPass')
    const effect = createWorldBloomPipeline(renderer)
    effect.resize(800, 600, 2, 'high')
    expect(passes.mock.calls.map(([pass]) => pass.constructor.name)).toEqual(['RenderPass', 'UnrealBloomPass', 'OutputPass'])
    const bloom = passes.mock.calls[1][0] as UnrealBloomPass
    expect(bloom.threshold).toBeGreaterThan(1)
    expect(bloom.renderTargetBright.width).toBe(800)
    expect(bloom.renderTargetBright.height).toBe(600)
    effect.resize(800, 600, 2, 'low')
    expect(bloom.renderTargetBright.width).toBeLessThanOrEqual(400)
    expect(bloom.renderTargetBright.height).toBeLessThanOrEqual(300)
    effect.resize(10000, 8000, 2, 'high')
    expect(bloom.renderTargetBright.width).toBeLessThanOrEqual(1024)
    effect.resize(0, 0, 1, 'low')
    expect(bloom.renderTargetBright.width).toBeGreaterThanOrEqual(1)
    expect(bloom.renderTargetBright.height).toBeGreaterThanOrEqual(1)
    expect(sizes).toHaveBeenCalled()
    effect.dispose()
  })

  it.each([false, true])('restores target face/mip, clear flags/color and renderer mapping after a pass (throw=%s)', throws => {
    const renderer = rendererFixture()
    const original = new WebGLRenderTarget(64, 64)
    original.viewport.set(2, 3, 12, 13)
    renderer.setRenderTarget(original, 4, 2)
    const before = {
      target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
      viewport: renderer.getViewport(new Vector4()).toArray(), currentViewport: renderer.getCurrentViewport(new Vector4()).toArray(),
      color: renderer.getClearColor(new Color()).getHex(), alpha: renderer.getClearAlpha(),
      mapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, output: renderer.outputColorSpace,
      autoClear: renderer.autoClear, autoClearDepth: renderer.autoClearDepth, scissor: renderer.getScissorTest(),
    }
    const effect = createWorldBloomPipeline(renderer)
    const error = new Error('owned shader pass failed')
    vi.spyOn(EffectComposer.prototype, 'render').mockImplementation(() => {
      renderer.setRenderTarget(new WebGLRenderTarget<Texture>(16, 16))
      renderer.autoClear = false
      renderer.setClearColor(new Color('#ff0000'), 0)
      if (throws) throw error
    })
    if (throws) expect(() => effect.render(new Scene(), new Camera(), 0.016)).toThrow(error)
    else effect.render(new Scene(), new Camera(), 0.016)
    expect({
      target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
      viewport: renderer.getViewport(new Vector4()).toArray(), currentViewport: renderer.getCurrentViewport(new Vector4()).toArray(),
      color: renderer.getClearColor(new Color()).getHex(), alpha: renderer.getClearAlpha(),
      mapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, output: renderer.outputColorSpace,
      autoClear: renderer.autoClear, autoClearDepth: renderer.autoClearDepth, scissor: renderer.getScissorTest(),
    }).toEqual(before)
    effect.dispose()
    original.dispose()
  })

  it('disposes composer, all bloom targets/materials including r162 high-pass omission and refuses stale work', () => {
    const passes = vi.spyOn(EffectComposer.prototype, 'addPass')
    const composerDisposal = vi.spyOn(EffectComposer.prototype, 'dispose')
    const effect = createWorldBloomPipeline(rendererFixture())
    const bloom = passes.mock.calls[1][0] as UnrealBloomPass
    const targets = [bloom.renderTargetBright, ...bloom.renderTargetsHorizontal, ...bloom.renderTargetsVertical]
    const materials = [bloom.materialHighPassFilter, ...bloom.separableBlurMaterials, bloom.compositeMaterial, bloom.blendMaterial, bloom.basic]
    const targetDisposals = targets.map(target => vi.spyOn(target, 'dispose'))
    const materialDisposals = materials.map(material => vi.spyOn(material, 'dispose'))
    effect.dispose()
    effect.dispose()
    effect.resize(400, 300, 1, 'low')
    const draw = vi.spyOn(EffectComposer.prototype, 'render')
    effect.render(new Scene(), new Camera(), 0.016)
    expect(draw).not.toHaveBeenCalled()
    expect(composerDisposal).toHaveBeenCalledTimes(1)
    for (const spy of [...targetDisposals, ...materialDisposals]) expect(spy).toHaveBeenCalledTimes(1)
  })
})
