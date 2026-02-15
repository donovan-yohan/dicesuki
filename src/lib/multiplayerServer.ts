const DEFAULT_WS_URL = 'ws://localhost:8080'

/**
 * Returns the WebSocket URL for the multiplayer server.
 * Reads from VITE_MULTIPLAYER_SERVER_URL environment variable,
 * falling back to localhost for development.
 */
export function getWsServerUrl(): string {
  try {
    return import.meta.env?.VITE_MULTIPLAYER_SERVER_URL || DEFAULT_WS_URL
  } catch {
    return DEFAULT_WS_URL
  }
}

/**
 * Returns the HTTP URL for the multiplayer server REST API.
 * Converts the WebSocket URL (ws:// or wss://) to HTTP (http:// or https://).
 */
export function getHttpServerUrl(): string {
  return getWsServerUrl()
    .replace('ws://', 'http://')
    .replace('wss://', 'https://')
}
