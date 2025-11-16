/**
 * Version Utility
 *
 * Provides app version information from package.json.
 * Version is injected at build time by Vite.
 */

/**
 * Get the current app version
 * @returns Version string (e.g., "0.1.0")
 */
export function getAppVersion(): string {
  const version = import.meta.env.VITE_APP_VERSION
  return version && version !== '' ? version : '0.0.0'
}

/**
 * Get the formatted version with 'v' prefix
 * @returns Formatted version string (e.g., "v0.1.0")
 */
export function getFormattedVersion(): string {
  return `v${getAppVersion()}`
}
