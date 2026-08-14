/**
 * Custom Dice Loader Hook
 *
 * This hook handles loading custom dice from GLB files with metadata.
 * It integrates with Three.js GLTFLoader and React Three Fiber's useGLTF hook.
 */

import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { CustomDiceAsset, FaceNormal } from '../types/customDice'
import { DiceFace } from '../lib/geometries'

/**
 * Convert metadata face normals to DiceFace format
 * Metadata stores normals as [number, number, number]
 * DiceFace requires THREE.Vector3 objects
 */
function convertFaceNormals(metadataFaceNormals: FaceNormal[]): DiceFace[] {
  return metadataFaceNormals.map((face) => ({
    value: face.value,
    normal: new THREE.Vector3(face.normal[0], face.normal[1], face.normal[2]),
  }))
}

/**
 * Hook to load custom dice from GLB files
 *
 * @param asset - Custom dice asset with model URL and metadata
 * @returns Loaded GLTF scene, materials, and converted face normals
 *
 * @example
 * const asset: CustomDiceAsset = {
 *   id: 'custom-d6',
 *   metadata: { ... },
 *   modelUrl: '/models/custom-d6.glb'
 * }
 *
 * const { scene, faceNormals, isLoading } = useCustomDiceLoader(asset)
 */
export function useCustomDiceLoader(
  asset: CustomDiceAsset | null,
  {
    useDraco = true,
    castShadow = true,
    receiveShadow = true,
  }: {
    useDraco?: boolean
    castShadow?: boolean
    receiveShadow?: boolean
  } = {},
) {
  // Load GLB model using React Three Fiber's useGLTF hook
  // This hook handles caching and automatic disposal
  // Note: We must call useGLTF unconditionally (React hooks rule)
  // When asset is null, use a fallback data URI to satisfy hook requirements
  // Blob URLs are regenerated on app load via regenerateCustomDiceBlobUrls()
  const modelUrl = asset?.modelUrl || 'data:text/plain,'

  const gltf = useGLTF(modelUrl, useDraco)

  // Convert metadata face normals to DiceFace format
  const faceNormals = useMemo(() => {
    if (!asset?.metadata.faceNormals) {
      return undefined
    }
    return convertFaceNormals(asset.metadata.faceNormals)
  }, [asset?.metadata.faceNormals])

  // Extract the scene from the GLTF
  const scene = gltf.scene

  // Clone the scene to allow multiple instances
  // Note: Scale is applied in CustomDice component, not here
  const clonedScene = useMemo(() => {
    if (!scene) return null
    const cloned = scene.clone(true)

    // Fix materials for proper lighting
    cloned.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.castShadow = castShadow
        mesh.receiveShadow = receiveShadow

        // Ensure material receives lighting
        if (mesh.material) {
          const material = mesh.material as THREE.Material
          material.needsUpdate = true
        }
      }
    })

    return cloned
  }, [castShadow, receiveShadow, scene])

  return {
    scene: clonedScene,
    materials: gltf.materials,
    nodes: gltf.nodes,
    animations: gltf.animations || [],
    faceNormals,
    metadata: asset?.metadata,
    isLoading: !gltf.scene,
  }
}
