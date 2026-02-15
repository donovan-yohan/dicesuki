import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getHttpServerUrl } from '../lib/multiplayerServer'

interface UseCreateRoomResult {
  isCreating: boolean
  createRoom: () => Promise<void>
}

/**
 * Hook that handles creating a multiplayer room via the server REST API
 * and navigating to the room page on success.
 */
export function useCreateRoom(): UseCreateRoomResult {
  const navigate = useNavigate()
  const [isCreating, setIsCreating] = useState(false)

  async function createRoom(): Promise<void> {
    setIsCreating(true)
    try {
      const response = await fetch(`${getHttpServerUrl()}/api/rooms`, { method: 'POST' })
      if (!response.ok) {
        throw new Error('Failed to create room')
      }
      const data = await response.json()
      navigate(`/room/${data.roomId}`)
    } catch (error) {
      console.error('Failed to create room:', error)
      alert('Failed to create multiplayer room. Is the server running?')
    } finally {
      setIsCreating(false)
    }
  }

  return { isCreating, createRoom }
}
