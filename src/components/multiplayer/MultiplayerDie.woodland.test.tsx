import { act, render } from '@testing-library/react'
import { StrictMode } from 'react'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { DiceShape } from '../../lib/geometries'
import type { DicePresentationMetadata } from '../../lib/multiplayerMessages'
import { MultiplayerDie } from './MultiplayerDie'
import { sunlitGladeCelTheme, sunlitGladeTheme } from '../../themes/woodland'

// Exercise the mounted React loader/fallback boundary without a WebGL renderer.
vi.mock('@react-three/fiber', () => ({ useFrame: vi.fn() }))
vi.mock('@react-three/drei', () => ({ useGLTF: vi.fn() }))
vi.mock('../../hooks/useDiceMaterials', () => ({ useDiceMaterials: vi.fn(() => []) }))
vi.mock('../../lib/collectibleCatalog', () => ({ getBundledGltfDiceAsset: vi.fn(() => null) }))
vi.mock('../../hooks/useGltfDiceLoader', () => ({ useGltfDiceLoader: vi.fn() }))
vi.mock('../../hooks/useEnvironmentTheme', () => ({ useEnvironmentTheme: vi.fn() }))
vi.mock('../../store/useMultiplayerStore', () => ({
  useMultiplayerStore: { getState: vi.fn() },
}))

import { useGLTF } from '@react-three/drei'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useEnvironmentTheme } from '../../hooks/useEnvironmentTheme'

const shapes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const
type MultiplayerState = ReturnType<typeof useMultiplayerStore.getState>

function die(shape: DiceShape = 'd6', presentation?: DicePresentationMetadata, tier: 'low' | 'high' = 'high', dieId = 'preview-die') {
  return <MultiplayerDie dieId={dieId} diceType={shape} color="#ffffff" presentation={presentation}
    tRef={{ current: 1 }} isOwnedByLocalPlayer renderDeviceTier={tier} />
}

