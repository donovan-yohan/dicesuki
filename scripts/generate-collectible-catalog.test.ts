import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildCatalog,
  buildSql,
  catalogPaths,
  createPreparedCatalogEdition,
  generateCatalogArtifacts,
  publishPreparedCatalogEdition,
  resolvePublicModelFilePath,
  verifyPublishedEditions,
} from './generate-collectible-catalog.js'
import { hashCatalogRow } from './catalog-edition-planner.js'

const temporaryDirectories: string[] = []

function item(contractVersion = 1) {
  return {
    id: `test-set/d6@${contractVersion}`,
    catalogKey: 'test-set/d6',
    contractVersion,
    itemKind: 'die',
    setId: 'test-set',
    diceType: 'd6',
    rarity: 'rare',
  }
}

function asset(assetVersion = 1, metadata = {
  name: 'Test d6',
  source: 'configured',
  appearance: {
    baseColor: '#000000',
    accentColor: '#ffffff',
    material: 'plastic',
  },
  vfx: {},
}) {
  return {
    id: `test-set/d6@1/asset@${assetVersion}`,
    catalogItemId: 'test-set/d6@1',
    assetVersion,
    assetKind: 'builtin',
    modelPath: 'builtin:d6',
    modelSha256: null,
    metadata,
    metadataSha256: hashCatalogRow(metadata),
  }
}

