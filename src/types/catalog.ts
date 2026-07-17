import type { DiceMetadata } from './customDice'
import type { DiceShape } from './diceShape'
import type {
  DieAppearance,
  DieRarity,
  DieVFX,
} from './inventory'

/** Schema version for the bundled catalog snapshot envelope. */
export const COLLECTIBLE_CATALOG_CONTRACT_VERSION = 1 as const
export const COLLECTIBLE_CATALOG_ASSET_VERSION = 1 as const

export type CatalogItemKind = 'die'
export type CatalogAssetKind = 'builtin' | 'gltf'

/** Stable, versioned identity for a collectible definition. */
export interface CatalogItem {
  readonly id: string
  readonly catalogKey: string
  /** Append-only version of this catalog key's identity contract. */
  readonly contractVersion: number
  readonly itemKind: CatalogItemKind
  readonly setId: string
  readonly diceType: DiceShape
  readonly rarity: DieRarity
  readonly assetVersionId: string
}

export interface BuiltinCatalogAssetMetadata {
  readonly source: 'configured' | 'standalone'
  readonly name: string
  readonly description?: string
  readonly appearance: DieAppearance
  readonly vfx: DieVFX
}

export interface GltfCatalogAssetMetadata {
  readonly source: 'production'
  readonly name: string
  readonly description?: string
  readonly appearance: DieAppearance
  readonly vfx: DieVFX
  readonly diceMetadata: DiceMetadata
  readonly delivery?: {
    readonly thumbnailPath: string
    readonly thumbnailSha256: string
    readonly thumbnailBytes: number
    readonly modelBytes: number
    readonly embeddedTextureBytes: number
    readonly textureFormat: 'image/webp'
    readonly maxTextureDimension: number
    readonly canonicalReferenceVersion: number
  }
}

export type CatalogAssetMetadata =
  | BuiltinCatalogAssetMetadata
  | GltfCatalogAssetMetadata

interface CatalogAssetVersionBase {
  readonly id: string
  readonly catalogItemId: string
  readonly assetVersion: number
  readonly metadataSha256: string
}

export interface BuiltinCatalogAssetVersion extends CatalogAssetVersionBase {
  readonly assetKind: 'builtin'
  readonly modelPath: `builtin:${DiceShape}`
  readonly modelSha256: null
  readonly metadata: BuiltinCatalogAssetMetadata
}

export interface GltfCatalogAssetVersion extends CatalogAssetVersionBase {
  readonly assetKind: 'gltf'
  readonly modelPath: string
  readonly modelSha256: string
  readonly metadata: GltfCatalogAssetMetadata
}

/** Append-only asset revision. Existing rows are never edited in place. */
export type CatalogAssetVersion =
  | BuiltinCatalogAssetVersion
  | GltfCatalogAssetVersion

export interface CollectibleCatalog {
  readonly contractVersion: typeof COLLECTIBLE_CATALOG_CONTRACT_VERSION
  readonly items: readonly CatalogItem[]
  readonly assetVersions: readonly CatalogAssetVersion[]
}

/**
 * A client-side inventory instance may point at a catalog definition, but this
 * reference is never ownership proof. Ownership lives only in server-managed
 * entitlement rows.
 */
export interface CatalogItemRef {
  readonly itemId: string
  readonly assetVersionId: string
}

/** Read model for a server-authoritative entitlement. No client write shape. */
export interface CollectibleEntitlement {
  readonly id: string
  readonly userId: string
  readonly catalogItemId: string
  readonly grantReason: string
  readonly grantRef: string
  readonly provenance: Readonly<Record<string, unknown>>
  readonly grantedAt: string
  readonly revokedAt: string | null
}
