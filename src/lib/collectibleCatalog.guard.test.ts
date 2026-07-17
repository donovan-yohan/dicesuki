import crypto from 'crypto'
import fs from 'fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import generatedCatalog from '../generated/collectibleCatalog.json'

describe('collectible catalog generated artifacts', () => {
  it('avoids locale-sensitive ordering in the committed artifact generator', () => {
    const generatorSource = fs.readFileSync(
      path.resolve(process.cwd(), 'scripts/generate-collectible-catalog.js'),
      'utf8',
    )

    expect(generatorSource).not.toContain('.localeCompare(')
  })

  it('are current with the configured and production source files', async () => {
    // @ts-expect-error The build-time ESM generator intentionally has no runtime declaration file.
    const { generateCatalogArtifacts } = await import('../../scripts/generate-collectible-catalog.js')
    const artifacts = generateCatalogArtifacts() as { json: string; sql: string }

    expect(fs.readFileSync(
      path.resolve(process.cwd(), 'src/generated/collectibleCatalog.json'),
      'utf8',
    )).toBe(artifacts.json)
    expect(fs.readFileSync(
      path.resolve(process.cwd(), 'supabase/catalog/collectible_catalog_v1.sql'),
      'utf8',
    )).toBe(artifacts.sql)
  })

  it('embeds the exact calibrated production metadata and source hashes', () => {
    const metadataPath = path.resolve(
      process.cwd(),
      'public/dice/devil-set/devil-d6/metadata.json',
    )
    const modelPath = path.resolve(
      process.cwd(),
      'public/dice/devil-set/devil-d6/model.glb',
    )
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
    expect(sourceMetadata.faceNormals).toEqual([
      {
        value: 1,
        normal: [0.19944679289912032, 0.3543332366985917, 0.9136021750045012],
      },
      {
        value: 2,
        normal: [0.8471490184729035, -0.5141427188065125, 0.13414844463743922],
      },
      {
        value: 3,
        normal: [-0.03203371138028793, -0.9994514461355557, 0.008405245549706689],
      },
      {
        value: 4,
        normal: [0.26567059240604196, 0.9640638341443597, -0.0002450010189993582],
      },
      {
        value: 5,
        normal: [-0.9864952371565209, -0.0021288041269176493, 0.16377611321706467],
      },
      {
        value: 6,
        normal: [-0.15573002002007064, -0.08028842700476305, -0.9845313247193558],
      },
    ])
  })
})
