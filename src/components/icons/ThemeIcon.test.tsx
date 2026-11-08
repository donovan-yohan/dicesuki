import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defaultTheme } from '../../themes/tokens'
import { ThemeIcon } from './ThemeIcon'

describe('ThemeIcon', () => {
  it('inlines a bundled default icon so currentColor inherits the button colour', () => {
    const { container } = render(
      <span style={{ color: 'rgb(1, 2, 3)' }}>
        <ThemeIcon src={defaultTheme.assets.icons.shop!} label="Shop" className="w-7 h-7" />
      </span>
    )

    // An <img> would render the SVG in its own document, where `currentColor`
    // resolves to black rather than the surrounding button's colour. The whole
    // point of the bundled path is that the markup lands in *this* DOM.
    expect(container.querySelector('img')).toBeNull()

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('stroke')).toBe('currentColor')
    expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24')

    // The wrapper carries the sizing classes; `.theme-icon > svg` fills it.
    const wrapper = screen.getByRole('img', { name: 'Shop' })
    expect(wrapper).toHaveClass('theme-icon', 'w-7', 'h-7')
    expect(wrapper.contains(svg)).toBe(true)
  })

  it('keeps a theme-supplied remote URL on the <img> path (never inlined)', () => {
    const remote = 'https://cdn.example.com/themes/spooky/shop.svg'
    const { container } = render(<ThemeIcon src={remote} label="Shop" className="w-7 h-7" />)

    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe(remote)
    expect(img!.getAttribute('alt')).toBe('Shop')
    expect(img).toHaveClass('w-7', 'h-7')
    // Remote markup is never fetched and injected into our DOM.
    expect(container.querySelector('svg')).toBeNull()
  })

  // Source lane has no fabricated art: integration supplies the released files.
  // Run the positive consumer proof for each family actually present at build time.
  describe.each(['woodland', 'cyberpunk', 'monster-dungeon'])('%s assets', (family) => {
    it.skipIf(!existsSync(resolve(process.cwd(), `public/icons/${family}/roll.svg`)))('inlines all ten released slots from their exact public paths', () => {
      const files = ['roll', 'dice', 'history', 'settings', 'profile', 'ui-toggle', 'saved-rolls', 'shop', 'rotate', 'motion']
      const { container } = render(<>{files.map(file => (
        <ThemeIcon key={file} src={`/icons/${family}/${file}.svg`} label={file} className="w-5 h-5" />
      ))}</>)
      expect(container.querySelectorAll('.theme-icon > svg')).toHaveLength(10)
      expect(container.querySelector('img')).toBeNull()
      for (const file of files) {
        expect(screen.getByRole('img', { name: file })).toHaveAttribute('data-theme-icon', `/icons/${family}/${file}.svg`)
      }
    })
  })

  it.each([
    'https://cdn.example.com/icons/woodland/roll.svg',
    '/icons/untrusted/roll.svg',
    '/icons/woodland/roll.svg?source=untrusted',
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
  ])('never injects untrusted markup from %s', (src) => {
    const { container } = render(<ThemeIcon src={src} label="Roll" />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('src', src)
  })

  it('forwards inline styles on both paths', () => {
    const { container: bundled } = render(
      <ThemeIcon
        src={defaultTheme.assets.icons.roll!}
        label="Roll"
        style={{ filter: 'grayscale(100%)' }}
      />
    )
    expect(screen.getByRole('img', { name: 'Roll' })).toHaveStyle({ filter: 'grayscale(100%)' })
    expect(bundled.querySelector('svg')).not.toBeNull()

    const { container: remote } = render(
      <ThemeIcon
        src="https://cdn.example.com/themes/spooky/roll.svg"
        label="Roll"
        style={{ filter: 'grayscale(100%)' }}
      />
    )
    expect(remote.querySelector('img')).toHaveStyle({ filter: 'grayscale(100%)' })
  })
})
