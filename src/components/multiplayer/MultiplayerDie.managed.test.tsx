import { act, render } from '@testing-library/react'
import { StrictMode } from 'react'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MultiplayerDie } from './MultiplayerDie'
import { useGltfDiceLoader } from '../../hooks/useGltfDiceLoader'
import { getBundledGltfDiceAsset } from '../../lib/collectibleCatalog'
import { useEnvironmentTheme } from '../../hooks/useEnvironmentTheme'
import { sunlitGladeCelTheme, sunlitGladeTheme } from '../../themes/woodland'
import { cyberpunkCutlineTheme, monsterDungeonTheme } from '../../themes/worlds'
import type { GltfDiceAsset } from '../../types/gltfDice'

const host = vi.hoisted(() => ({ frames: [] as Array<(state: unknown, delta: number) => void> }))
vi.mock('@react-three/fiber', () => ({ useFrame: (fn: (state: unknown, delta: number) => void) => host.frames.push(fn) }))
vi.mock('@react-three/drei', () => ({ useGLTF: vi.fn() }))
vi.mock('../../hooks/useDiceMaterials', () => ({ useDiceMaterials: () => [] }))
vi.mock('../../lib/collectibleCatalog', () => ({ getBundledGltfDiceAsset: vi.fn() }))
vi.mock('../../hooks/useGltfDiceLoader', () => ({ useGltfDiceLoader: vi.fn() }))
vi.mock('../../hooks/useEnvironmentTheme', () => ({ useEnvironmentTheme: vi.fn() }))
vi.mock('../../store/useMultiplayerStore', () => ({ useMultiplayerStore: { getState: () => ({ dice: new Map(), lastJoin: null }) } }))

function asset(set = 'woodland-sculpted-set'): GltfDiceAsset {
  return { id: `${set}/catalog-owned-d8`, modelUrl: '/managed/model.glb', metadata: { diceType: 'd8', setId: set, scale: 1 } } as GltfDiceAsset
}
function die(id = 'owned', local = true, shape: 'd8' | 'd6' = 'd8') {
  return <MultiplayerDie dieId={id} diceType={shape} color="#123456" presentation={{ inventoryDieId: id, customAssetId: 'woodland-sculpted-set/catalog-owned-d8', baseColor: '#abcdef' }} tRef={{ current: 1 }} isOwnedByLocalPlayer={local} />
}

