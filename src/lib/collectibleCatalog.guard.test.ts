import crypto from 'crypto'
import fs from 'fs'
import { describe, expect, it } from 'vitest'
import generatedCatalog from '../generated/collectibleCatalog.json'

describe('collectible catalog generated artifacts', () => {
  it('avoids locale-sensitive ordering in the committed artifact generator', () => {
    const generatorSource = fs.readFileSync('scripts/generate-collectible-catalog.js', 'utf8')

    expect(generatorSource).not.toContain('.localeCompare(')
  })

  it('are current with the configured and production source files', async () => {
    // @ts-expect-error The build-time ESM generator intentionally has no runtime declaration file.
    const { generateCatalogArtifacts } = await import('../../scripts/generate-collectible-catalog.js')
    const artifacts = generateCatalogArtifacts() as { json: string; sql: string }

    expect(fs.readFileSync('src/generated/collectibleCatalog.json', 'utf8')).toBe(artifacts.json)
    expect(fs.readFileSync('supabase/catalog/collectible_catalog_v1.sql', 'utf8')).toBe(artifacts.sql)
  })

  it('embeds the exact calibrated production metadata and source hashes', () => {
    const metadataPath = 'public/dice/devil-set/devil-d6/metadata.json'
    const modelPath = 'public/dice/devil-set/devil-d6/model.glb'
    const sourceMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>
    const asset = generatedCatalog.assetVersions.find(
      candidate => candidate.catalogItemId === 'devil-set/devil-d6@1',
    )

    expect(asset?.metadata.source).toBe('production')
    expect(asset?.metadata).toHaveProperty('diceMetadata', sourceMetadata)
    expect(asset?.modelSha256).toBe(
      crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex'),
    )
    expect(sourceMetadata).toMatchObject({
      rarity: 'rare',
      description: 'A fiery die from the Devil Collection',
      setId: 'devil-set',
    })
    expect(sourceMetadata.faceNormals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        value: 1,
        normal: [0.19944679289912032, 0.3543332366985917, 0.9136021750045012],
      }),
    ]))
  })
})
