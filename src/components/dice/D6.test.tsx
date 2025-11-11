import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { D6 } from './D6'

describe('D6 Component', () => {
  const renderD6 = (props = {}) => {
    return render(
      <Canvas>
        <Physics>
          <D6 {...props} />
        </Physics>
      </Canvas>
    )
  }

  it('should render without crashing', () => {
    expect(() => renderD6()).not.toThrow()
  })

  it('should accept position prop', () => {
    expect(() => renderD6({ position: [0, 5, 0] })).not.toThrow()
  })

  it('should accept rotation prop', () => {
    expect(() => renderD6({ rotation: [0, Math.PI / 4, 0] })).not.toThrow()
  })

  it('should accept size prop', () => {
    expect(() => renderD6({ size: 2 })).not.toThrow()
  })

  it('should accept color prop', () => {
    expect(() => renderD6({ color: 'blue' })).not.toThrow()
  })

  it('should accept onRest callback prop', () => {
    const onRest = () => {}
    expect(() => renderD6({ onRest })).not.toThrow()
  })
})