describe('MultiplayerDie woodland preview integration', () => {
  let scene: THREE.Group
  let mesh: THREE.Mesh
  let clone: MockInstance<THREE.Group['clone']>

  beforeEach(() => {
    vi.stubEnv('DEV', true)
    vi.mocked(useEnvironmentTheme).mockReturnValue(sunlitGladeCelTheme)
    window.history.replaceState(null, '', '/?woodlandDice=sculpted')
    vi.mocked(useMultiplayerStore.getState).mockReturnValue({ lastJoin: { transport: 'worker' } } as MultiplayerState)
    scene = new THREE.Group()
    mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    const nested = new THREE.Group()
    nested.add(mesh)
    scene.add(nested)
    clone = vi.spyOn(scene, 'clone')
    vi.mocked(useGLTF).mockReset()
    vi.mocked(useGLTF).mockReturnValue({ scene } as ReturnType<typeof useGLTF>)
    // R3F host tags are intentionally mounted as DOM tags in this boundary test.
    vi.spyOn(console, 'error').mockImplementation((): undefined => undefined)
    vi.spyOn(console, 'warn').mockImplementation((): undefined => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    window.history.replaceState(null, '', '/')
    mesh.geometry.dispose()
    ;(mesh.material as THREE.Material).dispose()
  })

  it('adapts only the cel sculpted preview and releases its materials after StrictMode unmount', async () => {
    const original = mesh.material
    const sourceDispose = vi.spyOn(original as THREE.Material, 'dispose')
    const { unmount } = render(<StrictMode>{die()}</StrictMode>)
    // React retains the first memo result and probes a second initializer in DEV.
    const result = clone.mock.results[0].value as THREE.Group
    const replacement = (result.children[0].children[0] as THREE.Mesh).material as THREE.MeshToonMaterial
    expect(replacement).toBeInstanceOf(THREE.MeshToonMaterial)
    expect(replacement.userData.woodlandCombinedCel).toBe(true)
    expect(mesh.material).toBe(original)
    const disposed = vi.spyOn(replacement, 'dispose')
    await act(async () => { await Promise.resolve() })
    expect(disposed).not.toHaveBeenCalled()
    unmount()
    await act(async () => { await Promise.resolve() })
    expect(disposed).toHaveBeenCalledOnce()
    expect(sourceDispose).not.toHaveBeenCalled()
  })

  it('keeps sculpted source materials in the smooth environment', () => {
    vi.mocked(useEnvironmentTheme).mockReturnValue(sunlitGladeTheme)
    render(die())
    const result = clone.mock.results[0].value as THREE.Group
    expect((result.children[0].children[0] as THREE.Mesh).material).toBe(mesh.material)
  })

  it('retires cel replacements on a smooth-theme switch and creates fresh ones when returning', async () => {
    const { rerender, unmount } = render(die())
    const celScene = clone.mock.results[0].value as THREE.Group
    const celMaterial = (celScene.children[0].children[0] as THREE.Mesh).material as THREE.Material
    const disposed = vi.spyOn(celMaterial, 'dispose')
    vi.mocked(useEnvironmentTheme).mockReturnValue(sunlitGladeTheme)
    rerender(die())
    await act(async () => { await Promise.resolve() })
    expect(disposed).toHaveBeenCalledOnce()
    const smoothScene = clone.mock.results[1].value as THREE.Group
    expect((smoothScene.children[0].children[0] as THREE.Mesh).material).toBe(mesh.material)
    vi.mocked(useEnvironmentTheme).mockReturnValue(sunlitGladeCelTheme)
    rerender(die())
    const freshScene = clone.mock.results[2].value as THREE.Group
    const freshMaterial = (freshScene.children[0].children[0] as THREE.Mesh).material as THREE.Material
    expect(freshMaterial).not.toBe(celMaterial)
    expect(freshMaterial.userData.woodlandCombinedCel).toBe(true)
    unmount()
    await act(async () => { await Promise.resolve() })
  })

  it.each(shapes)('loads a cloned canonical-scale sculpted %s with an introspection marker', shape => {
    const { container } = render(die(shape, { basic: true }))
    const url = `/__experiments/woodland/sculpted/${shape}.glb`
    expect(useGLTF).toHaveBeenCalledWith(url, false)
    expect(clone).toHaveBeenCalledWith(true)
    const result = clone.mock.results[clone.mock.results.length - 1].value as THREE.Group
    expect(result).not.toBe(scene)
    expect(result.children[0].children[0]).not.toBe(mesh)
    expect(result.userData.woodlandSculptedPreview).toEqual({ shape, url })
    expect(container.querySelector('primitive')?.getAttribute('scale')).toBe('1')
    expect(scene.userData).toEqual({})
  })

  it('gives each die its own clone and applies caller shadow policy without mutating the cached GLB', () => {
    render(<>{die('d6', undefined, 'low', 'low-die')}{die('d6', undefined, 'high', 'high-die')}</>)
    expect(clone).toHaveBeenCalledTimes(2)
    const low = clone.mock.results[0].value as THREE.Group
    const high = clone.mock.results[1].value as THREE.Group
    expect(low).not.toBe(high)
    const lowMesh = low.children[0].children[0] as THREE.Mesh
    const highMesh = high.children[0].children[0] as THREE.Mesh
    expect([lowMesh.castShadow, lowMesh.receiveShadow]).toEqual([false, false])
    expect([highMesh.castShadow, highMesh.receiveShadow]).toEqual([true, true])
    expect([mesh.castShadow, mesh.receiveShadow]).toEqual([false, false])
  })

  it.each([
    ['production', (): void => { vi.stubEnv('DEV', false) }, 'd6', undefined],
    ['network room', () => vi.mocked(useMultiplayerStore.getState).mockReturnValue({ lastJoin: { transport: 'websocket' } } as MultiplayerState), 'd6', undefined],
    ['no room', () => vi.mocked(useMultiplayerStore.getState).mockReturnValue({ lastJoin: null } as MultiplayerState), 'd6', undefined],
    ['inventory die', (): undefined => undefined, 'd6', { basic: true, inventoryDieId: 'owned' }],
    ['custom die', (): undefined => undefined, 'd6', { basic: true, customAssetId: 'custom' }],
    ['percentile tens', (): undefined => undefined, 'd10tens', undefined],
    ['missing opt-in', () => window.history.replaceState(null, '', '/'), 'd6', undefined],
    ['unknown opt-in', () => window.history.replaceState(null, '', '/?woodlandDice=all'), 'd6', undefined],
  ] as const)('does not request preview assets for %s', (_label, setup, shape, presentation) => {
    setup()
    const { container } = render(die(shape, presentation))
    expect(useGLTF).not.toHaveBeenCalled()
    expect(clone).not.toHaveBeenCalled()
    expect(container.querySelector('primitive')).toBeNull()
    expect(container.querySelector('mesh')).not.toBeNull()
  })

  it.each(['low', 'high'] as const)('retains the legacy wood-D6 %s proof and its original scale', tier => {
    window.history.replaceState(null, '', '/?woodlandDice=1')
    const { container } = render(die('d6', undefined, tier))
    expect(useGLTF).toHaveBeenCalledWith(`/__experiments/woodland/variants/${tier === 'high' ? 'desktop' : 'mobile'}.glb`, false)
    expect(container.querySelector('primitive')?.getAttribute('scale')).toBe('1.1')
    expect((clone.mock.results[0].value as THREE.Group).userData.woodlandSculptedPreview).toBeUndefined()
    expect(((clone.mock.results[0].value as THREE.Group).children[0].children[0] as THREE.Mesh).material).toBe(mesh.material)
  })

  it('keeps the legacy opt-in D6-only', () => {
    window.history.replaceState(null, '', '/?woodlandDice=1')
    render(die('d20'))
    expect(useGLTF).not.toHaveBeenCalled()
  })

  it.each(['1', 'sculpted'])('keeps the procedural visual while a woodlandDice=%s GLB is pending', query => {
    window.history.replaceState(null, '', `/?woodlandDice=${query}`)
    vi.mocked(useGLTF).mockImplementation(() => { throw new Promise((): undefined => undefined) })
    const { container } = render(die('d6'))
    expect(useGLTF).toHaveBeenCalledWith(query === 'sculpted'
      ? '/__experiments/woodland/sculpted/d6.glb'
      : '/__experiments/woodland/variants/desktop.glb', false)
    expect(container.querySelector('primitive')).toBeNull()
    expect(container.querySelector('mesh')).not.toBeNull()
  })

  it('falls back after a rejected sculpted GLB and recovers for a new shape URL', () => {
    vi.mocked(useGLTF).mockImplementation(() => { throw new Error('Synthetic missing sculpted GLB') })
    const { container, rerender } = render(die('d4'))
    expect(useGLTF).toHaveBeenCalledWith('/__experiments/woodland/sculpted/d4.glb', false)
    expect(container.querySelector('primitive')).toBeNull()
    expect(container.querySelector('mesh')).not.toBeNull()
    vi.mocked(useGLTF).mockReturnValue({ scene } as ReturnType<typeof useGLTF>)
    rerender(die('d12'))
    expect(useGLTF).toHaveBeenCalledWith('/__experiments/woodland/sculpted/d12.glb', false)
    expect(container.querySelector('primitive')).not.toBeNull()
  })
})
