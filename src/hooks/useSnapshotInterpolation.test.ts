import { describe, it, expect } from 'vitest'

describe('useSnapshotInterpolation', () => {
  it('should be importable', async () => {
    // This hook uses useFrame which requires R3F context
    // Just verify the module exports correctly
    const mod = await import('./useSnapshotInterpolation')
    expect(mod.useSnapshotInterpolation).toBeDefined()
  })
})
