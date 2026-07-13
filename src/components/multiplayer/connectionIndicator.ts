import type { ConnectionStatus } from '../../store/useMultiplayerStore'

export interface ConnectionIndicator {
  color: string
  label: string
}

/** Maps a connection status to a roster dot color + accessible label. */
export function connectionIndicator(status: ConnectionStatus): ConnectionIndicator {
  switch (status) {
    case 'connected':
      return { color: '#34d399', label: 'Connected' }
    case 'connecting':
      return { color: '#fbbf24', label: 'Connecting' }
    case 'error':
      return { color: '#f87171', label: 'Connection error' }
    case 'disconnected':
    default:
      return { color: '#9ca3af', label: 'Disconnected' }
  }
}
