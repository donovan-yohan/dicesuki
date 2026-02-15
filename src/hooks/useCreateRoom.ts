import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getHttpServerUrl } from '../lib/multiplayerServer'

interface UseCreateRoomResult {
  isCreating: boolean
  error: string | null
  createRoom: () => Promise<void>
  clearError: () => void
}

/**
 * Hook that handles creating a multiplayer room via the server REST API
 * and navigating to the room page on success.
 */
export function useCreateRoom(): UseCreateRoomResult {
  const navigate = useNavigate()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createRoom(): Promise<void> {
    setIsCreating(true)
    setError(null)
    try {
      const response = await fetch(`${getHttpServerUrl()}/api/rooms`, { method: 'POST' })
      if (!response.ok) {
        throw new Error('Failed to create room')
      }
      const data = await response.json()
      navigate(`/room/${data.roomId}`)
    } catch (err) {
      console.error('Failed to create room:', err)
      setError('Could not create room. The server may be starting up — try again in a moment.')
    } finally {
      setIsCreating(false)
    }
  }

  function clearError() {
    setError(null)
  }

  return { isCreating, error, createRoom, clearError }
}
