/**
 * Theme Icon
 *
 * Renders one `theme.assets.icons.*` value, choosing the rendering that keeps
 * the glyph the same colour as its button:
 *
 * - A **bundled default-theme icon** (`/icons/default/*.svg`) is inlined as a
 *   real SVG node, so its `stroke="currentColor"` inherits the button's `color`
 *   — including the accent/active states.
 * - **Any other URL** (a theme pack, a remote/CDN asset) renders as `<img src>`
 *   exactly as before. Remote markup is never fetched or inlined.
 *
 * See `src/themes/bundledIcons.ts` for why the split exists.
 */

import { memo } from 'react'
import { getBundledIconMarkup } from '../../themes/bundledIcons'

export interface ThemeIconProps {
  /** Theme asset URL, e.g. `/icons/default/shop.svg`. */
  src: string
  /** Accessible label. Buttons already carry an `aria-label`, so this is the alt text. */
  label: string
  /** Sizing classes for the icon box, e.g. `w-5 h-5`. */
  className?: string
  style?: React.CSSProperties
}

export const ThemeIcon = memo(function ThemeIcon({
  src,
  label,
  className,
  style,
}: ThemeIconProps) {
  const markup = getBundledIconMarkup(src)

  if (markup === null) {
    return <img src={src} alt={label} className={className} style={style} />
  }

  return (
    <span
      role="img"
      aria-label={label}
      data-theme-icon={src}
      className={className ? `theme-icon ${className}` : 'theme-icon'}
      style={style}
      // Build-time, first-party markup only — never a remote document.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
})
