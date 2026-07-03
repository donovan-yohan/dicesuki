import { describe, expect, it } from 'vitest'
import {
  resolveDiceRenderLod,
  resolveLodTextureSize,
  resolveRenderDeviceTier,
  type DiceRenderContext,
} from './renderLod'

describe('renderLod', () => {
  it('assigns separate hero, tray, grid, and offscreen policies on high-tier devices', () => {
    const contexts: DiceRenderContext[] = ['hero', 'tray', 'grid', 'offscreen']
    const policies = contexts.map((context) => resolveDiceRenderLod({
      context,
      deviceTier: 'high',
      isVisible: context !== 'offscreen',
    }))

    expect(policies.map((policy) => policy.textureSize)).toEqual([1024, 512, 256, 0])
    expect(policies.map((policy) => policy.physicsMode)).toEqual(['static', 'dynamic', 'none', 'none'])
    expect(policies.map((policy) => policy.materialMode)).toEqual(['textured', 'textured', 'textured', 'hidden'])
  })

  it('caps tray and grid texture sizes on low-tier devices', () => {
    const tray = resolveDiceRenderLod({ context: 'tray', deviceTier: 'low', isVisible: true })
    const grid = resolveDiceRenderLod({ context: 'grid', deviceTier: 'low', isVisible: true })

    expect(tray.textureSize).toBe(256)
    expect(tray.animationQuality).toBe('reduced')
    expect(grid.textureSize).toBe(128)
    expect(grid.physicsMode).toBe('none')
  })

  it('keeps low-tier tray dice responsive while interacting', () => {
    const policy = resolveDiceRenderLod({
      context: 'tray',
      deviceTier: 'low',
      isVisible: true,
      isInteracting: true,
    })

    expect(policy.animationQuality).toBe('full')
    expect(policy.physicsMode).toBe('dynamic')
  })

  it('promotes focused grid dice without enabling grid physics', () => {
    const policy = resolveDiceRenderLod({
      context: 'grid',
      deviceTier: 'high',
      isVisible: true,
      isFocused: true,
    })

    expect(policy.fidelity).toBe('standard')
    expect(policy.textureSize).toBe(256)
    expect(policy.physicsMode).toBe('none')
  })

  it('keeps focused mid-tier grid dice within the mid grid texture cap', () => {
    const policy = resolveDiceRenderLod({
      context: 'grid',
      deviceTier: 'mid',
      isVisible: true,
      isFocused: true,
    })

    expect(policy.fidelity).toBe('standard')
    expect(policy.textureSize).toBe(128)
    expect(policy.physicsMode).toBe('none')
  })

  it('falls back to offscreen hidden policy when not visible', () => {
    const policy = resolveDiceRenderLod({
      context: 'tray',
      deviceTier: 'high',
      isVisible: false,
    })

    expect(policy.context).toBe('offscreen')
    expect(policy.textureSize).toBe(0)
    expect(policy.materialMode).toBe('hidden')
    expect(policy.animationQuality).toBe('none')
  })

  it('resolves render device tier from gpu and viewport hints', () => {
    expect(resolveRenderDeviceTier({ gpuTier: 3, isMobile: false })).toBe('high')
    expect(resolveRenderDeviceTier({ gpuTier: 2, isMobile: true })).toBe('mid')
    expect(resolveRenderDeviceTier({ gpuTier: 1, isMobile: true })).toBe('low')
    expect(resolveRenderDeviceTier({ viewportWidth: 640, devicePixelRatio: 3 })).toBe('mid')
    expect(resolveRenderDeviceTier({ viewportWidth: 1440 })).toBe('high')
  })

  it('prefers explicit texture size over LOD default', () => {
    const policy = resolveDiceRenderLod({ context: 'tray', deviceTier: 'high' })
    expect(resolveLodTextureSize(128, policy, 512)).toBe(128)
    expect(resolveLodTextureSize(undefined, policy, 512)).toBe(512)
  })
})
