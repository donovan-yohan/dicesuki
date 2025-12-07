/**
 * Dice Metadata Auto-Generator
 *
 * This module provides utilities to automatically generate metadata
 * for custom dice when artists don't provide their own metadata file.
 * It uses default values and standard face normal configurations.
 */

import * as THREE from 'three'
import {
  DiceMetadata,
  FaceNormal,
  DEFAULT_PHYSICS,
  DEFAULT_COLLIDERS,
} from '../types/customDice'
import {
  DiceShape,
  D4_FACE_NORMALS,
  D6_FACE_NORMALS,
  D8_FACE_NORMALS,
  D10_FACE_NORMALS,
  D12_FACE_NORMALS,
  D20_FACE_NORMALS,
} from './geometries'

/**
 * Generate default metadata for a dice type
 *
 * @param diceType - Type of dice (d4, d6, etc.)
 * @param name - Optional custom name for the dice
 * @param artist - Optional artist name
 * @param scale - Optional scale factor (default: 1.0)
 * @param density - Optional density value (default: from DEFAULT_PHYSICS, 0.3 matches standard dice)
 * @returns Complete metadata object with default values
 */
export function generateDefaultMetadata(
  diceType: DiceShape,
  name?: string,
  artist?: string,
  scale?: number,
  density?: number
): DiceMetadata {
  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

  // Get default face normals for this dice type
  const faceNormals = getDefaultFaceNormals(diceType)

  // Get default collider configuration
  const colliderConfig = DEFAULT_COLLIDERS[diceType]

  // Get physics with optional density override
  const physics = { ...DEFAULT_PHYSICS[diceType] }
  if (density !== undefined) {
    physics.density = density
  }

  return {
    version: '1.0',
    diceType,
    name: name || `Custom ${diceType.toUpperCase()}`,
    artist: artist || 'Unknown Artist',
    created: today,
    scale: scale ?? 1.0,
    faceNormals,
    physics,
    colliderType: colliderConfig.type,
    colliderArgs: { ...colliderConfig.args },
  }
}

/**
 * Get default face normals for a dice type
 * Converts the existing THREE.Vector3 normals to the metadata format
 */
function getDefaultFaceNormals(diceType: DiceShape): FaceNormal[] {
  let sourceNormals
  switch (diceType) {
    case 'd4':
      sourceNormals = D4_FACE_NORMALS
      break
    case 'd6':
      sourceNormals = D6_FACE_NORMALS
      break
    case 'd8':
      sourceNormals = D8_FACE_NORMALS
      break
    case 'd10':
      sourceNormals = D10_FACE_NORMALS
      break
    case 'd12':
      sourceNormals = D12_FACE_NORMALS
      break
    case 'd20':
      sourceNormals = D20_FACE_NORMALS
      break
    default:
      throw new Error(`Unknown dice type: ${diceType}`)
  }

  return sourceNormals.map((face) => ({
    value: face.value,
    normal: face.normal.toArray() as [number, number, number],
  }))
}

/**
 * Generate metadata JSON string (pretty-printed)
 *
 * @param metadata - Metadata object to serialize
 * @returns JSON string with proper formatting
 */
export function serializeMetadata(metadata: DiceMetadata): string {
  return JSON.stringify(metadata, null, 2)
}

/**
 * Create a downloadable Blob from metadata
 * Useful for allowing artists to download auto-generated metadata
 *
 * @param metadata - Metadata object
 * @returns Blob object containing JSON
 */
export function createMetadataBlob(metadata: DiceMetadata): Blob {
  const jsonString = serializeMetadata(metadata)
  return new Blob([jsonString], { type: 'application/json' })
}

/**
 * Download metadata as a JSON file
 *
 * @param metadata - Metadata to download
 * @param filename - Optional filename (defaults to dice name)
 */
