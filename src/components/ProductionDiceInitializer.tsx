import { useEffect, useRef } from 'react'
import { useProductionDice } from '../hooks/useProductionDice'

export function ProductionDiceInitializer() {
  const { isLoading, error, addAllToInventory } = useProductionDice()
  const hasSynced = useRef(false)

  useEffect(() => {
    if (isLoading || error || hasSynced.current) return
    hasSynced.current = true
    addAllToInventory()
  }, [addAllToInventory, error, isLoading])

  return null
}
