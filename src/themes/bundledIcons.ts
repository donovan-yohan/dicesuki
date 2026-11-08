/**
 * Only known, build-time first-party skin icons may be inlined. Public URLs
 * remain stable theme assets; remote packs always retain the <img> path.
 */
const RAW_BY_MODULE_PATH = import.meta.glob([
  '../../public/icons/default/*.svg',
  '../../public/icons/woodland/*.svg',
  '../../public/icons/cyberpunk/*.svg',
  '../../public/icons/monster-dungeon/*.svg',
], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const MODULE_PATH = /^\.\.\/\.\.\/public(\/icons\/(?:default|woodland|cyberpunk|monster-dungeon)\/(?:roll|dice|history|settings|profile|ui-toggle|saved-rolls|shop|rotate|motion)\.svg)$/
const STATIC_TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'])
const STATIC_ATTRIBUTES = new Set([
  'xmlns', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'clip-rule',
  'd', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx', 'ry',
  'x1', 'x2', 'y1', 'y2', 'points', 'transform', 'opacity',
  'fill-opacity', 'stroke-opacity',
])

/** A deliberately narrow static-vector grammar, not a general SVG sanitizer. */
function isStaticIcon(markup: string): boolean {
  if (!markup.startsWith('<svg ') || !markup.endsWith('</svg>')) return false
  if (!markup.includes('xmlns="http://www.w3.org/2000/svg"')) return false
  // No declarations, entities, CSS, links, animation, event attributes or HTML.
  if (/[&!]|url\s*\(/i.test(markup)) return false
  const stack: string[] = []
  let end = 0
  for (const tag of markup.matchAll(/<\/?([a-zA-Z]+)\b([^<>]*)>/g)) {
    if (markup.slice(end, tag.index).trim()) return false
    end = tag.index! + tag[0].length
    const name = tag[1]
    if (!STATIC_TAGS.has(name)) return false
    if (tag[0].startsWith('</')) {
      if (tag[2].trim() || stack.pop() !== name) return false
      continue
    }
    if ((stack.length === 0) !== (name === 'svg')) return false
    const attributes = tag[2].replace(/\/\s*$/, '')
    let attributeEnd = 0
    for (const attribute of attributes.matchAll(/\s+([\w-]+)\s*=\s*"([^"<>]*)"/g)) {
      if (attributes.slice(attributeEnd, attribute.index).trim()) return false
      attributeEnd = attribute.index! + attribute[0].length
      if (!STATIC_ATTRIBUTES.has(attribute[1])) return false
      if (['fill', 'stroke'].includes(attribute[1]) && !['none', 'currentColor'].includes(attribute[2])) return false
      if (attribute[1] === 'xmlns' && attribute[2] !== 'http://www.w3.org/2000/svg') return false
    }
    if (attributes.slice(attributeEnd).trim()) return false
    if (!tag[0].endsWith('/>')) stack.push(name)
  }
  return end === markup.length && stack.length === 0
}

/** Preserve the family directory: every skin intentionally shares filenames. */
export function createBundledIconMap(rawByModulePath: Record<string, string>): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(rawByModulePath).flatMap(([modulePath, raw]) => {
      const match = MODULE_PATH.exec(modulePath)
      const markup = raw.trim()
      return match && isStaticIcon(markup) ? [[match[1], markup]] : []
    }),
  ))
}

export const BUNDLED_ICON_MARKUP = createBundledIconMap(RAW_BY_MODULE_PATH)

export function getBundledIconMarkup(iconUrl: string | null | undefined): string | null {
  if (!iconUrl || !Object.prototype.hasOwnProperty.call(BUNDLED_ICON_MARKUP, iconUrl)) return null
  return BUNDLED_ICON_MARKUP[iconUrl]
}
