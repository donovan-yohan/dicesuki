import { render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SceneAssetErrorBoundary } from './SceneAssetErrorBoundary'

function RejectedAsset(): never {
  throw new Error('GLB request failed')
}

describe('SceneAssetErrorBoundary', () => {
  it('renders the procedural fallback when a lazy asset rejects', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(
        <SceneAssetErrorBoundary
          resetKey="/dice/cozy/model.glb"
          fallback={<div>procedural fallback</div>}
        >
          <RejectedAsset />
        </SceneAssetErrorBoundary>,
      )
      expect(screen.getByText('procedural fallback')).toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('is transparent on the happy path — the asset renders, no fallback does', () => {
    render(
      <SceneAssetErrorBoundary resetKey="night" fallback={<div>degraded lighting</div>}>
        <Suspense fallback={<div>still loading</div>}>
          <div>hdr environment</div>
        </Suspense>
      </SceneAssetErrorBoundary>,
    )

    expect(screen.getByText('hdr environment')).toBeInTheDocument()
    expect(screen.queryByText('degraded lighting')).not.toBeInTheDocument()
    expect(screen.queryByText('still loading')).not.toBeInTheDocument()
  })

  it('renders nothing when a decorative asset rejects and the fallback is null', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { container } = render(
        <SceneAssetErrorBoundary resetKey="night" fallback={null}>
          <RejectedAsset />
        </SceneAssetErrorBoundary>,
      )
      expect(container).toBeEmptyDOMElement()
    } finally {
      consoleError.mockRestore()
    }
  })
})
