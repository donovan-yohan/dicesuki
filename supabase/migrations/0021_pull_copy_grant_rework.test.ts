import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0021_pull_copy_grant_rework.sql',
)
const canonicalPath = resolve(
  process.cwd(),
  'supabase/migrations/0018_soft_pity_ramp.sql',
)
const inheritedBehavioralPath = resolve(
  process.cwd(),
  'supabase/tests/0011_earned_pull_preparation.test.sql',
)

let sql = ''
let canonicalSql = ''
let inheritedBehavioralSql = ''

beforeAll(async () => {
  [sql, canonicalSql, inheritedBehavioralSql] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(canonicalPath, 'utf8'),
    readFile(inheritedBehavioralPath, 'utf8'),
  ])
})

function functionSqlFrom(
  source: string,
  schema: 'public' | 'private',
  name: string,
) {
  return source.match(
    new RegExp(
      `create or replace function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      'i',
    ),
  )?.[0] ?? ''
}

function functionSql(schema: 'public' | 'private', name: string) {
  return functionSqlFrom(sql, schema, name)
}

function restoreEntitlementPredicates(source: string) {
  return source
    .replaceAll(
      'from public.dice_copies as copies',
      'from public.user_entitlements as entitlements',
    )
    .replaceAll('copies.user_id', 'entitlements.user_id')
    .replaceAll('copies.catalog_item_id', 'entitlements.catalog_item_id')
    .replace(/\n\s+and copies\.scrapped_at is null/g, '')
}

describe('0021 pull copy-grant rework', () => {
  it('changes only the three ownership predicates in the 0018 prepare body', () => {
    const prepare = functionSql('private', 'prepare_pull_for_user')
    const canonical = functionSqlFrom(
      canonicalSql,
      'private',
      'prepare_pull_for_user',
    )

    expect(prepare).not.toBe('')
    expect(canonical).not.toBe('')
    expect(
      prepare.match(/from public\.dice_copies as copies/gi) ?? [],
    ).toHaveLength(3)
    expect(
      prepare.match(/and copies\.scrapped_at is null/gi) ?? [],
    ).toHaveLength(3)
    expect(prepare).not.toMatch(/public\.user_entitlements/i)
    expect(restoreEntitlementPredicates(prepare)).toBe(canonical)
  })

  it('documents and implements the zero-unowned selected-target fallback', () => {
    const prepare = functionSql('private', 'prepare_pull_for_user')

    expect(sql).toMatch(
      /Spec section 1\.6 conservative zero-target rule:[\s\S]*?selected_item stays NULL[\s\S]*?neither selected hard pity[\s\S]*?nor soft pity arms/i,
    )
    expect(prepare).toMatch(
      /selected_due := selected_item\.catalog_item_id is not null and\s+selected_cursor \+ 1 >= banner\.selected_hard_guarantee_pull/i,
    )
    expect(prepare).toMatch(
      /if selected_due then[\s\S]*?resolution_reason := 'selected-guarantee';\s+else[\s\S]*?if not soft_pity_upgraded then\s+if epic_due then[\s\S]*?elsif rare_due then[\s\S]*?else\s+minimum_rank := 0;/i,
    )
  })

  it('grants every sealed result as an idempotent pull copy', () => {
    const commit = functionSql('private', 'commit_pull_session_for_user')
    const grantLoop = commit.match(
      /for sealed_result in[\s\S]*?end loop;/i,
    )?.[0] ?? ''

    expect(grantLoop).toMatch(
      /from public\.sealed_pull_results\s+where session_id = target_session\.id\s+order by result_position/i,
    )
    expect(grantLoop).not.toMatch(/not is_duplicate/i)
    expect(grantLoop).toMatch(
      /public\.record_dice_copy_grant\(\s*p_user_id,\s*sealed_result\.catalog_item_id,\s*'pull'/i,
    )
    expect(grantLoop).toMatch(
      /'pull-copy-grant:' \|\| target_session\.id::text \|\|\s*':result:' \|\| sealed_result\.result_position::text/i,
    )
    expect(commit).not.toMatch(/insert into public\.user_entitlements/i)
  })

  it('keeps one aggregated earned-Dust append for duplicate results', () => {
    const commit = functionSql('private', 'commit_pull_session_for_user')

    expect(commit).toMatch(
      /sum\(results\.duplicate_dust_amount\)[\s\S]*?results\.is_duplicate/i,
    )
    expect(commit).toMatch(
      /public\.append_wallet_ledger_entry\(\s*p_user_id,\s*'dust',\s*'earned',\s*duplicate_dust_total,\s*'pull\.commit\.duplicate_dust\.credit'/i,
    )
    expect(
      commit.match(/'pull\.commit\.duplicate_dust\.credit'/gi) ?? [],
    ).toHaveLength(1)
  })

  it('returns the immutable first-copy latch by deterministic grant key', () => {
    const reveal = functionSql(
      'private',
      'get_committed_pull_reveal_for_user',
    )

    expect(reveal).toMatch(
      /'is_first_copy', \(\s*select copies\.is_first_copy\s+from public\.dice_copies as copies/i,
    )
    expect(reveal).toMatch(
      /copies\.grant_idempotency_key =\s*'pull-copy-grant:' \|\| target_session\.id::text \|\|\s*':result:' \|\| results\.result_position::text/i,
    )
  })

  it('guards both copy grants and scraps with the account-wide live hold', () => {
    const grantGuard = functionSql(
      'private',
      'preserve_pull_ownership_snapshot',
    )
    const scrap = functionSql('private', 'record_dice_copy_scrap')

    expect(sql).toMatch(
      /create trigger dice_copies_preserve_pull_snapshot\s+before insert on public\.dice_copies[\s\S]*?private\.preserve_pull_ownership_snapshot\(\)/i,
    )
    expect(grantGuard).toMatch(
      /target_account := private\.lock_wallet_account\(new\.user_id\)[\s\S]*?sessions\.account_id = target_account\.id/i,
    )
    expect(grantGuard).toMatch(
      /sessions\.expires_at > decision_at[\s\S]*?not exists \([\s\S]*?public\.pull_session_transitions/i,
    )
    expect(scrap).toMatch(
      /from public\.wallet_accounts\s+where user_id = p_user_id\s+for update/i,
    )
    expect(scrap.indexOf('return existing_copy'))
      .toBeLessThan(scrap.indexOf('decision_at := clock_timestamp()'))
    expect(scrap).toMatch(
      /sessions\.account_id = target_account\.id[\s\S]*?sessions\.expires_at > decision_at[\s\S]*?not exists \([\s\S]*?public\.pull_session_transitions[\s\S]*?errcode = '55000'/i,
    )
    expect(sql).toMatch(
      /Direct purchases remain guarded; committed\/cancelled and expired sessions do not block grants/i,
    )
  })

  it('keeps the inherited 0011 ownership oracle on live copies without dropping its entitlement guard', () => {
    expect(inheritedBehavioralSql).toMatch(
      /public\.record_dice_copy_grant\(\s*'88888888-8888-4888-8888-888888888888',\s*item\.catalog_item_id,\s*'reward'/i,
    )
    expect(inheritedBehavioralSql).toMatch(
      /select 1 from public\.dice_copies as copies\s+where copies\.user_id = results\.user_id\s+and copies\.catalog_item_id = results\.catalog_item_id\s+and copies\.scrapped_at is null/i,
    )
    expect(inheritedBehavioralSql).toMatch(
      /insert into public\.user_entitlements \([\s\S]*?'test\.concurrent-grant'[\s\S]*?'test:blocked-during-hold'[\s\S]*?exception when sqlstate '55000'/i,
    )
  })
})
