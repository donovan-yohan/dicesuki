/**
 * Type definitions for custom dice assets
 *
 * This module defines the TypeScript interfaces for the artist testing platform,
 * including dice metadata, custom assets, and physics properties.
 */

import { DiceShape } from '../lib/geometries'

/**
 * Face normal vector definition
 * Defines the outward-facing normal vector for each numbered face on the dice
 */
export interface FaceNormal {
  /** Face value (the number displayed on this face) */
  value: number
  /** Outward normal vector [x, y, z] in model space */
  normal: [number, number, number]
}

/**
 * Physics properties for custom dice
 * Controls how the dice behaves in the physics simulation
 */
export interface PhysicsProperties {
  /** Mass of the dice (default: 1.0) */
  mass: number
  /** Restitution/bounciness (0 = no bounce, 1 = perfect bounce, default: 0.3) */
  restitution: number
  /** Friction coefficient (0 = ice, 1+ = very grippy, default: 0.6) */
  friction: number
}

/**
 * Collider types supported by the physics engine
 */
export type ColliderType = 'hull' | 'roundCuboid' | 'cuboid' | 'ball'

/**
 * Collider-specific parameters
 * Different collider types require different arguments
 */
export interface ColliderArgs {
  /** For cuboid/roundCuboid: half-extents [x, y, z] */
  halfExtents?: [number, number, number]
  /** For roundCuboid: edge rounding radius */
  borderRadius?: number
  /** For ball: sphere radius */
  radius?: number
}

/**
 * Collider configuration
 * Combines collider type with its specific arguments
 */
export interface ColliderConfig {
  type: ColliderType
  args: ColliderArgs
}

/**
 * Complete dice metadata specification
 *
 * This is the primary configuration format for custom dice.
 * Can be provided as a sidecar JSON file or auto-generated.
 */
export interface DiceMetadata {
  /** Schema version for future compatibility */
  version: string

  /** Type of dice (d4, d6, d8, d10, d12, d20) */
  diceType: DiceShape

  /** Display name for the dice */
  name: string

  /** Artist or creator name */
  artist: string

  /** Creation date (ISO 8601 format: YYYY-MM-DD) */
  created: string

  /** Scale multiplier applied to the model (default: 1.0) */
  scale: number

  /** Face normal vectors for face detection */
  faceNormals: FaceNormal[]

  /** Physics simulation properties */
  physics: PhysicsProperties

  /** Physics collider type */
  colliderType: ColliderType

  /** Collider-specific arguments */
  colliderArgs: ColliderArgs

  /** Optional: Custom tags for filtering/organization */
  tags?: string[]

  /** Optional: License information */
  license?: string
}

/**
 * Custom dice asset
 * Combines metadata with the actual model file reference
 */
export interface CustomDiceAsset {
  /** Unique identifier for this asset */
  id: string

  /** Dice configuration metadata */
  metadata: DiceMetadata

  /** URL/path to the GLB model file */
  modelUrl: string

  /** Optional: URL/path to thumbnail image */
  thumbnailUrl?: string

  /** Optional: Blob URL for temporary preview (uploaded files) */
  previewBlobUrl?: string
}

/**
 * Validation result for uploaded files or metadata
 */
export interface ValidationResult {
  /** Whether the validation passed */
  isValid: boolean

  /** Error messages (if validation failed) */
  errors: string[]

  /** Warning messages (non-critical issues) */
  warnings: string[]
}

/**
 * Upload state for the artist testing panel
 */
export interface UploadState {
  /** Currently uploaded GLB file */
  file: File | null

  /** Parsed or uploaded metadata */
  metadata: DiceMetadata | null

  /** Validation result for the file */
  fileValidation: ValidationResult | null

  /** Validation result for the metadata */
  metadataValidation: ValidationResult | null

  /** Loading state */
  isLoading: boolean

  /** Current step in the upload process */
  step: 'idle' | 'uploading' | 'validating' | 'ready' | 'error'
}

/**
 * Expected face count for each dice type
 * Used for validation
 */
export const EXPECTED_FACE_COUNTS: Record<DiceShape, number> = {
  d4: 4,
  d6: 6,
  d8: 8,
  d10: 10,
  d12: 12,
  d20: 20,
}

/**
 * Default physics properties by dice type
 * Used when auto-generating metadata
 */
export const DEFAULT_PHYSICS: Record<DiceShape, PhysicsProperties> = {
  d4: { mass: 1.0, restitution: 0.3, friction: 0.6 },
  d6: { mass: 1.0, restitution: 0.3, friction: 0.6 },
  d8: { mass: 1.0, restitution: 0.3, friction: 0.6 },
  d10: { mass: 1.0, restitution: 0.3, friction: 0.6 },
  d12: { mass: 1.0, restitution: 0.3, friction: 0.6 },
  d20: { mass: 1.0, restitution: 0.3, friction: 0.6 },
}

/**
 * Default collider configurations by dice type
 */
export const DEFAULT_COLLIDERS: Record<DiceShape, ColliderConfig> = {
  d4: { type: 'hull', args: {} },
  d6: {
    type: 'roundCuboid',
    args: {
      halfExtents: [0.5, 0.5, 0.5],
      borderRadius: 0.08,
    },
  },
  d8: { type: 'hull', args: {} },
  d10: { type: 'hull', args: {} },
  d12: { type: 'hull', args: {} },
  d20: { type: 'hull', args: {} },
}

/**
 * File size limits
 */
export const FILE_SIZE_LIMITS = {
  /** Recommended maximum file size (5 MB) */
  RECOMMENDED_MAX_SIZE: 5 * 1024 * 1024,

  /** Hard limit maximum file size (10 MB) */
  HARD_MAX_SIZE: 10 * 1024 * 1024,
} as const

/**
 * Polygon count limits
 */
export const POLYGON_LIMITS = {
  /** Recommended polygon count for optimal performance */
  RECOMMENDED_MAX: 5000,

  /** Hard limit for polygon count */
  HARD_MAX: 10000,
} as const
