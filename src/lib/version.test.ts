/**
 * Tests for version utility
 */

import { describe, it, expect, vi } from 'vitest'

describe('version', () => {
  describe('getAppVersion', () => {
    it('should return version from environment variable', async () => {
      vi.stubEnv('VITE_APP_VERSION', '1.2.3')

      // Re-import to get fresh module with stubbed env
      const { getAppVersion } = await import('./version')
      expect(getAppVersion()).toBe('1.2.3')

      vi.unstubAllEnvs()
    })

    it('should return current package version when available', async () => {
      // Test with actual package.json version (0.1.0)
      // This will use the default Vite config which reads from package.json
      const { getAppVersion } = await import('./version')
      const version = getAppVersion()

      // Version should be a valid semver string
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    })
  })

  describe('getFormattedVersion', () => {
    it('should return formatted version with v prefix', async () => {
      vi.stubEnv('VITE_APP_VERSION', '1.2.3')

      const { getFormattedVersion } = await import('./version')
      expect(getFormattedVersion()).toBe('v1.2.3')

      vi.unstubAllEnvs()
    })

    it('should format version correctly', async () => {
      const { getFormattedVersion } = await import('./version')
      const formatted = getFormattedVersion()

      // Should start with 'v' and be followed by semver
      expect(formatted).toMatch(/^v\d+\.\d+\.\d+$/)
    })
  })
})