export function downloadMetadata(metadata: DiceMetadata, filename?: string): void {
  const blob = createMetadataBlob(metadata)
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename || `${metadata.name.replace(/\s+/g, '-').toLowerCase()}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}

/**
 * Extract face normals from a THREE.js geometry
 * Attempts to automatically detect face normals from a loaded model
 *
 * @param geometry - Three.js BufferGeometry
 * @param faceCount - Expected number of faces for this dice type
 * @returns Array of detected face normals, or null if detection fails
 */
export function extractFaceNormalsFromGeometry(
  geometry: THREE.BufferGeometry,
  faceCount: number
): FaceNormal[] | null {
  // This is a simplified version - a full implementation would use more
  // sophisticated algorithms to detect major face normals

  try {
    // Ensure geometry has computed normals
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals()
    }

    // Get all unique face normals
    const normalAttribute = geometry.attributes.normal
    const uniqueNormals = new Set<string>()
    const normalVectors: THREE.Vector3[] = []

    for (let i = 0; i < normalAttribute.count; i++) {
      const normal = new THREE.Vector3(
        normalAttribute.getX(i),
        normalAttribute.getY(i),
        normalAttribute.getZ(i)
      ).normalize()

      // Round to avoid floating point duplicates
      const key = `${normal.x.toFixed(3)},${normal.y.toFixed(3)},${normal.z.toFixed(3)}`

      if (!uniqueNormals.has(key)) {
        uniqueNormals.add(key)
        normalVectors.push(normal.clone())
      }
    }

    // If we don't have the expected number of unique normals, detection failed
    if (normalVectors.length < faceCount) {
      console.warn(
        `Expected ${faceCount} face normals, found ${normalVectors.length}. Auto-detection may be inaccurate.`
      )
      return null
    }

    // Sort normals by Y component (bottom to top) to maintain consistent ordering
    normalVectors.sort((a, b) => a.y - b.y)

    // Convert to FaceNormal format
    return normalVectors.slice(0, faceCount).map((normal, index) => ({
      value: index + 1,
      normal: normal.toArray() as [number, number, number],
    }))
  } catch (error) {
    console.error('Failed to extract face normals from geometry:', error)
    return null
  }
}

/**
 * Generate metadata from a loaded GLB file
 * Attempts to auto-detect properties from the model
 *
 * @param scene - Loaded GLTF scene
 * @param diceType - Type of dice
 * @param filename - Original filename (used for naming)
 * @returns Generated metadata with auto-detected properties where possible
 */
export function generateMetadataFromScene(
  scene: THREE.Group,
  diceType: DiceShape,
  filename: string
): DiceMetadata {
  // Extract name from filename
  const name = filename.replace(/\.glb$/i, '').replace(/[-_]/g, ' ')

  // Start with default metadata
  const metadata = generateDefaultMetadata(diceType, name)

  // Try to extract geometry for face normal detection
  let geometry: THREE.BufferGeometry | null = null
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry && !geometry) {
      geometry = child.geometry
    }
  })

  // Attempt automatic face normal detection
  if (geometry) {
    const expectedFaceCount = metadata.faceNormals.length
    const detectedNormals = extractFaceNormalsFromGeometry(geometry, expectedFaceCount)

    if (detectedNormals) {
      console.log('Successfully auto-detected face normals')
      metadata.faceNormals = detectedNormals
    } else {
      console.warn('Face normal auto-detection failed, using defaults')
    }
  }

  return metadata
}

/**
 * Create a template metadata file for artists
 * This generates a well-commented JSON template that artists can fill in
 *
 * @param diceType - Type of dice
 * @returns JSON string with comments (as a JavaScript object literal)
 */
export function createMetadataTemplate(diceType: DiceShape): string {
  const template = generateDefaultMetadata(diceType)

  // Create a formatted template with explanatory comments
  // Note: This returns a JavaScript object string, not pure JSON (includes comments)
  return `{
  // Metadata schema version (always "1.0" for now)
  "version": "${template.version}",

  // Type of dice: "d4", "d6", "d8", "d10", "d12", or "d20"
  "diceType": "${template.diceType}",

  // Display name for your dice
  "name": "${template.name}",

  // Your name or studio name
  "artist": "${template.artist}",

  // Creation date (YYYY-MM-DD format)
  "created": "${template.created}",

  // Scale multiplier (1.0 = standard size)
  "scale": ${template.scale},

  // Face normals: outward-pointing vectors for each numbered face
  // The order and orientation of these vectors determines which face is which
  "faceNormals": ${JSON.stringify(template.faceNormals, null, 4)},

  // Physics properties
  "physics": {
    // Density of the dice (0.3 matches standard dice, lower = more spin/tumble)
    "density": ${template.physics.density},

    // Bounciness: 0 = no bounce, 1 = perfect bounce
    "restitution": ${template.physics.restitution},

    // Surface friction: 0 = ice-like, 1+ = very grippy
    "friction": ${template.physics.friction}
  },

  // Physics collider type: "hull", "roundCuboid", "cuboid", or "ball"
  // "hull" works for most polyhedral dice
  // "roundCuboid" is best for d6 (gives rounded edges)
  "colliderType": "${template.colliderType}",

  // Collider-specific parameters
  "colliderArgs": ${JSON.stringify(template.colliderArgs, null, 4)}
}
`
}
