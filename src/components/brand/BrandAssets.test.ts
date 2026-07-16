import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const publicDir = resolve(process.cwd(), 'public')

async function readSvg(relativePath: string) {
  const source = await readFile(resolve(publicDir, relativePath), 'utf8')
  const document = new DOMParser().parseFromString(source, 'image/svg+xml')
  const svg = document.documentElement

  expect(svg.localName).toBe('svg')
  expect(document.querySelector('parsererror')).toBeNull()
  expect(document.querySelector('image')).toBeNull()
  expect(source).not.toContain('data:image')

  return { document, svg }
}

describe('Dicesuki brand vectors', () => {
  it('keeps padding beyond the illustrated icon contour', async () => {
    const { svg } = await readSvg('brand/dicesuki-icon.svg')
    const [x, , width] = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number)

    expect(x + width).toBeGreaterThanOrEqual(620)
  })

  it('uses real transparent masks for the d and e counters', async () => {
    const { document, svg } = await readSvg('brand/dicesuki-wordmark.svg')
    const mask = document.querySelector('#dicesuki-wordmark-counters')
    const visibleGroup = [...svg.children].find((child) => child.localName === 'g')

    expect(mask).not.toBeNull()
    expect(visibleGroup?.getAttribute('mask')).toBe('url(#dicesuki-wordmark-counters)')

    const cutouts = [...(mask?.querySelectorAll('path') ?? [])]
    expect(cutouts.map((path) => path.getAttribute('transform'))).toEqual([
      'translate(237,286.5625)',
      'translate(891.0625,267.5625)',
    ])
    expect(cutouts.every((path) => path.getAttribute('fill') === '#000')).toBe(true)

    const visibleTransforms = [...(visibleGroup?.querySelectorAll('path') ?? [])].map((path) =>
      path.getAttribute('transform'),
    )
    expect(visibleTransforms).not.toContain('translate(237,286.5625)')
    expect(visibleTransforms).not.toContain('translate(891.0625,267.5625)')
  })

  it('keeps the corrected vectors in the lockup and square favicon', async () => {
    const { document: lockup } = await readSvg('brand/dicesuki-lockup.svg')
    const { svg: favicon, document: faviconDocument } = await readSvg('icons/favicon.svg')

    expect(lockup.querySelector('#dicesuki-wordmark-counters')).not.toBeNull()
    expect(favicon.getAttribute('viewBox')).toBe('22 27 600 600')
    expect(faviconDocument.querySelector('rect')?.getAttribute('fill')).toBe('#f3ebe2')
  })
})
