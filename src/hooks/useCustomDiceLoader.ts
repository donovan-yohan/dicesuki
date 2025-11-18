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
export function useCustomDiceLoader(asset: CustomDiceAsset | null) {
  // Load GLB model using React Three Fiber's useGLTF hook
  // This hook handles caching and automatic disposal
  // Note: We must call useGLTF unconditionally (React hooks rule)
  // When asset is null, use a fallback data URI to satisfy hook requirements
  // Blob URLs are regenerated on app load via regenerateCustomDiceBlobUrls()
  const modelUrl = asset?.modelUrl || 'data:text/plain,'

  const gltf = useGLTF(modelUrl, true)

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
  const clonedScene = useMemo(() => {
    if (!scene) return null
    const cloned = scene.clone(true)
    
    // Fix materials for proper lighting
    cloned.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.castShadow = true
        mesh.receiveShadow = true
        
        // Ensure material receives lighting
        if (mesh.material) {
          const material = mesh.material as THREE.Material
          material.needsUpdate = true
          
          // Leave materials as-is - rely on scene lighting instead
          // Just ensure they can receive updates
          if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            // Material is ready for lighting
          }
        }
      }
    })
    
    return cloned
  }, [scene])

  return {
    scene: clonedScene,
    materials: gltf.materials,
    nodes: gltf.nodes,
    faceNormals,
    metadata: asset?.metadata,
    isLoading: !gltf.scene,
  }
}

/**
 * Preload a custom dice asset
 * Useful for preloading assets before they're needed
 *
 * @param modelUrl - URL to the GLB file
 */
export function preloadCustomDice(modelUrl: string) {
  useGLTF.preload(modelUrl)
}

/**
 * Get bounding box size of a loaded scene
 * Useful for scaling custom dice to match expected size
 *
 * @param scene - Loaded GLTF scene
 * @returns Size vector representing width, height, depth
 */
export function getSceneBoundingBox(scene: THREE.Group | null): THREE.Vector3 {
  if (!scene) {
    return new THREE.Vector3(1, 1, 1)
  }

  const box = new THREE.Box3().setFromObject(scene)
  const size = new THREE.Vector3()
  box.getSize(size)

  return size
}

/**
 * Calculate scale factor to fit scene to target size
 *
 * @param scene - Loaded GLTF scene
 * @param targetSize - Desired size (default: 1 unit)
 * @returns Scale factor to apply to the scene
 */
export function calculateScaleFactor(
  scene: THREE.Group | null,
  targetSize: number = 1
): number {
  if (!scene) return 1

  const currentSize = getSceneBoundingBox(scene)
  const maxDimension = Math.max(currentSize.x, currentSize.y, currentSize.z)

  if (maxDimension === 0) return 1

  return targetSize / maxDimension
}
