import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0017_pull_commit_reveal.sql',
)

let sql = ''
let bannerBindingSql = ''
let priorFundingSql = ''

beforeAll(async () => {
  const [currentSql, bindingSql, conversionSql] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(resolve(
      process.cwd(),
      'supabase/migrations/0015_banner_roll_type_binding.sql',
    ), 'utf8'),
    readFile(resolve(
      process.cwd(),
      'supabase/migrations/0016_stars_to_standard_roll_conversion.sql',
    ), 'utf8'),
  ])
  sql = currentSql
  bannerBindingSql = bindingSql
  priorFundingSql = [bindingSql, conversionSql].join('\n')
})

function functionSqlFrom(
  source: string,
  schema: 'public' | 'private',
  name: string,
) {
  return source.match(
    new RegExp(`create or replace function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'),
  )?.[0] ?? ''
}

function functionSql(schema: 'public' | 'private', name: string) {
  return functionSqlFrom(sql, schema, name)
}

function withoutTerminalExclusions(source: string) {
  return source
    .replace(
      /\s+and not exists \(\s*select 1\s*from public\.pull_session_transitions as transitions\s*where transitions\.session_id = (?:sessions|pull_sessions)\.id\s*\)/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()
}

function expectTerminalExclusion(source: string) {
  expect(source).toMatch(
    /(?:sessions\.)?prepared_at <= decision_at[\s\S]*?(?:sessions\.)?expires_at > decision_at[\s\S]*?not exists \([\s\S]*?from public\.pull_session_transitions as transitions[\s\S]*?transitions\.session_id = (?:sessions|pull_sessions)\.id/i,
  )
}

describe('0017 pull commit/reveal terminal boundary', () => {
  it('defines one immutable terminal transition per pull session', () => {
    expect(sql).toMatch(/create table public\.pull_session_transitions/i)
    expect(sql).toMatch(
      /session_id\s+uuid\s+not null[\s\S]*?references public\.pull_sessions \(id\) on delete restrict/i,
    )
    expect(sql).toMatch(
      /constraint pull_session_transitions_session_unique unique \(session_id\)/i,
    )
    expect(sql).toMatch(
      /foreign key \(session_id, account_id, user_id, banner_version_id\)[\s\S]*?references public\.pull_sessions \(id, account_id, user_id, banner_version_id\)/i,
    )
    expect(sql).toMatch(
      /kind\s+text\s+not null check \(kind in \('committed', 'cancelled'\)\)/i,
    )
    expect(sql).toMatch(
      /create trigger pull_session_transitions_reject_update_delete[\s\S]*?before update or delete on public\.pull_session_transitions[\s\S]*?private\.reject_pull_history_mutation\(\)/i,
    )
    expect(sql).toMatch(
      /create trigger pull_session_transitions_reject_truncate[\s\S]*?before truncate on public\.pull_session_transitions[\s\S]*?private\.reject_pull_history_mutation\(\)/i,
    )
  })

  it('forces owner-only transition reads and exposes no client DML', () => {
    expect(sql).toMatch(
      /alter table public\.pull_session_transitions enable row level security/i,
    )
    expect(sql).toMatch(
      /alter table public\.pull_session_transitions force row level security/i,
    )
    const policy = sql.match(
      /create policy "users read their own pull-session transitions"[\s\S]*?;/i,
    )?.[0] ?? ''
    expect(policy).toMatch(/for select\s+to authenticated/i)
    expect(policy).toMatch(
      /using \(\(select auth\.uid\(\)\) = user_id\)/i,
    )
    expect(sql).toMatch(
      /revoke all on table public\.pull_session_transitions[\s\S]*?from public, anon, authenticated, service_role/i,
    )
    expect(sql).toMatch(
      /grant select on table public\.pull_session_transitions\s+to authenticated, service_role/i,
    )
    expect(sql).not.toMatch(
      /grant\s+(?:insert|update|delete|truncate|all)[^;]*on table public\.pull_session_transitions/i,
    )
  })

  it('excludes terminal sessions from exactly all five held-amount sums', () => {
    const prepare = functionSql('private', 'prepare_pull_for_user')
    const walletGuard = functionSql(
      'private',
      'preserve_active_pull_holds_on_balance_change',
    )
    const ticketGuard = functionSql(
      'private',
      'preserve_active_roll_ticket_holds_on_balance_change',
    )
    const walletAppend = functionSql('public', 'append_wallet_ledger_entry')
    const sumPattern = /select coalesce\(sum\(sessions\.held_amount\), 0\) into active_holds/gi

    expect(prepare.match(sumPattern) ?? []).toHaveLength(2)
    expect(walletGuard.match(sumPattern) ?? []).toHaveLength(1)
    expect(ticketGuard.match(sumPattern) ?? []).toHaveLength(1)
    expect(walletAppend.match(sumPattern) ?? []).toHaveLength(1)
    expect(sql.match(sumPattern) ?? []).toHaveLength(5)

    const prepareSums = prepare.match(
      /select coalesce\(sum\(sessions\.held_amount\), 0\) into active_holds[\s\S]*?transitions\.session_id = sessions\.id[\s\S]*?\);/gi,
    ) ?? []
    expect(prepareSums).toHaveLength(2)
    for (const source of [walletGuard, ticketGuard, walletAppend]) {
      expectTerminalExclusion(source)
    }
  })

  it('preserves the four canonical 0015 bodies modulo only terminal exclusions', () => {
    const canonicalFunctions = [
      ['private', 'prepare_pull_for_user'],
      ['private', 'preserve_active_roll_ticket_holds_on_balance_change'],
      ['private', 'preserve_active_pull_holds_on_balance_change'],
      ['public', 'append_wallet_ledger_entry'],
    ] as const

    for (const [schema, name] of canonicalFunctions) {
      const canonical = functionSqlFrom(bannerBindingSql, schema, name)
      const rebased = functionSqlFrom(sql, schema, name)

      expect(canonical, `missing 0015 canonical body for ${schema}.${name}`)
        .not.toBe('')
      expect(rebased, `missing 0017 rebased body for ${schema}.${name}`)
        .not.toBe('')
      expect(withoutTerminalExclusions(rebased))
        .toBe(withoutTerminalExclusions(canonical))
    }
  })

  it('releases terminal sessions from family and ownership snapshot gates', () => {
    const prepare = functionSql('private', 'prepare_pull_for_user')
    const familyGate = prepare.match(
      /if exists \([\s\S]*?banner_family_id = banner\.banner_family_id[\s\S]*?\) then/i,
    )?.[0] ?? ''
    const ownershipGuard = functionSql(
      'private',
      'preserve_pull_ownership_snapshot',
    )

    expectTerminalExclusion(familyGate)
    expectTerminalExclusion(ownershipGuard)
    expect(ownershipGuard).toMatch(
      /target_account := private\.lock_wallet_account\(new\.user_id\)/i,
    )
  })

  it('scopes every private session lookup to the requested owner and account', () => {
    const getter = functionSql(
      'private',
      'get_committed_pull_reveal_for_user',
    )
    const commit = functionSql('private', 'commit_pull_session_for_user')
    const cancel = functionSql('private', 'cancel_pull_session_for_user')

    expect(getter).toMatch(
      /from public\.pull_sessions\s+where id = p_session_id\s+and user_id = p_user_id/i,
    )
    for (const engine of [commit, cancel]) {
      expect(engine).toMatch(
        /target_account := private\.lock_wallet_account\(p_user_id\)[\s\S]*?from public\.pull_sessions\s+where id = p_session_id\s+and account_id = target_account\.id\s+and user_id = p_user_id/i,
      )
    }
  })

  it('locks the wallet account and inserts committed before either debit', () => {
    const commit = functionSql('private', 'commit_pull_session_for_user')
    const accountLock = commit.indexOf(
      'target_account := private.lock_wallet_account(p_user_id)',
    )
    const transitionInsert = commit.indexOf(
      'insert into public.pull_session_transitions',
    )
    const walletDebit = commit.indexOf('public.append_wallet_ledger_entry(')
    const ticketDebit = commit.indexOf(
      'public.record_roll_ticket_ledger_entry(',
    )

    expect(accountLock).toBeGreaterThan(-1)
    expect(transitionInsert).toBeGreaterThan(accountLock)
    expect(walletDebit).toBeGreaterThan(transitionInsert)
    expect(ticketDebit).toBeGreaterThan(transitionInsert)
    expect(commit).toMatch(
      /committed transition[\s\S]*?visible[\s\S]*?own released hold[\s\S]*?not counted/i,
    )
    expect(commit).toMatch(
      /on conflict \(session_id\) do nothing[\s\S]*?inserted_transition\.id is null/i,
    )
  })

  it('debits both funding branches only through canonical ledger functions', () => {
    const commit = functionSql('private', 'commit_pull_session_for_user')

    expect(commit).toMatch(
      /if banner\.roll_type is null then[\s\S]*?public\.append_wallet_ledger_entry\(\s*p_user_id,\s*'stars',\s*'promotional',\s*-target_session\.held_amount/i,
    )
    expect(commit).toMatch(
      /elsif banner\.roll_type = 'standard_roll' then[\s\S]*?public\.record_roll_ticket_ledger_entry\(\s*p_user_id,\s*'standard_roll',\s*-target_session\.held_amount/i,
    )
    expect(commit).not.toMatch(/insert into public\.wallet_(?:balances|ledger_entries)/i)
    expect(commit).not.toMatch(/update public\.wallet_(?:balances|ledger_entries)/i)
    expect(commit).not.toMatch(/insert into public\.roll_ticket_(?:balances|ledger_entries)/i)
    expect(commit).not.toMatch(/update public\.roll_ticket_(?:balances|ledger_entries)/i)
  })

  it('advances guarantees only from the sealed session projection', () => {
    const commit = functionSql('private', 'commit_pull_session_for_user')

    expect(commit).toMatch(
      /insert into public\.pull_guarantee_states[\s\S]*?target_session\.total_pulls_projected,\s*target_session\.rare_misses_projected,\s*target_session\.epic_misses_projected,\s*target_session\.selected_misses_projected/i,
    )
    expect(commit).toMatch(
      /on conflict \(account_id, banner_family_id\) do update[\s\S]*?total_pulls = excluded\.total_pulls[\s\S]*?selected_misses = excluded\.selected_misses/i,
    )
    expect(commit).not.toMatch(/total_pulls\s*=\s*total_pulls\s*\+/i)
  })

  it('fails closed on premium and grants sealed outcomes through existing conventions', () => {
    const commit = functionSql('private', 'commit_pull_session_for_user')
    const premiumGuard = commit.indexOf(
      "if banner.banner_class = 'premium'",
    )
    const transitionInsert = commit.indexOf(
      'insert into public.pull_session_transitions',
    )

    expect(premiumGuard).toBeGreaterThan(-1)
    expect(transitionInsert).toBeGreaterThan(premiumGuard)
    expect(commit).toMatch(
      /Premium banner commit is disabled pending issue #154'[\s\S]*?errcode = '55000'/i,
    )
    expect(commit).toMatch(
      /insert into public\.user_entitlements[\s\S]*?'pull'[\s\S]*?'pull-session:' \|\| target_session\.id::text[\s\S]*?on conflict \(user_id, catalog_item_id\) do nothing/i,
    )
    expect(commit).toMatch(
      /sum\(results\.duplicate_dust_amount\)[\s\S]*?public\.append_wallet_ledger_entry\(\s*p_user_id,\s*'dust',\s*'earned',\s*duplicate_dust_total/i,
    )
  })

  it('returns a verifiable reveal only for committed sessions', () => {
    const getter = functionSql(
      'private',
      'get_committed_pull_reveal_for_user',
    )
    const commit = functionSql('private', 'commit_pull_session_for_user')
    const cancel = functionSql('private', 'cancel_pull_session_for_user')

    expect(getter).toMatch(
      /target_transition\.kind <> 'committed'[\s\S]*?not committed/i,
    )
    expect(getter).toMatch(/language plpgsql\s+volatile/i)
    expect(getter).toMatch(
      /'commitment_scheme', target_session\.commitment_scheme[\s\S]*?'commitment_root', target_session\.commitment_root/i,
    )
    expect(getter).toMatch(
      /'rng_seed', encode\(target_session\.rng_seed, 'hex'\)/i,
    )
    expect(getter).toMatch(
      /'nonce', encode\(results\.nonce, 'hex'\)[\s\S]*?'commitment', results\.commitment_sha256/i,
    )
    expect(commit).toMatch(
      /return private\.get_committed_pull_reveal_for_user\(p_user_id, p_session_id\)/i,
    )
    expect(sql.match(/encode\(target_session\.rng_seed, 'hex'\)/gi) ?? [])
      .toHaveLength(1)
    expect(cancel).not.toMatch(/rng_seed|sealed_pull_results|commitment_sha256/i)
  })

  it('settles wallet entries against the immutable banner economy edition', () => {
    const commit = functionSql('private', 'commit_pull_session_for_user')

    expect(commit.match(
      /banner\.economy_edition_id/gi,
    ) ?? []).toHaveLength(2)
    expect(commit).not.toMatch(
      /economy_edition_id constant text|earned-collection@1/i,
    )
  })

  it('cancels live sessions idempotently without ledger, grant, guarantee, or reveal effects', () => {
    const cancel = functionSql('private', 'cancel_pull_session_for_user')

    expect(cancel).toMatch(
      /existing_transition\.kind = 'cancelled'[\s\S]*?return existing_transition/i,
    )
    expect(cancel).toMatch(
      /target_session\.expires_at <= decision_at[\s\S]*?Pull session % is expired/i,
    )
    expect(cancel).toMatch(
      /insert into public\.pull_session_transitions[\s\S]*?'cancelled'/i,
    )
    expect(cancel).not.toMatch(
      /append_wallet_ledger_entry|record_roll_ticket_ledger_entry|wallet_ledger_entries|roll_ticket_ledger_entries|pull_guarantee_states|user_entitlements|sealed_pull_results|rng_seed/i,
    )
  })

  it('uses new deterministic per-session idempotency prefixes', () => {
    const commit = functionSql('private', 'commit_pull_session_for_user')
    const prefixes = [
      'pull-commit:stars:',
      'pull-commit:ticket:',
      'pull-commit:dust:',
    ]

    for (const prefix of prefixes) {
      expect(commit).toContain(`'${prefix}' || target_session.id::text`)
      expect(priorFundingSql).not.toContain(prefix)
    }
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it('exposes only authenticated self-derived public wrappers', () => {
    for (const name of [
      'commit_pull_session',
      'get_committed_pull_reveal',
      'cancel_pull_session',
    ]) {
      const wrapper = functionSql('public', name)
      expect(wrapper).not.toBe('')
      expect(wrapper).toMatch(/security definer/i)
      expect(wrapper).toContain("set search_path = ''")
      expect(wrapper).not.toMatch(/p_user_id uuid/i)
      expect(wrapper).toMatch(
        /caller_user_id := private\.require_non_anonymous_user\(\)/i,
      )
      expect(sql).toMatch(new RegExp(
        `revoke all on function public\\.${name}\\(uuid\\)[\\s\\S]*?from public, anon, authenticated, service_role`,
        'i',
      ))
      expect(sql).toMatch(new RegExp(
        `grant execute on function public\\.${name}\\(uuid\\) to authenticated`,
        'i',
      ))
      expect(sql).not.toMatch(new RegExp(
        `grant execute on function public\\.${name}\\(uuid\\) to (?:public|anon|service_role)`,
        'i',
      ))
    }
    expect(functionSql('public', 'get_committed_pull_reveal'))
      .toMatch(/language plpgsql\s+volatile/i)

    for (const name of [
      'get_committed_pull_reveal_for_user',
      'commit_pull_session_for_user',
      'cancel_pull_session_for_user',
    ]) {
      const engine = functionSql('private', name)
      expect(engine).toContain("set search_path = ''")
      expect(engine).not.toMatch(/security definer/i)
      expect(sql).toMatch(new RegExp(
        `revoke all on function private\\.${name}\\(uuid, uuid\\)[\\s\\S]*?from public, anon, authenticated, service_role`,
        'i',
      ))
    }
  })
})