describe('managed inventory GLB table rendering', () => {
  let scene: THREE.Group
  let original: THREE.MeshStandardMaterial
  beforeEach(() => {
    host.frames = []
    window.history.replaceState(null, '', '/')
    scene = new THREE.Group()
    original = new THREE.MeshStandardMaterial({ color: '#eacb91', roughness: 0.73 })
    original.name = 'runtime pale bone numeral inlay study'
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), original))
    vi.mocked(useEnvironmentTheme).mockReturnValue(sunlitGladeCelTheme)
    vi.mocked(getBundledGltfDiceAsset).mockReturnValue(asset())
    vi.mocked(useGltfDiceLoader).mockReturnValue({ scene, metadata: asset().metadata, animations: [] } as unknown as ReturnType<typeof useGltfDiceLoader>)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it.each([cyberpunkCutlineTheme, monsterDungeonTheme])('uses resolved $id room lighting even for another selected managed family', theme => {
    vi.mocked(useEnvironmentTheme).mockReturnValue(theme)
    const clones = vi.spyOn(scene, 'clone')
    const { rerender } = render(die())
    const owned = clones.mock.results[clones.mock.results.length - 1].value as THREE.Group
    const material = (owned.children[0] as THREE.Mesh).material as THREE.MeshToonMaterial
    expect(material.defines.MANAGED_CEL_NIGHT_RESPONSE).toBe('')
    vi.mocked(useEnvironmentTheme).mockReturnValue(sunlitGladeCelTheme)
    rerender(die())
    const restored = clones.mock.results[clones.mock.results.length - 1].value as THREE.Group
    expect(((restored.children[0] as THREE.Mesh).material as THREE.MeshToonMaterial).defines.MANAGED_CEL_NIGHT_RESPONSE).toBeUndefined()
    expect(original.userData).toEqual({})
  })

  it('renders the selected catalog sculpture through an owned cel clone without a preview query', async () => {
    const clones = vi.spyOn(scene, 'clone')
    const sourceDispose = vi.spyOn(original, 'dispose')
    const ownedDisposals = vi.spyOn(THREE.MeshToonMaterial.prototype, 'dispose')
    const { container, unmount } = render(<StrictMode>{die()}</StrictMode>)
    expect(getBundledGltfDiceAsset).toHaveBeenCalledWith('woodland-sculpted-set/catalog-owned-d8', undefined, 'd8')
    const managedScenes = clones.mock.results.map(result => result.value as THREE.Group)
    const materials = managedScenes.flatMap(root => root.children.map(child => (child as THREE.Mesh).material as THREE.Material))
    const celMaterials = [...new Set(materials.filter(material => material instanceof THREE.MeshToonMaterial))]
    expect(celMaterials.length).toBeGreaterThan(0)
    expect(celMaterials.every(material => material.userData.woodlandCombinedCel)).toBe(true)
    expect(original.color.getHexString()).toBe('eacb91')
    expect(container.querySelector('primitive')).not.toBeNull()
    unmount()
    await act(async () => { await Promise.resolve() })
    expect(celMaterials.every(material => ownedDisposals.mock.contexts.filter(owner => owner === material).length === 1)).toBe(true)
    expect(sourceDispose).not.toHaveBeenCalled()
  })

  it('does not recolor or cel-convert old personal catalog assets in a cel room', () => {
    vi.mocked(getBundledGltfDiceAsset).mockReturnValue(asset('devil-set'))
    const clones = vi.spyOn(scene, 'clone')
    render(die())
    expect(clones).not.toHaveBeenCalled()
    expect(original).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(original.color.getHexString()).toBe('eacb91')
  })

  it('preserves metadata scale and smooth materials for the same selected sculpture in a smooth room', () => {
    vi.mocked(useEnvironmentTheme).mockReturnValue(sunlitGladeTheme)
    const clones = vi.spyOn(scene, 'clone')
    const { container } = render(die())
    expect(container.querySelector('[scale]')?.getAttribute('scale')).toBe('1')
    const clone = clones.mock.results[clones.mock.results.length - 1]?.value as THREE.Group
    expect(clone).toBeDefined()
    expect((clone.children[0] as THREE.Mesh).material).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect((clone.children[0] as THREE.Mesh).material).not.toBe(original)
  })

  it('forwards the full authored animation library into the actual managed table instance', () => {
    const dungeon = { ...asset('monster-dungeon-set'), metadata: { ...asset('monster-dungeon-set').metadata, diceType: 'd6' as const } }
    const eye = new THREE.Group()
    eye.name = '1_eye'
    scene.add(eye)
    const clip = new THREE.AnimationClip('1_eyeAction', 1, [new THREE.QuaternionKeyframeTrack('1_eye.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0.70710678, 0.70710678])])
    const animations = [clip, ...Array.from({ length: 21 }, (_, index) => new THREE.AnimationClip(`authored-${index}`, 1, []))]
    vi.mocked(getBundledGltfDiceAsset).mockReturnValue(dungeon)
    vi.mocked(useGltfDiceLoader).mockReturnValue({ scene, metadata: dungeon.metadata, animations } as unknown as ReturnType<typeof useGltfDiceLoader>)
    const clones = vi.spyOn(scene, 'clone')
    render(die('dungeon-d6', true, 'd6'))
    const owned = clones.mock.results[clones.mock.results.length - 1]?.value as THREE.Group
    expect(owned.animations).toHaveLength(22)
    act(() => { host.frames.forEach(frame => frame({}, 0.05)) })
    expect(owned.getObjectByName('1_eye')!.quaternion.equals(new THREE.Quaternion())).toBe(false)
    expect(eye.quaternion.equals(new THREE.Quaternion())).toBe(true)
  })

  it('keeps pending and rejected managed loads inside the existing procedural fallback', () => {
    vi.mocked(useGltfDiceLoader).mockImplementation(() => { throw new Promise(() => undefined) })
    const pending = render(die())
    expect(pending.container.querySelector('mesh')).not.toBeNull()
    pending.unmount()
    vi.mocked(useGltfDiceLoader).mockImplementation(() => { throw new Error('Rejected managed GLB') })
    const failed = render(die('rejected', false))
    expect(failed.container.querySelectorAll('mesh')).toHaveLength(2)
    expect(failed.container.querySelector('torusgeometry')).not.toBeNull()
  })
})
