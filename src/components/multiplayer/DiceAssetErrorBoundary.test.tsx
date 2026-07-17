import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DiceAssetErrorBoundary } from './DiceAssetErrorBoundary'

function RejectedAsset(): never {
  throw new Error('GLB request failed')
}

describe('DiceAssetErrorBoundary', () => {
  it('renders the procedural fallback when a lazy asset rejects', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(
        <DiceAssetErrorBoundary
          resetKey="/dice/cozy/model.glb"
          fallback={<div>procedural fallback</div>}
        >
          <RejectedAsset />
        </DiceAssetErrorBoundary>,
      )
      expect(screen.getByText('procedural fallback')).toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
  })
})
