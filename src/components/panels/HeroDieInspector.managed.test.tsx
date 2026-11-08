import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeroDieInspector } from './HeroDieInspector'
import { useGltfDiceLoader } from '../../hooks/useGltfDiceLoader'
import { useEnvironmentTheme } from '../../hooks/useEnvironmentTheme'
import { defaultTheme } from '../../themes/tokens'
import { sunlitGladeCelTheme } from '../../themes/woodland'
import { cyberpunkCutlineTheme, monsterDungeonTheme } from '../../themes/worlds'
import { useInventoryStore } from '../../store/useInventoryStore'
import type { DiceMetadata } from '../../types/gltfDice'

vi.mock('@react-three/fiber', () => ({ Canvas: ({ children }: { children: ReactNode }) => <div>{children}</div>, useFrame: vi.fn() }))
vi.mock('@react-three/drei', () => ({ Environment: () => null }))
vi.mock('../../hooks/useGltfDiceLoader', () => ({ useGltfDiceLoader: vi.fn() }))
vi.mock('../../hooks/useEnvironmentTheme', () => ({ useEnvironmentTheme: vi.fn() }))
vi.mock('../../hooks/useDiceMaterials', () => ({ useDiceMaterials: () => [] }))

beforeEach(() => {
  useInventoryStore.getState().reset()
  vi.mocked(useEnvironmentTheme).mockReturnValue(sunlitGladeCelTheme)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('managed sculpture hero visual seam', () => {
  it.each([sunlitGladeCelTheme, cyberpunkCutlineTheme, monsterDungeonTheme])('uses resolved $id lighting with the exact selected asset and original hero scale/tilt', async environment => {
    vi.mocked(useEnvironmentTheme).mockReturnValue(environment)
    const metadata = { diceType: 'd8', setId: 'woodland-sculpted-set', scale: 1 } as DiceMetadata
    const source = new THREE.Group()
    const original = new THREE.MeshStandardMaterial({ color: '#f0d790' })
    original.name = 'runtime pale bone numeral inlay study'
    source.add(new THREE.Mesh(new THREE.BoxGeometry(), original))
    const clones = vi.spyOn(source, 'clone')
    const sourceDispose = vi.spyOn(original, 'dispose')
    vi.mocked(useGltfDiceLoader).mockReturnValue({ scene: source, metadata, animations: [] } as unknown as ReturnType<typeof useGltfDiceLoader>)
    const die = useInventoryStore.getState().addDie({
      type: 'd8', setId: 'woodland-sculpted-set', rarity: 'rare', name: 'My selected sculpted D8', source: 'gacha_standard',
      appearance: { baseColor: '#123456', accentColor: '#ffffff', material: 'plastic' }, vfx: {}, isFavorite: false, isLocked: false,
      customAsset: { assetId: 'woodland-sculpted-set/exact-catalog-key', modelUrl: '/managed/d8.glb', metadata, storage: 'bundled' },
    })
    const { container, unmount } = render(<HeroDieInspector die={die} theme={defaultTheme} onClose={vi.fn()} onSpawn={vi.fn()} />)
    expect(useGltfDiceLoader).toHaveBeenCalledWith(expect.objectContaining({ id: 'woodland-sculpted-set/exact-catalog-key', modelUrl: '/managed/d8.glb' }), { useDraco: false })
    const owned = clones.mock.results[clones.mock.results.length - 1]?.value as THREE.Group
    expect(owned).toBeDefined()
    const material = (owned.children[0] as THREE.Mesh).material as THREE.MeshToonMaterial
    expect(material).toBeInstanceOf(THREE.MeshToonMaterial)
    expect(material.defines.MANAGED_CEL_NIGHT_RESPONSE).toBe(environment === sunlitGladeCelTheme ? undefined : '')
    expect(material.color.getHexString()).toBe('24352f')
    expect(original.color.getHexString()).toBe('f0d790')
    expect(container.querySelector('[scale]')?.getAttribute('scale')).toBe('1')
    expect(container.querySelector('[rotation]')?.getAttribute('rotation')).toBe('0.45,0.6,0.2')
    expect(screen.getByRole('button', { name: 'Add to Table' })).toBeEnabled()
    expect(screen.getByLabelText('Name')).toHaveValue('My selected sculpted D8')
    const disposed = vi.spyOn(material, 'dispose')
    unmount()
    await act(async () => { await Promise.resolve() })
    expect(disposed).toHaveBeenCalledOnce()
    expect(sourceDispose).not.toHaveBeenCalled()
  })
})
