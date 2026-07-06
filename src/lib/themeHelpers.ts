/**
 * Theme Helpers
 *
 * Shared utility functions for working with theme assets and tokens.
 */

/**
 * Type guard that checks whether a theme asset path is a valid, non-empty string.
 * Use this before rendering an <img> tag with a theme asset.
 */
export function hasAsset(path: string | null | undefined): path is string {
  return path !== null && path !== undefined && path.length > 0
}
