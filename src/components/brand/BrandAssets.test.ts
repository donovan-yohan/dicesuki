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
  it('keeps padding beyond the illustrated icon contour without pale fringe paths', async () => {
    const { document, svg } = await readSvg('brand/dicesuki-icon.svg')
    const [x, , width] = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number)
    const paths = [...document.querySelectorAll('path')]

    expect(x + width).toBeGreaterThanOrEqual(620)
    expect(
      paths.some(
        (path) =>
          path.getAttribute('fill') === '#F8E2E0' &&
          ['translate(536,277)', 'translate(366,246)'].includes(
            path.getAttribute('transform') ?? '',
          ),
      ),
    ).toBe(false)
  })

  it('cuts the d and e counters directly into the visible letter paths', async () => {
    const { document, svg } = await readSvg('brand/dicesuki-wordmark.svg')
    const visibleGroup = [...svg.children].find((child) => child.localName === 'g')
    const cutoutPaths = [...(visibleGroup?.querySelectorAll('path[fill-rule="evenodd"]') ?? [])]

    expect(document.querySelector('mask')).toBeNull()
    expect(visibleGroup?.hasAttribute('mask')).toBe(false)
    expect(cutoutPaths).toHaveLength(4)
    expect(cutoutPaths.map((path) => path.getAttribute('transform')).sort()).toEqual([
      'translate(290,47)',
      'translate(290,47)',
      'translate(913,195)',
      'translate(913,195)',
    ])
    // The base d/e paths each contain one outline plus one counter. Their two
    // highlight paths each contain two overlapping source subpaths, so they need
    // two counter copies to keep the even-odd result transparent.
    expect(
      cutoutPaths
        .map((path) => ((path.getAttribute('d') ?? '').match(/M/g) ?? []).length)
        .sort((a, b) => a - b),
    ).toEqual([2, 2, 4, 4])
  })

  it('keeps the corrected vectors in the lockup and square favicon', async () => {
    const { document: lockup } = await readSvg('brand/dicesuki-lockup.svg')
    const { svg: favicon, document: faviconDocument } = await readSvg('icons/favicon.svg')

    expect(lockup.querySelector('mask')).toBeNull()
    expect(lockup.querySelectorAll('path[fill-rule="evenodd"]')).toHaveLength(4)
    expect(favicon.getAttribute('viewBox')).toBe('22 27 600 600')
    expect(faviconDocument.querySelector('rect')?.getAttribute('fill')).toBe('#f3ebe2')
    expect(faviconDocument.querySelector('path[transform="translate(536,277)"]')).toBeNull()
    expect(faviconDocument.querySelector('path[transform="translate(366,246)"]')).toBeNull()
  })
})
