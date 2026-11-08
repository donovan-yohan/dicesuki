import { Color, HalfFloatType, Vector2, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import type { EnvironmentQuality } from '../../lib/environmentQuality'

export interface WorldBloomPipeline {
  resize(width: number, height: number, dpr: number, tier: EnvironmentQuality['tier']): void
  render(scene: Scene, camera: Camera, delta: number): void
  dispose(): void
}

/**
 * One HDR scene draw, luminance-threshold bloom, then the renderer's own output
 * transform. A separate selective scene would redraw/replace dice materials and
 * need masking/occlusion ownership; HDR emitters already give us the selection.
 * Only the blur chain is reduced: dice and numerals retain native resolution.
 */
export function createWorldBloomPipeline(renderer: WebGLRenderer): WorldBloomPipeline {
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType })
  target.texture.name = 'WorldBloom.scene'
  const composer = new EffectComposer(renderer, target)
  composer.setPixelRatio(1)
  const renderPass = new RenderPass(null as unknown as Scene, null as unknown as Camera)
  const bloom = new UnrealBloomPass(new Vector2(2, 2), 0.8, 0.45, 1.1)
  const output = new OutputPass()
  const clearColor = new Color()
  let disposed = false
  let tier: EnvironmentQuality['tier'] = 'low'
  let width = 0, height = 0

  // Unreal's first bright/blur target is half its input. Bound that target to
  // half the drawing buffer (quarter on low) and cap its longest side.
  const setBloomSize = bloom.setSize.bind(bloom)
  bloom.setSize = (inputWidth, inputHeight) => {
    const scale = tier === 'low' ? 0.25 : 0.5
    const cap = tier === 'high' ? 1024 : tier === 'mid' ? 768 : 512
    const ratio = Math.min(scale, cap / Math.max(inputWidth, inputHeight, 1))
    setBloomSize(Math.max(2, Math.floor(inputWidth * ratio) * 2), Math.max(2, Math.floor(inputHeight * ratio) * 2))
  }
  composer.addPass(renderPass)
  composer.addPass(bloom)
  composer.addPass(output)

  return {
    resize(cssWidth, cssHeight, dpr, nextTier) {
      if (disposed) return
      const nextWidth = Math.max(1, Math.floor(cssWidth * dpr))
      const nextHeight = Math.max(1, Math.floor(cssHeight * dpr))
      if (nextWidth === width && nextHeight === height && nextTier === tier) return
      width = nextWidth
      height = nextHeight
      tier = nextTier
      composer.setSize(width, height)
    },
    render(scene, camera, delta) {
      if (disposed) return
      renderPass.scene = scene
      renderPass.camera = camera
      const previousTarget = renderer.getRenderTarget()
      const previousFace = renderer.getActiveCubeFace()
      const previousMip = renderer.getActiveMipmapLevel()
      const previousAutoClear = renderer.autoClear
      const previousAlpha = renderer.getClearAlpha()
      const previousMapping = renderer.toneMapping
      const previousExposure = renderer.toneMappingExposure
      renderer.getClearColor(clearColor)
      try {
        // r162 skips tone mapping for HDR targets. OutputPass applies the
        // existing mapping/exposure once, with no global art-direction change.
        composer.render(delta)
      } finally {
        renderer.autoClear = previousAutoClear
        renderer.setClearColor(clearColor, previousAlpha)
        renderer.toneMapping = previousMapping
        renderer.toneMappingExposure = previousExposure
        // Rebinding restores target-owned viewport/scissor in Three's cache;
        // setViewport here would incorrectly multiply an offscreen rect by DPR.
        renderer.setRenderTarget(previousTarget, previousFace, previousMip)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      renderPass.dispose()
      // Three r162's UnrealBloomPass.dispose omits this owned material.
      bloom.materialHighPassFilter.dispose()
      bloom.dispose()
      output.dispose()
      composer.dispose()
    },
  }
}
