/**
 * Dice Metadata Validation
 *
 * This module provides validation utilities for custom dice metadata.
 * It ensures uploaded metadata conforms to the expected schema and
 * contains valid values for all required fields.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  DiceMetadata,
  FaceNormal,
  ValidationResult,
  EXPECTED_FACE_COUNTS,
  FILE_SIZE_LIMITS,
} from '../types/customDice'
import { DiceShape } from './geometries'

/** Target size for dice (1 unit = standard dice size) */
const TARGET_DICE_SIZE = 1.0

/**
 * Validate a GLB file
 * Checks file type, size, and basic GLB header
 */
export async function validateGLBFile(file: File): Promise<ValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  // Check file extension
  if (!file.name.toLowerCase().endsWith('.glb')) {
    errors.push('File must have .glb extension')
  }

  // Check MIME type (if available)
  if (file.type && !['model/gltf-binary', 'application/octet-stream'].includes(file.type)) {
    warnings.push(`Unexpected MIME type: ${file.type}. Expected model/gltf-binary`)
  }

  // Check file size
  if (file.size === 0) {
    errors.push('File is empty')
  } else if (file.size > FILE_SIZE_LIMITS.HARD_MAX_SIZE) {
    errors.push(
      `File size (${(file.size / 1024 / 1024).toFixed(2)} MB) exceeds hard limit (${FILE_SIZE_LIMITS.HARD_MAX_SIZE / 1024 / 1024} MB)`
    )
  } else if (file.size > FILE_SIZE_LIMITS.RECOMMENDED_MAX_SIZE) {
    warnings.push(
      `File size (${(file.size / 1024 / 1024).toFixed(2)} MB) exceeds recommended limit (${FILE_SIZE_LIMITS.RECOMMENDED_MAX_SIZE / 1024 / 1024} MB). Consider optimizing the model.`
    )
  }

  // Validate GLB header
  try {
    const headerBuffer = await file.slice(0, 12).arrayBuffer()
    const headerView = new DataView(headerBuffer)

    // Check magic number (0x46546C67 = "glTF" in ASCII)
    const magic = headerView.getUint32(0, true)
    if (magic !== 0x46546c67) {
      errors.push('Invalid GLB file: magic number mismatch')
    }

    // Check version (should be 2)
    const version = headerView.getUint32(4, true)
    if (version !== 2) {
      errors.push(`Unsupported glTF version: ${version}. Only glTF 2.0 is supported.`)
    }
  } catch (error) {
    errors.push(`Failed to read GLB header: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Validate dice metadata structure and values
 */
export function validateMetadata(metadata: unknown): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Type guard: Check if metadata is an object
  if (!metadata || typeof metadata !== 'object') {
    errors.push('Metadata must be an object')
    return { isValid: false, errors, warnings }
  }

  const meta = metadata as Partial<DiceMetadata>

  // Required fields
  const requiredFields: (keyof DiceMetadata)[] = [
    'version',
    'diceType',
    'name',
    'artist',
    'created',
    'scale',
    'faceNormals',
    'physics',
    'colliderType',
    'colliderArgs',
  ]

  for (const field of requiredFields) {
    if (!(field in meta) || meta[field] === undefined || meta[field] === null) {
      errors.push(`Missing required field: ${field}`)
    }
  }

  // If missing required fields, return early
  if (errors.length > 0) {
    return { isValid: false, errors, warnings }
  }

  // Version validation
  if (typeof meta.version !== 'string' || !/^\d+\.\d+$/.test(meta.version)) {
    errors.push('version must be a string in format "X.Y" (e.g., "1.0")')
  }

  // Dice type validation
  const validDiceTypes: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']
  if (!validDiceTypes.includes(meta.diceType as DiceShape)) {
    errors.push(`diceType must be one of: ${validDiceTypes.join(', ')}`)
  }

  // Name validation
  if (typeof meta.name !== 'string' || meta.name.trim().length === 0) {
    errors.push('name must be a non-empty string')
  } else if (meta.name.length > 100) {
    errors.push('name must be 100 characters or less')
  }

  // Artist validation
  if (typeof meta.artist !== 'string' || meta.artist.trim().length === 0) {
    warnings.push('artist name is empty')
  }

  // Created date validation
  if (typeof meta.created !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(meta.created)) {
    errors.push('created must be a date string in format YYYY-MM-DD')
  }

  // Scale validation
  if (typeof meta.scale !== 'number') {
    errors.push('scale must be a number')
  } else if (meta.scale < 0.1 || meta.scale > 10) {
    errors.push('scale must be between 0.1 and 10')
  }

  // Face normals validation
  if (!Array.isArray(meta.faceNormals)) {
    errors.push('faceNormals must be an array')
  } else {
    const expectedCount = EXPECTED_FACE_COUNTS[meta.diceType as DiceShape]
    if (meta.faceNormals.length !== expectedCount) {
      errors.push(
        `faceNormals count mismatch: ${meta.diceType} requires ${expectedCount} faces, got ${meta.faceNormals.length}`
      )
    }

    // Validate each face normal
    meta.faceNormals.forEach((face, index) => {
      const faceErrors = validateFaceNormal(face, index)
      errors.push(...faceErrors)
    })
  }

  // Physics validation
  if (!meta.physics || typeof meta.physics !== 'object') {
    errors.push('physics must be an object')
  } else {
    const physicsErrors = validatePhysics(meta.physics)
    errors.push(...physicsErrors)
  }

  // Collider validation
  const validColliders = ['hull', 'roundCuboid', 'cuboid', 'ball']
  if (!validColliders.includes(meta.colliderType as string)) {
    errors.push(`colliderType must be one of: ${validColliders.join(', ')}`)
  }

  if (!meta.colliderArgs || typeof meta.colliderArgs !== 'object') {
    errors.push('colliderArgs must be an object')
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Validate a single face normal entry
 */
function validateFaceNormal(face: unknown, index: number): string[] {
  const errors: string[] = []

  if (!face || typeof face !== 'object') {
    errors.push(`faceNormals[${index}]: must be an object`)
    return errors
  }

  const faceObj = face as Partial<FaceNormal>

  // Check value field
  if (typeof faceObj.value !== 'number') {
    errors.push(`faceNormals[${index}].value: must be a number`)
  } else if (!Number.isInteger(faceObj.value) || faceObj.value < 0) {
    errors.push(`faceNormals[${index}].value: must be a non-negative integer`)
  }

  // Check normal field
  if (!Array.isArray(faceObj.normal)) {
    errors.push(`faceNormals[${index}].normal: must be an array`)
  } else {
    if (faceObj.normal.length !== 3) {
      errors.push(`faceNormals[${index}].normal: must have exactly 3 components [x, y, z]`)
    }

    for (let i = 0; i < 3; i++) {
      if (typeof faceObj.normal[i] !== 'number') {
        errors.push(`faceNormals[${index}].normal[${i}]: must be a number`)
      }
    }

    // Check if normal is approximately unit length (within tolerance)
    if (faceObj.normal.length === 3) {
      const length = Math.sqrt(
        faceObj.normal[0] ** 2 + faceObj.normal[1] ** 2 + faceObj.normal[2] ** 2
      )
      if (Math.abs(length - 1.0) > 0.1) {
        errors.push(
          `faceNormals[${index}].normal: should be normalized (unit length), got length ${length.toFixed(3)}`
        )
      }
    }
  }

  return errors
}

/**
 * Validate physics properties
 */
function validatePhysics(physics: unknown): string[] {
  const errors: string[] = []

  if (!physics || typeof physics !== 'object') {
    errors.push('physics must be an object')
    return errors
  }

  const phys = physics as Record<string, unknown>

  // Mass
  if (typeof phys.mass !== 'number') {
    errors.push('physics.mass: must be a number')
  } else if (phys.mass < 0.1 || phys.mass > 100) {
    errors.push('physics.mass: must be between 0.1 and 100')
  }

  // Restitution
  if (typeof phys.restitution !== 'number') {
    errors.push('physics.restitution: must be a number')
  } else if (phys.restitution < 0 || phys.restitution > 1) {
    errors.push('physics.restitution: must be between 0 and 1')
  }

  // Friction
  if (typeof phys.friction !== 'number') {
    errors.push('physics.friction: must be a number')
  } else if (phys.friction < 0 || phys.friction > 2) {
    errors.push('physics.friction: must be between 0 and 2')
  }

  return errors
}

/**
 * Parse and validate metadata from JSON string
 */
export function parseMetadataJSON(jsonString: string): {
  metadata: DiceMetadata | null
  validation: ValidationResult
} {
  try {
    const parsed = JSON.parse(jsonString)
    const validation = validateMetadata(parsed)

    return {
      metadata: validation.isValid ? (parsed as DiceMetadata) : null,
      validation,
    }
  } catch (error) {
    return {
      metadata: null,
      validation: {
        isValid: false,
        errors: [`Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}`],
        warnings: [],
      },
    }
  }
}

/**
 * Create a validation summary message
 */
export function formatValidationResults(result: ValidationResult): string {
  const parts: string[] = []

  if (result.isValid) {
    parts.push('✓ Validation passed')
  } else {
    parts.push('✗ Validation failed')
  }

  if (result.errors.length > 0) {
    parts.push('\nErrors:')
    result.errors.forEach((error) => {
      parts.push(`  - ${error}`)
    })
  }

  if (result.warnings.length > 0) {
    parts.push('\nWarnings:')
    result.warnings.forEach((warning) => {
      parts.push(`  - ${warning}`)
    })
  }

  return parts.join('\n')
}

/**
 * Result of scale analysis for a GLB model
 */
export interface ScaleAnalysisResult {
  /** Recommended scale factor to achieve target size */
  recommendedScale: number
  /** Original bounding box dimensions [width, height, depth] */
  originalSize: [number, number, number]
  /** Maximum dimension of the original model */
  maxDimension: number
  /** Whether analysis succeeded */
  success: boolean
  /** Error message if analysis failed */
  error?: string
}

/**
 * Analyze a GLB file to calculate recommended scale
 *
 * Loads the GLB model, calculates its bounding box, and returns
 * the scale factor needed to fit it to the target dice size.
 *
 * @param file - The GLB file to analyze
 * @param targetSize - Target size for the dice (default: 1.0)
 * @returns Scale analysis result with recommended scale factor
 */
export async function analyzeGLBScale(
  file: File,
  targetSize: number = TARGET_DICE_SIZE
): Promise<ScaleAnalysisResult> {
  return new Promise((resolve) => {
    const loader = new GLTFLoader()
    const url = URL.createObjectURL(file)

    loader.load(
      url,
      (gltf) => {
        // Clean up blob URL
        URL.revokeObjectURL(url)

        // Calculate bounding box
        const box = new THREE.Box3().setFromObject(gltf.scene)
        const size = new THREE.Vector3()
        box.getSize(size)

        const maxDimension = Math.max(size.x, size.y, size.z)

        // Handle edge case of zero-size model
        if (maxDimension === 0) {
          resolve({
            recommendedScale: 1.0,
            originalSize: [0, 0, 0],
            maxDimension: 0,
            success: false,
            error: 'Model has zero size - may be empty or corrupted',
          })
          return
        }

        const recommendedScale = targetSize / maxDimension

        resolve({
          recommendedScale,
          originalSize: [size.x, size.y, size.z],
          maxDimension,
          success: true,
        })
      },
      undefined, // onProgress (not needed)
      (error) => {
        // Clean up blob URL on error
        URL.revokeObjectURL(url)

        resolve({
          recommendedScale: 1.0,
          originalSize: [0, 0, 0],
          maxDimension: 0,
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load GLB file',
        })
      }
    )
  })
}

/**
 * Calculate the final size of a model given a scale factor
 *
 * @param originalSize - Original dimensions [width, height, depth]
 * @param scale - Scale factor to apply
 * @returns Final dimensions [width, height, depth]
 */
export function calculateFinalSize(
  originalSize: [number, number, number],
  scale: number
): [number, number, number] {
  return [
    originalSize[0] * scale,
    originalSize[1] * scale,
    originalSize[2] * scale,
  ]
}
