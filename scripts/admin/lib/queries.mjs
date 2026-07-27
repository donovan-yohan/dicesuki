// Read surfaces. Every table here is SELECT-granted to `service_role`; none of
// them is writable by an API role, which is why all mutations go through the
// trusted RPCs in plans.mjs.
//
//   profiles                    0005_security_hardening.sql:37   (also writable)
//   wallet_balances             0009_earned_economy_ledger.sql:656
//   wallet_ledger_entries       0009_earned_economy_ledger.sql:657
//   roll_ticket_*               0014_roll_ticket_ledger.sql:267-268
//   dice_copies                 0020_dice_copy_inventory.sql:382
//   pull_sessions               0011_earned_pull_preparation.sql:1588
//   pull_session_transitions    0017_pull_commit_reveal.sql:55
//   payment_orders              0013_paid_checkout_foundation.sql:564
//   payment_events              0013_paid_checkout_foundation.sql:565
//   catalog_items               0004_collectible_catalog.sql:362

import { isUuid } from './plans.mjs'
import { findAuthUsers, likePattern } from './supabase.mjs'

function unwrap({ data, error, count }, label) {
  if (error) {
    const detail = [error.message, error.details, error.hint].filter(Boolean).join(' | ')
    const failure = new Error(`${label} failed: ${detail}`)
    failure.code = error.code
    throw failure
  }
  return count === undefined || count === null ? data : { data, count }
}

/**
 * Find candidate players.
 *
 * `auth.users` is not reachable over PostgREST (no view, no SECURITY DEFINER
 * accessor exists in supabase/migrations/), and `profiles` has no email column
 * (0001_profiles.sql:15-23). So identity comes from the GoTrue admin API and the
 * Discord display name comes from `public.profiles`; the two are merged on id.
 */
export async function resolveUserCandidates(client, environment, query, { limit = 20 } = {}) {
  const byId = new Map()

  const addProfile = profile => {
    const existing = byId.get(profile.id) ?? { id: profile.id }
    byId.set(profile.id, { ...existing, profile })
  }
  const addAuthUser = user => {
    const existing = byId.get(user.id) ?? { id: user.id }
    byId.set(user.id, {
      ...existing,
      auth: {
        id: user.id,
        email: user.email ?? null,
        createdAt: user.created_at ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
        provider: user.app_metadata?.provider ?? null,
        bannedUntil: user.banned_until ?? null,
      },
    })
  }

  if (isUuid(query)) {
    // Postgres renders uuids lowercase; normalise so a pasted uppercase id from
    // a support ticket still matches.
    const userId = query.toLowerCase()
    const { data, error } = await client.auth.admin.getUserById(userId)
    if (!error && data?.user) addAuthUser(data.user)
    const profile = unwrap(
      await client.from('profiles').select('*').eq('id', userId).maybeSingle(),
      'profiles lookup by id',
    )
    if (profile) addProfile(profile)
    if (!byId.has(userId)) return []
  } else {
    for (const user of await findAuthUsers(environment, { filter: query, perPage: limit })) {
      addAuthUser(user)
    }
    const profiles = unwrap(
      await client
        .from('profiles')
        .select('*')
        .ilike('display_name', likePattern(query))
        .limit(limit),
      'profiles lookup by display name',
    )
    for (const profile of profiles ?? []) addProfile(profile)
  }

  const candidates = [...byId.values()]
  // Fill in whichever half of the identity the first pass missed.
  await Promise.all(
    candidates.map(async candidate => {
      if (!candidate.profile) {
        const profile = unwrap(
          await client.from('profiles').select('*').eq('id', candidate.id).maybeSingle(),
          'profiles backfill',
        )
        if (profile) candidate.profile = profile
      }
      if (!candidate.auth) {
        const { data, error } = await client.auth.admin.getUserById(candidate.id)
        if (!error && data?.user) {
          candidate.auth = {
            id: data.user.id,
            email: data.user.email ?? null,
            createdAt: data.user.created_at ?? null,
            lastSignInAt: data.user.last_sign_in_at ?? null,
            provider: data.user.app_metadata?.provider ?? null,
            bannedUntil: data.user.banned_until ?? null,
          }
        }
      }
    }),
  )
  return candidates
}

export async function fetchWalletBalances(client, userId) {
  return (
    unwrap(
      await client
        .from('wallet_balances')
        .select('currency_id, balance_bucket, current_balance, updated_at')
        .eq('user_id', userId)
        .order('currency_id')
        .order('balance_bucket'),
      'wallet_balances',
    ) ?? []
  )
}

export async function fetchTicketBalances(client, userId) {
  return (
    unwrap(
      await client
        .from('roll_ticket_balances')
        .select('roll_type, current_quantity, updated_at')
        .eq('user_id', userId)
        .order('roll_type'),
      'roll_ticket_balances',
    ) ?? []
  )
}

