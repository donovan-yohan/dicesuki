/**
 * Bundled default-theme icon markup.
 *
 * # Why this exists
 *
 * The default theme's icons ship as real files under `public/icons/default/`,
 * so `theme.assets.icons.*` stays a plain, stable URL (`/icons/default/x.svg`)
 * exactly like a theme-supplied remote URL. That keeps the token layer
 * declarative and keeps the files reachable at a fixed public path.
 *
 * An `<img src="…svg">`, however, renders the SVG in its **own** document. Our
 * icons are `stroke="currentColor"` line art, and inside that separate document
 * `currentColor` resolves against the image document's initial colour (black),
 * *not* against the `color` of the HUD button that contains the `<img>`. On the
 * dark HUD surfaces that means near-invisible black-on-charcoal glyphs, and the
 * active/accent states would never tint.
 *
 * So the same first-party files are also read at build time (Vite `?raw`) and
 * inlined into the DOM by `ThemeIcon`, where `currentColor` inherits from the
 * button as intended.
 *
 * # The split
 *
 * - **Bundled default icons** (this map): inlined as real SVG nodes, inherit
 *   `currentColor`.
 * - **Any other theme asset URL** (a future theme pack, a remote/CDN URL): keeps
 *   the existing `<img src>` path untouched. It is never fetched-and-inlined —
 *   only build-time-known, first-party markup is ever handed to
 *   `dangerouslySetInnerHTML`.
 */

/**
 * Raw SVG source for every file in `public/icons/default/`, keyed by the module
 * path Vite resolved it from.
 */
const RAW_BY_MODULE_PATH = import.meta.glob('../../public/icons/default/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Public URL prefix the emitted files are served from. */
const PUBLIC_PREFIX = '/icons/default/'

/**
 * Bundled icon markup keyed by the *public URL* a theme token points at, e.g.
 * `'/icons/default/saved-rolls.svg'`.
 */
export const BUNDLED_ICON_MARKUP: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(RAW_BY_MODULE_PATH).map(([modulePath, markup]) => {
      const fileName = modulePath.slice(modulePath.lastIndexOf('/') + 1)
      return [`${PUBLIC_PREFIX}${fileName}`, markup.trim()]
    })
  )
)

/**
 * Inline markup for a first-party bundled icon, or `null` for anything else
 * (remote/theme-supplied URLs, which stay on the `<img>` path).
 */
export function getBundledIconMarkup(iconUrl: string | null | undefined): string | null {
  if (!iconUrl) return null
  return BUNDLED_ICON_MARKUP[iconUrl] ?? null
}
