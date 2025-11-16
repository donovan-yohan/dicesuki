/**
 * Multiplayer Hook
 * React hook for managing multiplayer connection and room state
 */

import { useEffect, useCallback, useRef } from 'react'
import { SocketManager } from './SocketManager'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useDiceManagerStore } from '../store/useDiceManagerStore'
import type { PhysicsSnapshot, DiceState } from './SocketManager'

export function useMultiplayer() {
  const isInitialized = useRef(false)

  // Multiplayer store
  const {
    isConnected,
    setConnected,
    setConnecting,
    setConnectionError,
    setRoom,
    setPlayer,
    addPlayer,
    removePlayer,
    reset: resetMultiplayer,
  } = useMultiplayerStore()

  // Dice manager store
  const { dice: localDice, updateDicePosition } = useDiceManagerStore()

  /**
   * Connect to physics server
   */
  const connect = useCallback(() => {
    if (SocketManager.isConnected()) return

    setConnecting(true)
    setConnectionError(null)

    try {
      const socket = SocketManager.connect()

      // Connection events
      socket.on('connect', () => {
        setConnected(true)
        setConnecting(false)
        console.log('✅ Connected to physics server')
      })

      socket.on('disconnect', () => {
        setConnected(false)
        console.log('❌ Disconnected from physics server')
      })

      socket.on('connect_error', (error) => {
        setConnectionError(error.message)
        setConnecting(false)
        console.error('Connection error:', error)
      })

      // Room events
      socket.on('room:joined', (data) => {
        setRoom({
          id: data.roomId,
          code: data.roomCode,
          maxPlayers: data.maxPlayers,
          players: data.players,
        })
        setPlayer(data.yourPlayerId, '', '') // Name/color already set
        console.log(`✅ Joined room: ${data.roomCode}`)
      })

      socket.on('room:player_joined', (player) => {
        addPlayer(player)
        console.log(`👤 Player joined: ${player.name}`)
      })

      socket.on('room:player_left', (playerId) => {
        removePlayer(playerId)
        console.log(`👤 Player left: ${playerId}`)
      })

      socket.on('room:closed', (reason) => {
        console.log(`🚪 Room closed: ${reason}`)
        disconnect()
      })

      // Physics events
      socket.on('physics:snapshot', (snapshot: PhysicsSnapshot) => {
        // Update dice positions from server
        // TODO: Implement client-side prediction and reconciliation
        // For now, just update positions directly
        snapshot.dice.forEach((serverDice) => {
          updateDicePosition(serverDice.id, serverDice.position)
        })
      })

      socket.on('dice:added', (dice: DiceState) => {
        console.log(`🎲 Dice added: ${dice.id} by ${dice.ownerId}`)
        // TODO: Add dice to local state
      })

      socket.on('dice:removed', (diceId: string) => {
        console.log(`🎲 Dice removed: ${diceId}`)
        // TODO: Remove dice from local state
      })

      // Error events
      socket.on('error', (error) => {
        console.error('❌ Server error:', error.code, error.message)
        setConnectionError(error.message)
      })
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Connection failed')
      setConnecting(false)
    }
  }, [setConnected, setConnecting, setConnectionError, setRoom, setPlayer, addPlayer, removePlayer, updateDicePosition])

  /**
   * Disconnect from server
   */
  const disconnect = useCallback(() => {
    SocketManager.disconnect()
    resetMultiplayer()
  }, [resetMultiplayer])

  /**
   * Create a room
   */
  const createRoom = useCallback(
    async (playerName: string, playerColor: string, password?: string, maxPlayers?: number) => {
      const response = await SocketManager.createRoom(playerName, playerColor, password, maxPlayers)

      if (!response.success) {
        setConnectionError(response.error || 'Failed to create room')
        return null
      }

      return response.roomCode || null
    },
    [setConnectionError]
  )

  /**
   * Join a room
   */
  const joinRoom = useCallback(
    async (roomCode: string, playerName: string, playerColor: string, password?: string) => {
      const response = await SocketManager.joinRoom(roomCode, playerName, playerColor, password)

      if (!response.success) {
        setConnectionError(response.error || 'Failed to join room')
        return false
      }

      return true
    },
    [setConnectionError]
  )

  /**
   * Leave room
   */
  const leaveRoom = useCallback(() => {
    SocketManager.leaveRoom()
    disconnect()
  }, [disconnect])

  /**
   * Auto-cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (isConnected) {
        disconnect()
      }
    }
  }, [isConnected, disconnect])

  return {
    // Connection state
    isConnected,
    isConnecting: useMultiplayerStore(state => state.isConnecting),
    connectionError: useMultiplayerStore(state => state.connectionError),

    // Room state
    room: useMultiplayerStore(state => state.room),
    roomCode: useMultiplayerStore(state => state.roomCode),
    playerId: useMultiplayerStore(state => state.playerId),

    // Actions
    connect,
    disconnect,
    createRoom,
    joinRoom,
    leaveRoom,

    // Socket manager (for advanced usage)
    socket: SocketManager,
  }
}
