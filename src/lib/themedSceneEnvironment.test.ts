import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyThemedSceneEnvironment } from './themedSceneEnvironment'

describe('applyThemedSceneEnvironment', () => {
  it('restores fallback image-based lighting before a color-only theme takes over', () => {
    const scene = new THREE.Scene()
    const fallbackEnvironment = new THREE.Texture()
    const texturedEnvironment = new THREE.Texture()
    scene.environment = fallbackEnvironment

    const removeTexturedTheme = applyThemedSceneEnvironment(scene, '#112233', texturedEnvironment)
    expect(scene.environment).toBe(texturedEnvironment)

    removeTexturedTheme()
    expect(scene.environment).toBe(fallbackEnvironment)

    const removeColorTheme = applyThemedSceneEnvironment(scene, '#445566')
    expect(scene.environment).toBe(fallbackEnvironment)
    expect(scene.background).toBeInstanceOf(THREE.Color)

    removeColorTheme()
    expect(scene.environment).toBe(fallbackEnvironment)
  })
})
