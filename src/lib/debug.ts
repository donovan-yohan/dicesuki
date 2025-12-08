/**
 * Debug Utilities
 *
 * Provides conditional logging that only outputs in development mode.
 * All debug logs are silenced in production builds.
 */

const isDev = import.meta.env.DEV

/**
 * Debug namespaces that can be enabled/disabled
 * Set localStorage['debug'] = 'namespace1,namespace2' to enable specific namespaces
 * Set localStorage['debug'] = '*' to enable all
 */
function isNamespaceEnabled(namespace: string): boolean {
  if (!isDev) return false

  try {
    const debugConfig = localStorage.getItem('debug')
    if (!debugConfig) return false
    if (debugConfig === '*') return true
    return debugConfig.split(',').some((ns) => namespace.startsWith(ns.trim()))
  } catch {
    return false
  }
}

/**
 * Create a namespaced debug logger
 *
 * Usage:
 * ```ts
 * const debug = createDebugLogger('Dice')
 * debug.log('Rolling dice') // Only logs if localStorage['debug'] includes 'Dice'
 * ```
 */
export function createDebugLogger(namespace: string) {
  const prefix = `[${namespace}]`

  return {
    log: (...args: unknown[]) => {
      if (isNamespaceEnabled(namespace)) {
        console.log(prefix, ...args)
      }
    },
    warn: (...args: unknown[]) => {
      if (isNamespaceEnabled(namespace)) {
        console.warn(prefix, ...args)
      }
    },
    error: (...args: unknown[]) => {
      // Errors always log in dev mode
      if (isDev) {
        console.error(prefix, ...args)
      }
    },
    info: (...args: unknown[]) => {
      if (isNamespaceEnabled(namespace)) {
        console.info(prefix, ...args)
      }
    },
  }
}

/**
 * Simple dev-only logger (no namespace filtering)
 * Use for important dev logs that should always show in development
 */
export const devLog = {
  log: (...args: unknown[]) => {
    if (isDev) console.log(...args)
  },
  warn: (...args: unknown[]) => {
    if (isDev) console.warn(...args)
  },
  error: (...args: unknown[]) => {
    if (isDev) console.error(...args)
  },
  info: (...args: unknown[]) => {
    if (isDev) console.info(...args)
  },
}

/**
 * Log categories for the app
 * Enable with: localStorage.setItem('debug', 'Dice,Scene,Store')
 */
export const DEBUG_NAMESPACES = {
  DICE: 'Dice',
  SCENE: 'Scene',
  STORE: 'Store',
  INVENTORY: 'Inventory',
  CUSTOM_DICE: 'CustomDice',
  PHYSICS: 'Physics',
  SPAWNER: 'Spawner',
  PRODUCTION_DICE: 'ProductionDice',
  DEVICE_MOTION: 'DeviceMotion',
  THEME: 'Theme',
} as const
