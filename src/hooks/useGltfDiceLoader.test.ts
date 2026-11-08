import { renderHook } from '@testing-library/react'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { useGLTF } from '@react-three/drei'
import { useGltfDiceLoader } from './useGltfDiceLoader'
import type { GltfDiceAsset } from '../types/gltfDice'

vi.mock('@react-three/drei', () => ({ useGLTF: vi.fn() }))

describe('managed GLTF cache boundary', () => {
  it('clones instance shadow flags without marking globally shared materials dirty or disposing the cache', () => {
    const source = new THREE.Group()
    const a = new THREE.MeshStandardMaterial()
    const b = new THREE.MeshStandardMaterial()
    source.add(new THREE.Mesh(new THREE.BoxGeometry(), [a, b]), new THREE.Mesh(new THREE.BoxGeometry(), a))
    const clips = Array.from({ length: 22 }, (_, index) => new THREE.AnimationClip(`clip-${index}`, 1, []))
    const versionA = a.version
    const versionB = b.version
    const disposeA = vi.spyOn(a, 'dispose')
    const geometryDispose = vi.spyOn((source.children[0] as THREE.Mesh).geometry, 'dispose')
    vi.mocked(useGLTF).mockReturnValue({ scene: source, animations: clips, materials: { a, b }, nodes: {} } as unknown as ReturnType<typeof useGLTF>)
    const asset = { id: 'monster-dungeon-set/exact', modelUrl: '/managed.glb', metadata: { scale: 1, faceNormals: [{ value: 1, normal: [0, 1, 0] }] } } as GltfDiceAsset
    const { result, unmount } = renderHook(() => useGltfDiceLoader(asset, { useDraco: false, castShadow: true, receiveShadow: true }))
    expect(a.version).toBe(versionA)
    expect(b.version).toBe(versionB)
    expect(result.current.scene).not.toBe(source)
    expect((result.current.scene!.children[0] as THREE.Mesh).castShadow).toBe(true)
    expect((source.children[0] as THREE.Mesh).castShadow).toBe(false)
    expect(result.current.animations).toBe(clips)
    expect(result.current.faceNormals?.[0].normal.toArray()).toEqual([0, 1, 0])
    unmount()
    expect(disposeA).not.toHaveBeenCalled()
    expect(geometryDispose).not.toHaveBeenCalled()
  })
})
