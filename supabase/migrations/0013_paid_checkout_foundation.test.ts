import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0013_paid_checkout_foundation.sql',
)

let sql = ''

beforeAll(async () => {
  sql = await readFile(migrationPath, 'utf8')
})

function functionSql(schema: 'public' | 'private', name: string) {
  return sql.match(
    new RegExp(`create or replace function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'),
  )?.[0] ?? ''
}

describe('0013 paid checkout foundation', () => {
  it('extends the wallet bucket domain with an inert paid value only', () => {
    expect(sql).toMatch(
      /alter table public\.wallet_balances\s+drop constraint wallet_balances_balance_bucket_check/,
    )
    expect(sql).toMatch(
      /add constraint wallet_balances_balance_bucket_check\s+check \(balance_bucket in \('promotional', 'earned', 'paid'\)\)/,
    )
    // Foundation only: no paid currency, ledger, or pair rule is introduced here.
    expect(sql).not.toMatch(/wallet_balances_currency_bucket_pair/)
    expect(sql).not.toMatch(/insert into public\.wallet_ledger_entries/)
    expect(sql).not.toMatch(/append_wallet_ledger_entry/)
  })

  it('defines a buyer-owned order state machine with purchase provenance shape', () => {
    expect(sql).toMatch(/create table public\.payment_orders/)
    expect(sql).toMatch(/external_id\s+uuid\s+not null unique default gen_random_uuid\(\)/)
    expect(sql).toMatch(/user_id\s+uuid\s+not null references auth\.users \(id\) on delete restrict/)
    expect(sql).toMatch(/catalog_item_id\s+text\s+not null references public\.catalog_items \(id\)/)
    expect(sql).toMatch(/amount_minor\s+bigint\s+not null check \(amount_minor > 0\)/)
    expect(sql).toMatch(/currency\s+text\s+not null check \(currency ~ '\^\[A-Z\]\{3\}\$'\)/)
    expect(sql).toMatch(
      /status\s+text\s+not null default 'pending'\s+check \(status in \('pending', 'paid', 'fulfilled', 'canceled', 'refunded'\)\)/,
    )
    expect(sql).toMatch(/xsolla_transaction_id\s+bigint\s+unique/)
    expect(sql).toMatch(/dry_run\s+boolean\s+not null/)
    expect(sql).toMatch(
      /foreign key \(entitlement_id, user_id, catalog_item_id\)\s+references public\.user_entitlements \(id, user_id, catalog_item_id\)/,
    )
    expect(sql).toMatch(/constraint payment_orders_fulfilled_shape/)
    expect(sql).toMatch(/constraint payment_orders_pending_shape/)
    for (const index of [
      'payment_orders_user_created_idx',
      'payment_orders_catalog_item_idx',
      'payment_orders_entitlement_idx',
    ]) {
      expect(sql).toMatch(new RegExp(`create index ${index}`, 'i'))
    }
  })

  it('keys the append-only event table on transaction plus event type', () => {
    expect(sql).toMatch(/create table public\.payment_events/)
    expect(sql).toMatch(
      /constraint payment_events_transaction_event_unique\s+unique \(xsolla_transaction_id, event_type\)/,
    )
    expect(sql).toMatch(
      /event_type\s+text\s+not null\s+check \(event_type in \('payment', 'order_paid', 'refund', 'chargeback'\)\)/,
    )
    expect(sql).toMatch(/id\s+bigint\s+generated always as identity primary key/)
    expect(sql).toMatch(/create index payment_events_order_idx/)
  })

  it('forbids event mutation and order deletion while allowing status updates', () => {
    const reject = functionSql('private', 'reject_payment_history_mutation')
    expect(reject).toMatch(/is forbidden; append a new immutable row instead/)
    expect(reject).toContain("set search_path = ''")
    expect(sql).toMatch(/create trigger payment_orders_reject_delete\s+before delete on public\.payment_orders/)
    expect(sql).toMatch(/create trigger payment_orders_reject_truncate\s+before truncate on public\.payment_orders/)
    expect(sql).toMatch(
      /create trigger payment_events_reject_update_delete\s+before update or delete on public\.payment_events/,
    )
    expect(sql).toMatch(/create trigger payment_events_reject_truncate\s+before truncate on public\.payment_events/)
    // payment_orders must remain a mutable state machine: no update guard on it.
    expect(sql).not.toMatch(/before update[^;]*on public\.payment_orders/i)
  })

  it('fulfills through an idempotent gate that grants purchase provenance once', () => {
    const fn = functionSql('public', 'fulfill_payment_order')
    expect(fn).toMatch(/\(\s*p_external_id uuid,\s*p_xsolla_transaction_id bigint,\s*p_event_type text,\s*p_dry_run boolean,\s*p_raw_event jsonb default '\{\}'::jsonb\s*\)/)
    expect(fn).toMatch(/security definer/)
    expect(fn).toContain("set search_path = ''")
    expect(fn).toMatch(/p_event_type not in \('payment', 'order_paid'\)/)
    // Lock the order before the idempotency insert to serialize duplicate webhooks.
    expect(fn).toMatch(/from public\.payment_orders\s+where external_id = p_external_id\s+for update/)
    expect(fn.indexOf('for update')).toBeLessThan(fn.indexOf('insert into public.payment_events'))
    // Sandbox/production and bound-transaction mismatches fail closed.
    expect(fn).toMatch(/target_order\.dry_run <> p_dry_run/)
    expect(fn).toMatch(/is already bound to a different transaction/)
    // Idempotency gate.
    expect(fn).toMatch(/on conflict \(xsolla_transaction_id, event_type\) do nothing/)
    expect(fn).toMatch(/get diagnostics event_inserted = row_count/)
    expect(fn).toMatch(/if event_inserted = 0 then\s*\n\s*return target_order/)
    // Out-of-order webhook for an already-advanced order must not re-grant.
    expect(fn).toMatch(/if target_order\.status <> 'pending' then\s*\n\s*return target_order/)
    // Entitlement grant with purchase provenance and external_id grant_ref.
    expect(fn).toMatch(/insert into public\.user_entitlements/)
    expect(fn).toMatch(/'purchase',\s*\n\s*'payment-order:' \|\| target_order\.external_id::text/)
    expect(fn).toMatch(/'source', 'purchase'/)
    expect(fn).toMatch(/on conflict \(user_id, catalog_item_id\) do nothing/)
    // Order status flip is the terminal step.
    expect(fn).toMatch(/update public\.payment_orders\s+set status = 'fulfilled'/)
    expect(fn.indexOf('insert into public.user_entitlements')).toBeLessThan(
      fn.indexOf("set status = 'fulfilled'"),
    )
    // No wallet debit/credit for a direct cosmetic purchase.
    expect(fn).not.toMatch(/append_wallet_ledger_entry/)
  })

  it('creates and refunds only through service-role boundaries', () => {
    const create = functionSql('public', 'create_payment_order')
    const refund = functionSql('public', 'refund_payment_order')
    expect(create).toMatch(/security definer/)
    expect(create).toMatch(/p_currency !~ '\^\[A-Z\]\{3\}\$'/)
    expect(create).toMatch(/insert into public\.payment_orders/)
    expect(create).not.toMatch(/auth\.uid\(\)/)
    expect(refund).toMatch(/security definer/)
    expect(refund).toMatch(/p_event_type not in \('refund', 'chargeback'\)/)
    expect(refund).toMatch(/where xsolla_transaction_id = p_xsolla_transaction_id\s+for update/)
    expect(refund).toMatch(/update public\.user_entitlements\s+set revoked_at = now\(\)/)
    expect(refund).toMatch(/set status = 'refunded'/)
    expect(refund).toMatch(/event_inserted = 0 or target_order\.status = 'refunded'/)
  })

  it('forces RLS, gives buyers own-row reads, and grants no client write path', () => {
    expect(sql).toMatch(/alter table public\.payment_orders enable row level security/)
    expect(sql).toMatch(/alter table public\.payment_orders force row level security/)
    expect(sql).toMatch(/alter table public\.payment_events enable row level security/)
    expect(sql).toMatch(/alter table public\.payment_events force row level security/)
    expect(sql).toMatch(
      /create policy "users read their own payment orders"\s+on public\.payment_orders\s+for select\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\)/,
    )
    // The only policy is the buyer own-row SELECT; there is no write policy at
    // all (a write policy would be a second create policy or a non-select one).
    const policies = sql.match(/create policy[\s\S]*?;/gi) ?? []
    expect(policies).toHaveLength(1)
    expect(policies[0]).toMatch(/for select/i)
    expect(policies[0]).toMatch(/on public\.payment_orders/)
    expect(sql).not.toMatch(/for (?:insert|delete|all)\b/i)
    // Events are never client-readable.
    expect(sql).not.toMatch(/grant select on table public\.payment_events to (?:anon|authenticated)/i)
    expect(sql).not.toMatch(
      /grant\s+(?:insert|update|delete|truncate|all)[^;]*on table public\.payment_(?:orders|events)/i,
    )
    // The three boundaries are service-role execute only.
    for (const signature of [
      'create_payment_order\\(uuid, text, bigint, text, boolean\\)',
      'fulfill_payment_order\\(uuid, bigint, text, boolean, jsonb\\)',
      'refund_payment_order\\(bigint, text, boolean, jsonb\\)',
    ]) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*?public, anon, authenticated, service_role`),
      )
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${signature}[\\s\\S]*?to service_role`),
      )
      expect(sql).not.toMatch(
        new RegExp(`grant execute on function public\\.${signature}\\s+to (?:anon|authenticated)\\s*;`, 'i'),
      )
    }
  })
})
