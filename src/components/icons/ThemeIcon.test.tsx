import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
