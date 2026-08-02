import { existsSync, readFileSync, statSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { HERO_ENVIRONMENT_MAP_URL, TABLE_ENVIRONMENT_MAP_URL } from './environmentMaps'

/**
 * Fail-closed guard for the self-hosted HDR environment maps (issue #222).
 *
 * Self-hosting only buys anything if three things stay true together, and each
 * fails silently on its own: the file has to exist, it has to be a real HDR,
 * and the service worker has to precache it. Miss the last one and the app
 * still works online while every offline boot quietly loses image-based
 * lighting — the exact regression this issue existed to fix, invisible to every
 * other test in the suite because nothing renders an HDR in jsdom.
 */

const repoRoot = resolve(__dirname, '../..')

const MAPS = [
  { name: 'table (Scene)', url: TABLE_ENVIRONMENT_MAP_URL },
  { name: 'hero (HeroDieInspector)', url: HERO_ENVIRONMENT_MAP_URL },
]

/** Radiance `.hdr` magic — what `RGBELoader` requires to parse the file. */
const RADIANCE_MAGIC = '#?RADIANCE'

/**
 * Total precache budget for `public/textures/env/`. Precached bytes are
 * downloaded by every user at install time, so growth here is a real cost and
 * should be a deliberate decision, not a drive-by. Current usage is ~3.2MB.
 */
const MAX_TOTAL_BYTES = 5 * 1024 * 1024

/** Read a single capture group out of `vite.config.ts`'s source text. */
function viteConfigMatch(pattern: RegExp): string | undefined {
  return readFileSync(resolve(repoRoot, 'vite.config.ts'), 'utf8').match(pattern)?.[1]
}

describe('self-hosted HDR environment maps', () => {
  it.each(MAPS)('$name map is served from our own origin', ({ url }) => {
    expect(url.startsWith('/')).toBe(true)
    expect(url).not.toMatch(/^https?:/)
  })

  it.each(MAPS)('$name map exists on disk and is a real Radiance HDR', ({ url }) => {
    const file = resolve(repoRoot, 'public', url.replace(/^\//, ''))

    expect(existsSync(file), `missing HDR asset: ${file}`).toBe(true)
    expect(readFileSync(file).subarray(0, RADIANCE_MAGIC.length).toString('ascii')).toBe(
      RADIANCE_MAGIC,
    )
  })

  it('keeps the precached HDR payload within budget', () => {
    const total = MAPS.reduce(
      (sum, { url }) => sum + statSync(resolve(repoRoot, 'public', url.replace(/^\//, ''))).size,
      0,
    )

    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
  })

  it('is precached by the service worker', () => {
    const globPatterns = viteConfigMatch(/globPatterns:\s*\[([^\]]*)\]/)

    expect(globPatterns, 'workbox.globPatterns not found in vite.config.ts').toBeDefined()
    // Precache, not runtime-cache: an offline first boot must get full lighting.
    expect(globPatterns).toMatch(/\bhdr\b/)
    // A negated entry (`'!**/*.hdr'`) would still contain "hdr" while excluding
    // the maps, so the check above would pass on a build that ships without them.
    expect(globPatterns).not.toContain('!')
    for (const { url } of MAPS) {
      expect(url.endsWith('.hdr'), `${url} would not match the hdr precache glob`).toBe(true)
    }
  })

  it('keeps every map under workbox\'s per-file precache ceiling', () => {
    // Workbox drops an oversized file from the precache SILENTLY — no build
    // error, no warning that reaches CI. The pair budget above cannot catch it:
    // one 4.5 MiB map passes a 5 MiB total and still never reaches the cache.
    const expression = viteConfigMatch(/maximumFileSizeToCacheInBytes:\s*([\d*\s]+),/)
    expect(expression, 'maximumFileSizeToCacheInBytes not found').toBeDefined()

    const ceiling = expression!.split('*').reduce((total, term) => total * Number(term.trim()), 1)
    expect(Number.isFinite(ceiling) && ceiling > 0).toBe(true)

    for (const { url } of MAPS) {
      const size = statSync(resolve(repoRoot, 'public', url.replace(/^\//, ''))).size
      expect(size, `${url} exceeds the ceiling and workbox would drop it silently`).toBeLessThanOrEqual(
        ceiling,
      )
    }
  })

  /**
   * The assertion that actually protects offline lighting.
   *
   * Everything above can pass while the app is back on drei's CDN: swap
   * `files={…}` for `preset="night"`, drop the now-unused import, and the
   * constants still exist, the files are still valid HDRs, and the precache glob
   * still says `hdr` — green suite, dim offline boot. Pin the call sites.
   */
  it.each([
    { name: 'Scene (table)', file: 'src/components/Scene.tsx', constant: 'TABLE_ENVIRONMENT_MAP_URL' },
    {
      name: 'HeroDieInspector (stage)',
      file: 'src/components/panels/HeroDieInspector.tsx',
      constant: 'HERO_ENVIRONMENT_MAP_URL',
    },
  ])('$name lights from the self-hosted file, not a drei preset', ({ file, constant }) => {
    const source = readFileSync(resolve(repoRoot, file), 'utf8')

    expect(source).toMatch(new RegExp(`<Environment\\s+files=\\{${constant}\\}`))
    // `preset=` is the regression: it sends drei back to raw.githack.com at runtime.
    expect(source).not.toMatch(/<Environment[^>]*\spreset=/)
  })
})
