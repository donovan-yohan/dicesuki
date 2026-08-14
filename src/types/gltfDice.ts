/**
 * Type definitions for managed GLB dice assets
 *
 * This module defines the metadata and asset contracts shared by managed
 * catalog dice.
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
 * Physics properties for managed GLB dice
 * Controls how the dice behaves in the physics simulation
 */
export interface PhysicsProperties {
  /** Density of the dice (default: 0.3, affects mass calculation) */
  density: number
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
 * Animation loop mode
 */
export type AnimationLoopMode = 'once' | 'repeat' | 'pingpong'

/**
 * Animation configuration for managed GLB dice
 * Defines how embedded GLTF animations should be played
 */
export interface AnimationConfig {
  /** Name of the animation clip (from GLTF) */
  name: string

  /** Whether to play automatically when dice is loaded (default: true for 'always' trigger) */
  autoPlay?: boolean

  /** Loop behavior (default: 'repeat') */
  loop?: AnimationLoopMode

  /** Playback speed multiplier (0.5 = half speed, 2 = double speed, default: 1.0) */
  speed?: number

  /** Fade in duration in seconds (default: 0) */
  fadeInDuration?: number

  /** Fade out duration in seconds (default: 0) */
  fadeOutDuration?: number

  /**
   * When to trigger this animation:
   * - 'always': Play continuously (idle animation)
   * - 'rolling': Play while dice is in motion
   * - 'idle': Play when dice is at rest
   * - 'impact': Play on collision (one-shot)
   */
  triggerOn?: 'always' | 'rolling' | 'idle' | 'impact'
}

/**
 * Rarity levels for dice (matches inventory system)
 */
export type DiceRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic'

/**
 * Complete dice metadata specification
 *
 * This is the primary configuration format for managed GLB dice.
 * It is produced by the operator-controlled asset pipeline.
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

  /** Optional: Animation configurations for embedded GLTF animations */
  animations?: AnimationConfig[]

  // ============================================================================
  // Inventory/Production Fields (for shipped dice)
  // ============================================================================

  /** Rarity tier for inventory system (default: 'common') */
  rarity?: DiceRarity

  /** Flavor text/description for the dice */
  description?: string

  /** Set ID this dice belongs to (derived from folder if not specified) */
  setId?: string

  /** Immutable canonical dice geometry/UV reference used for authoring. */
  canonicalReferenceVersion?: number
}

/**
 * Set metadata for a collection of dice
 */
export interface DiceSetMetadata {
  /** Unique identifier for the set */
  id: string

  /** Display name for the set */
  name: string

  /** Artist or creator name */
  artist: string

  /** Description of the set */
  description?: string

  /** Release date (ISO 8601 format: YYYY-MM-DD) */
  releaseDate: string

  /** Tags for filtering/search */
  tags?: string[]

  /** Availability status */
  availability: 'always' | 'limited' | 'seasonal' | 'retired'

  /** End date for limited sets */
  endDate?: string
}

/**
 * Managed GLB dice asset.
 * Combines catalog metadata with its immutable model reference.
 */
export interface GltfDiceAsset {
  /** Unique identifier for this asset */
  id: string

  /** Dice configuration metadata */
  metadata: DiceMetadata

  /** URL/path to the GLB model file */
  modelUrl: string

  /** Optional: URL/path to thumbnail image */
  thumbnailUrl?: string
}