export async function fetchCopySummary(client, userId, { recent = 5 } = {}) {
  const total = unwrap(
    await client
      .from('dice_copies')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    'dice_copies total count',
  )
  const live = unwrap(
    await client
      .from('dice_copies')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('scrapped_at', null),
    'dice_copies live count',
  )
  const recentCopies =
    unwrap(
      await client
        .from('dice_copies')
        .select('catalog_item_id, source_kind, acquired_at, is_first_copy, scrapped_at')
        .eq('user_id', userId)
        .order('acquired_at', { ascending: false })
        .limit(recent),
      'dice_copies recent',
    ) ?? []
  return {
    totalCopies: total.count ?? 0,
    liveCopies: live.count ?? 0,
    scrappedCopies: (total.count ?? 0) - (live.count ?? 0),
    recentCopies,
  }
}

export async function fetchWalletLedger(client, userId, limit) {
  return (
    unwrap(
      await client
        .from('wallet_ledger_entries')
        .select(
          'id, currency_id, balance_bucket, delta_amount, balance_before, balance_after, ' +
            'reason_code, idempotency_key, economy_edition_id, provenance, created_at',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit),
      'wallet_ledger_entries',
    ) ?? []
  )
}

export async function fetchTicketLedger(client, userId, limit) {
  return (
    unwrap(
      await client
        .from('roll_ticket_ledger_entries')
        .select(
          'id, roll_type, delta_quantity, quantity_before, quantity_after, ' +
            'reason_code, idempotency_key, provenance, created_at',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit),
      'roll_ticket_ledger_entries',
    ) ?? []
  )
}

/**
 * A pull hold is live when `prepared_at <= now < expires_at` and no terminal
 * transition row exists — the same predicate the wallet RPC uses to compute
 * held funds (0028_sku_fulfillment.sql:547-561) and the same one the grant
 * trigger uses before raising `55000` (0021_pull_copy_grant_rework.sql:968-981).
 */
export function selectActiveSession(sessions, transitionsBySession, now = new Date()) {
  return (
    sessions.find(session => {
      if (transitionsBySession.has(session.id)) return false
      const preparedAt = new Date(session.prepared_at).getTime()
      const expiresAt = new Date(session.expires_at).getTime()
      return preparedAt <= now.getTime() && expiresAt > now.getTime()
    }) ?? null
  )
}

export async function fetchPullSessions(client, userId, { limit = 10 } = {}) {
  const sessions =
    unwrap(
      await client
        .from('pull_sessions')
        .select(
          'id, account_id, user_id, banner_version_id, banner_family_id, pull_count, ' +
            'currency_id, balance_bucket, held_amount, hold_ttl_seconds, prepared_at, expires_at',
        )
        .eq('user_id', userId)
        .order('prepared_at', { ascending: false })
        .limit(limit),
      'pull_sessions',
    ) ?? []

  const transitionsBySession = new Map()
  if (sessions.length > 0) {
    const transitions =
      unwrap(
        await client
          .from('pull_session_transitions')
          .select('session_id, kind, created_at')
          .in(
            'session_id',
            sessions.map(session => session.id),
          ),
        'pull_session_transitions',
      ) ?? []
    for (const transition of transitions) {
      transitionsBySession.set(transition.session_id, transition)
    }
  }

  return {
    sessions: sessions.map(session => ({
      ...session,
      transition: transitionsBySession.get(session.id) ?? null,
    })),
    activeSession: selectActiveSession(sessions, transitionsBySession),
  }
}

export async function fetchOrders(client, userId, limit) {
  const orders =
    unwrap(
      await client
        .from('payment_orders')
        .select(
          'id, external_id, status, sku_id, catalog_item_id, amount_minor, currency, ' +
            'xsolla_transaction_id, dry_run, entitlement_created, created_at, paid_at, ' +
            'fulfilled_at, refunded_at',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit),
      'payment_orders',
    ) ?? []

  let events = []
  if (orders.length > 0) {
    events =
      unwrap(
        await client
          .from('payment_events')
          .select('id, order_id, event_type, xsolla_transaction_id, dry_run, processed_at')
          .in(
            'order_id',
            orders.map(order => order.id),
          )
          .order('processed_at', { ascending: false }),
        'payment_events',
      ) ?? []
  }
  return { orders, events }
}

/**
 * Validate a catalog item id before a die grant. `record_dice_copy_grant` also
 * checks this (0020_dice_copy_inventory.sql:146-154), but failing in the CLI
 * gives the operator a usable list instead of a bare `22023`.
 *
 * The asset-version count matters too: `fetchCatalogSnapshot` drops items with
 * no asset version (src/lib/collectibleCatalog.ts:259-260), so a die granted for
 * an asset-less catalog item would exist in the database and still not render.
 */
export async function fetchCatalogItem(client, catalogItemId) {
  const item = unwrap(
    await client
      .from('catalog_items')
      .select('id, catalog_key, contract_version, item_kind, set_id, dice_type, rarity')
      .eq('id', catalogItemId)
      .maybeSingle(),
    'catalog_items lookup',
  )
  if (!item) return null
  const assets = unwrap(
    await client
      .from('catalog_asset_versions')
      .select('id', { count: 'exact', head: true })
      .eq('catalog_item_id', catalogItemId),
    'catalog_asset_versions count',
  )
  return { ...item, assetVersionCount: assets.count ?? 0 }
}
