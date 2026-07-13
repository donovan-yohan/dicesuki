import { useCallback, useEffect, useState } from 'react'
import {
  fetchPublicRooms,
  getRoomServerConfig,
  type PublicRoomEntry,
  type RoomServerMode,
} from '../lib/multiplayerServer'

export interface UsePublicRoomsOptions {
  mode?: RoomServerMode
  pageSize?: number
}

export interface UsePublicRoomsResult {
  rooms: PublicRoomEntry[]
  page: number
  pageSize: number
  total: number
  isLoading: boolean
  error: string | null
  refresh: () => void
  nextPage: () => void
  prevPage: () => void
  hasNextPage: boolean
  hasPrevPage: boolean
}

const DEFAULT_PAGE_SIZE = 20

/**
 * Fetch and paginate the public room browser listing (`GET /api/rooms`, #79).
 * Re-fetches whenever the page changes and on an explicit {@link refresh}.
 */
export function usePublicRooms(options: UsePublicRoomsOptions = {}): UsePublicRoomsResult {
  const mode = options.mode || 'public'
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE

  const [rooms, setRooms] = useState<PublicRoomEntry[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped by refresh() to force a re-fetch of the current page.
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const config = getRoomServerConfig(mode)
    const controller = new AbortController()
    let active = true

    setIsLoading(true)
    setError(null)
    fetchPublicRooms(config, { page, pageSize, signal: controller.signal })
      .then((result) => {
        if (!active) return
        setRooms(result.rooms)
        setTotal(result.total)
      })
      .catch((err: unknown) => {
        if (!active || controller.signal.aborted) return
        setRooms([])
        setError(
          err instanceof Error
            ? `Could not load public rooms: ${err.message}`
            : 'Could not load public rooms.',
        )
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [mode, page, pageSize, reloadToken])

  const refresh = useCallback(() => setReloadToken((t) => t + 1), [])

  const hasNextPage = (page + 1) * pageSize < total
  const hasPrevPage = page > 0

  const nextPage = useCallback(() => {
    setPage((p) => (((p + 1) * pageSize < total) ? p + 1 : p))
  }, [pageSize, total])

  const prevPage = useCallback(() => {
    setPage((p) => (p > 0 ? p - 1 : p))
  }, [])

  return {
    rooms,
    page,
    pageSize,
    total,
    isLoading,
    error,
    refresh,
    nextPage,
    prevPage,
    hasNextPage,
    hasPrevPage,
  }
}