function baselineEdition() {
  return {
    edition: 1,
    slug: 'initial',
    label: 'V1',
    migration: '0004_collectible_catalog.sql',
    items: [item()],
    assetVersions: [asset()],
  }
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-catalog-generator-'))
  temporaryDirectories.push(root)
  const paths = catalogPaths(root)
  fs.mkdirSync(paths.editionsDir, { recursive: true })
  fs.mkdirSync(paths.migrationsDir, { recursive: true })
  fs.mkdirSync(path.dirname(paths.jsonOutputPath), { recursive: true })

  const edition = baselineEdition()
  const sql = buildSql(edition, edition.label)
  fs.writeFileSync(paths.sqlOutputPath, sql)
  fs.writeFileSync(
    paths.baselineMigrationPath,
    `-- schema before generated data\n\n${sql}\n-- policies after generated data\n`,
  )
  fs.writeFileSync(
    path.join(paths.editionsDir, '0001-initial.json'),
    `${JSON.stringify(edition, null, 2)}\n`,
  )
  return { paths, edition }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('collectible catalog edition integration', () => {
  it('rejects model path overrides for non-production catalog keys', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-catalog-source-'))
    temporaryDirectories.push(root)
    const paths = catalogPaths(root)
    fs.mkdirSync(path.dirname(paths.sourcePath), { recursive: true })
    fs.mkdirSync(paths.diceDir, { recursive: true })
    fs.writeFileSync(paths.sourcePath, JSON.stringify({
      contractVersion: 1,
      assetVersion: 1,
      setVersionOverrides: {},
      versionOverrides: {
        'test-set/d6/rare': {
          modelPath: '/dice/test-set/d6/versions/v2/model.glb',
        },
      },
      diceShapes: ['d6'],
      configuredSets: [{
        id: 'test-set',
        name: 'Test Set',
        description: 'Configured renderer test set',
        rarityVariants: {
          rare: {
            appearance: {
              baseColor: '#000000',
              accentColor: '#ffffff',
              material: 'plastic',
            },
            vfx: {},
          },
        },
      }],
      standaloneItems: [],
    }))

    expect(() => buildCatalog(paths)).toThrow(/requires a production catalog key/)
  })

  it('resolves model paths inside public and rejects traversal before reading bytes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-model-path-'))
    temporaryDirectories.push(root)
    const modelPath = path.join(root, 'public', 'dice', 'test-set', 'd6', 'model.glb')
    fs.mkdirSync(path.dirname(modelPath), { recursive: true })
    fs.writeFileSync(modelPath, 'safe model bytes')
    expect(resolvePublicModelFilePath(root, '/dice/test-set/d6/model.glb')).toBe(
      modelPath,
    )
    expect(() => resolvePublicModelFilePath(root, '/dice/../../.env')).toThrow(/safe public path/)
    expect(() => resolvePublicModelFilePath(root, 'dice/test-set/model.glb')).toThrow(
      /must start with \/dice\//,
    )

    const outsidePath = path.join(root, 'outside.glb')
    const symlinkPath = path.join(path.dirname(modelPath), 'escape.glb')
    fs.writeFileSync(outsidePath, 'outside bytes')
    fs.symlinkSync(outsidePath, symlinkPath)
    expect(() => resolvePublicModelFilePath(root, '/dice/test-set/d6/escape.glb')).toThrow(
      /must not use symbolic links/,
    )
  })

  it('anchors a published manifest to its frozen SQL and migration', () => {
    const { paths, edition } = fixture()
    expect(() => verifyPublishedEditions([edition], paths)).not.toThrow()

    const rewrittenItem = { ...item(), rarity: 'epic' }
    const rewrittenEdition = { ...edition, items: [rewrittenItem] }
    const rewrittenDesired = {
      contractVersion: 1,
      items: [{ ...rewrittenItem, assetVersionId: asset().id }],
      assetVersions: [asset()],
    }
    expect(() => generateCatalogArtifacts({
      paths,
      desired: rewrittenDesired,
      editions: [rewrittenEdition],
    })).toThrow(/stale|frozen catalog edition/)
  })

  it('allows catalog references but rejects catalog DML outside the frozen block', () => {
    const { paths, edition } = fixture()
    const baseline = fs.readFileSync(paths.baselineMigrationPath, 'utf8')
    const legitimateReferences = `
-- insert into public.catalog_items is documentation, not executable SQL.
-- merge into public.catalog_items, truncate table public.catalog_items, and
-- copy public.catalog_items from stdin are also documentation here.
select count(*) from public.catalog_items;
select 'update public.catalog_asset_versions set asset_version = 2';
select 'merge into public.catalog_items using source on false when not matched then do nothing';
select 'truncate table public.catalog_asset_versions';
select 'copy public.catalog_items from stdin';
copy public.catalog_items to stdout;
copy (select * from public.catalog_asset_versions) to stdout;
create index catalog_items_lookup on public.catalog_items (catalog_key);
create policy "insert into public.catalog_items is not a statement"
  on public.catalog_items for select using (true);
create trigger catalog_items_immutable
  before update or delete on public.catalog_items
  for each row execute function public.reject_catalog_mutation();
create policy catalog_assets_read on public.catalog_asset_versions for select using (true);
`
    fs.writeFileSync(paths.baselineMigrationPath, baseline + legitimateReferences)
    expect(() => verifyPublishedEditions([edition], paths)).not.toThrow()

    const forbiddenStatements = {
      insert: "insert into public.catalog_items (id) values ('unexpected');",
      update: 'update only "public"."catalog_asset_versions"* set asset_version = 2;',
      delete: 'delete from only public.catalog_items where id = current_user;',
      merge: `merge into only "public"."catalog_items"* as target
       using incoming_catalog as source on target.id = source.id
       when matched then update set id = source.id;`,
      truncate: `truncate table public.unrelated_table,
       only "public"."catalog_asset_versions"* restart identity;`,
      truncateWithoutTable: 'truncate catalog_items;',
      copyFrom: 'copy "public"."catalog_items" (id, catalog_key) from stdin;',
      copyBareFrom: 'copy catalog_asset_versions from stdin;',
      proceduralDelete: `create function mutate_catalog() returns trigger language plpgsql as $$
       begin
         delete from public.catalog_asset_versions where id = old.id;
         return old;
       end
       $$;`,
      dynamicTruncate: `create function dynamically_mutate_catalog() returns void language plpgsql as $function$
       begin
         execute $catalog_write$truncate table public.catalog_items$catalog_write$;
       end
       $function$;`,
    }
    for (const [operation, statement] of Object.entries(forbiddenStatements)) {
      fs.writeFileSync(
        paths.baselineMigrationPath,
        `${baseline}${legitimateReferences}\n${statement}\n`,
      )
      expect(() => verifyPublishedEditions([edition], paths), operation)
        .toThrow(/catalog DML outside its generated block/)
    }
  })

  it('prepares and publishes one delta without replaying historical rows', () => {
    const { paths, edition } = fixture()
    const metadata = { ...asset().metadata, name: 'Test d6 remaster' }
    const asset2 = asset(2, metadata)
    const desired = {
      contractVersion: 1,
      items: [{ ...item(), assetVersionId: asset2.id }],
      assetVersions: [asset2],
    }

    const prepared = createPreparedCatalogEdition([edition], desired, '0005', 'remaster')
    expect(prepared.edition.items).toEqual([])
    expect(prepared.edition.assetVersions).toEqual([asset2])
    expect(prepared.migrationSql).toContain("'test-set/d6@1/asset@2'")
    expect(prepared.migrationSql).not.toContain("'test-set/d6@1/asset@1'")
    expect(prepared.catalog.assetVersions.map(candidate => candidate.id)).toEqual([
      'test-set/d6@1/asset@1',
      'test-set/d6@1/asset@2',
    ])
    expect(prepared.catalog.items[0].assetVersionId).toBe(asset2.id)

    publishPreparedCatalogEdition(prepared, paths)
    expect(fs.readFileSync(
      path.join(paths.editionsDir, '0002-remaster.json'),
      'utf8',
    )).toBe(prepared.editionJson)
    expect(fs.readFileSync(
      path.join(paths.migrationsDir, '0005_catalog_remaster.sql'),
      'utf8',
    )).toBe(prepared.migrationSql)
    expect(fs.readFileSync(paths.jsonOutputPath, 'utf8')).toBe(prepared.catalogJson)
  })
})
