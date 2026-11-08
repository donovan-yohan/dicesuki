import type { SupabaseClient } from '@supabase/supabase-js'
import { COLLECTIBLE_CATALOG } from '../lib/collectibleCatalog'

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}

/** Synthetic PostgREST transport; production readers/parsers are not mocked. */
export function controlledInventoryClient(holdWallet = false) {
  const item = COLLECTIBLE_CATALOG.items.find(candidate => candidate.diceType === 'd6'
    && COLLECTIBLE_CATALOG.assetVersions.some(asset => asset.id === candidate.assetVersionId && asset.assetKind === 'builtin'))!
  const asset = COLLECTIBLE_CATALOG.assetVersions.find(candidate => candidate.id === item.assetVersionId)!
  type Result = { data: unknown; error: { message: string } | null }
  const copies = deferred<Result>()
  const catalog = deferred<Result>()
  const wallet = deferred<Result>()
  const copiesRequested = deferred<void>()
  const catalogRequested = deferred<void>()
  const tables: string[] = []
  const from = (table: string) => {
    tables.push(table)
    const result = () => {
      if (table === 'wallet_balances' && holdWallet) return wallet.promise
      if (table === 'dice_copies') { copiesRequested.resolve(); return copies.promise }
      if (table === 'catalog_items') { catalogRequested.resolve(); return catalog.promise }
      return Promise.resolve({ data: table === 'catalog_asset_versions' ? [{
        id: asset.id, catalog_item_id: item.id, asset_version: asset.assetVersion,
        asset_kind: asset.assetKind, model_path: asset.modelPath,
        model_sha256: 'modelSha256' in asset ? asset.modelSha256 : null,
        metadata: asset.metadata, metadata_sha256: asset.metadataSha256,
      }] : [], error: null })
    }
    const builder = {
      select: () => builder, eq: () => builder, is: () => builder, upsert: () => builder,
      maybeSingle: () => table === 'wallet_balances' && holdWallet ? wallet.promise : Promise.resolve({ data: null, error: null }),
      then: (accept: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => result().then(accept, reject),
    }
    return builder
  }
  const acceptCatalog = () => catalog.resolve({ data: [{
    id: item.id, catalog_key: item.catalogKey, contract_version: item.contractVersion,
    item_kind: item.itemKind, set_id: item.setId, dice_type: item.diceType, rarity: item.rarity,
  }], error: null })
  const acceptCopies = (ids = ['server-copy-mine']) => copies.resolve({ data: ids.map((id, index) => ({
    id, catalog_item_id: item.id, grant_idempotency_key: `grant-${id}`, source_kind: 'reward',
    acquired_at: '2026-01-01T00:00:00Z', is_first_copy: index === 0, scrapped_at: null,
  })), error: null })
  return {
    client: { from, rpc: () => Promise.resolve({ data: null, error: null }) } as unknown as SupabaseClient,
    tables, copies, catalog, wallet, copiesRequested: copiesRequested.promise, catalogRequested: catalogRequested.promise,
    acceptCatalog, acceptCopies, item, asset,
  }
}
