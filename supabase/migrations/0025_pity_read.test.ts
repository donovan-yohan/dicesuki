import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0025_pity_read.sql',
)
const behavioralPath = resolve(
  process.cwd(),
  'supabase/tests/0025_pity_read.test.sql',
)

let sql = ''
let behavioralSql = ''

beforeAll(async () => {
  [sql, behavioralSql] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(behavioralPath, 'utf8'),
  ])
})

function functionSql(schema: 'public' | 'private', name: string) {
  return (
    sql.match(
      new RegExp(
        `create or replace function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
        'i',
      ),
    )?.[0] ?? ''
  )
}

describe('0025 server-owned pull pity read', () => {
  it('resolves exactly one maximum append-only family version', () => {
    const engine = functionSql('private', 'get_pull_pity_for_user')

    expect(engine).toMatch(
      /select max\(versions\.banner_version\)[\s\S]*?into active_banner_version[\s\S]*?from public\.pull_banner_versions as versions[\s\S]*?versions\.banner_family_id = p_banner_family_id/i,
    )
    expect(engine).toMatch(
      /select count\(\*\)[\s\S]*?into active_banner_count[\s\S]*?versions\.banner_family_id = p_banner_family_id[\s\S]*?versions\.banner_version = active_banner_version/i,
    )
    expect(engine).toMatch(
      /if active_banner_count <> 1 then[\s\S]*?Ambiguous active pull banner version for family[\s\S]*?errcode = '22023'/i,
    )
    expect(engine).toMatch(
      /select versions\.\*[\s\S]*?into strict active_banner[\s\S]*?versions\.banner_version = active_banner_version/i,
    )
    expect(engine).not.toMatch(/order by[\s\S]*?versions\.id/i)
    expect(engine).toMatch(
      /active_banner\.rare_hard_guarantee_pull[\s\S]*?active_banner\.epic_hard_guarantee_pull[\s\S]*?active_banner\.selected_hard_guarantee_pull/i,
    )
    expect(engine).toMatch(
      /active_banner\.soft_pity_model[\s\S]*?active_banner\.soft_pity_start_pull[\s\S]*?active_banner\.soft_pity_per_pull_increment/i,
    )
    expect(engine).toMatch(
      /Unknown or unversioned pull banner family[\s\S]*?errcode = '22023'/i,
    )
  })

  it('returns zero counters without creating an account when guarantee state is absent', () => {
    const engine = functionSql('private', 'get_pull_pity_for_user')

    expect(engine).toMatch(
      /left join public\.wallet_accounts as account[\s\S]*?account\.user_id = p_user_id/i,
    )
    expect(engine).toMatch(
      /left join public\.pull_guarantee_states as guarantee[\s\S]*?guarantee\.account_id = account\.id[\s\S]*?guarantee\.user_id = p_user_id[\s\S]*?guarantee\.banner_family_id = active_banner\.banner_family_id/i,
    )
    for (const counter of [
      'total_pulls',
      'rare_misses',
      'epic_misses',
      'selected_misses',
    ]) {
      expect(engine).toMatch(
        new RegExp(`coalesce\\(guarantee\\.${counter}, 0::bigint\\)`, 'i'),
      )
    }
    expect(engine).not.toMatch(
      /\b(?:insert|update|delete|merge|truncate)\b/i,
    )
  })

  it('keeps both layers stable, fully qualified, and free of lock-taking reads', () => {
    const engine = functionSql('private', 'get_pull_pity_for_user')
    const wrapper = functionSql('public', 'get_my_pull_pity')

    for (const fn of [engine, wrapper]) {
      expect(fn).toMatch(/\bstable\b/i)
      expect(fn).toMatch(/\bsecurity definer\b/i)
      expect(fn).toContain("set search_path = ''")
      expect(fn).not.toMatch(
        /for (?:update|no key update|share|key share)|advisory.*lock|lock table/i,
      )
      expect(fn).not.toMatch(
        /\b(?:insert|update|delete|merge|truncate)\b/i,
      )
    }
  })

  it('exposes only an authenticated self-derived wrapper', () => {
    const wrapper = functionSql('public', 'get_my_pull_pity')

    expect(wrapper).not.toMatch(/p_user_id uuid/i)
    expect(wrapper).toMatch(
      /caller_user_id := private\.require_non_anonymous_user\(\)/i,
    )
    expect(wrapper).toMatch(
      /private\.get_pull_pity_for_user\(\s*caller_user_id,\s*p_banner_family_id\s*\)/i,
    )
    expect(sql).toMatch(
      /revoke all on function private\.get_pull_pity_for_user\(uuid, text\)\s+from public, anon, authenticated, service_role/i,
    )
    expect(sql).toMatch(
      /revoke all on function public\.get_my_pull_pity\(text\)\s+from public, anon, authenticated, service_role/i,
    )
    expect(sql).toMatch(
      /grant execute on function public\.get_my_pull_pity\(text\)\s+to authenticated/i,
    )
    expect(sql).not.toMatch(
      /grant execute on function (?:private\.)?get_(?:my_)?pull_pity[^;]*to (?:public|anon|service_role)/i,
    )
  })

  it('covers zero state, lifecycle projection, isolation, family errors, anon denial, and soft pity', () => {
    expect(behavioralSql).toMatch(
      /public\.prepare_pull\([\s\S]*?public\.commit_pull_session\(/i,
    )
    expect(behavioralSql).toMatch(
      /total_pulls_projected[\s\S]*?rare_misses_projected[\s\S]*?epic_misses_projected[\s\S]*?selected_misses_projected/i,
    )
    expect(behavioralSql).toMatch(
      /cross-user pity counters leaked/i,
    )
    expect(behavioralSql).toMatch(
      /when sqlstate '22023'/i,
    )
    expect(behavioralSql).toMatch(
      /slice15-ambiguous-family[\s\S]*?Ambiguous active pity version unexpectedly succeeded/i,
    )
    expect(behavioralSql).toMatch(
      /when insufficient_privilege/i,
    )
    expect(behavioralSql).toContain("'linear-rate-ramp'")
    expect(behavioralSql).toMatch(
      /soft_pity_model is not null[\s\S]*?soft_pity_start_pull is not null[\s\S]*?soft_pity_per_pull_increment is not null/i,
    )
  })
})
