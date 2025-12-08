/**
 * Production Dice Hook
 *
 * React hook for loading and managing production dice assets.
 * Integrates with the inventory system to add production dice
 * to the player's collection.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  LoadedProductionDice,
  loadAllProductionDice,
  fetchDiceManifest,
  DiceManifest,
  getDiceRarity,
  getDiceDescription,
} from '../lib/productionDiceRegistry'
import { devLog } from '../lib/debug'
import { useInventoryStore } from '../store/useInventoryStore'

/**
 * Hook state
 */
interface ProductionDiceState {
  /** All loaded production dice */
  dice: LoadedProductionDice[]
  /** Loading state */
  isLoading: boolean
  /** Error message if loading failed */
  error: string | null
  /** Manifest metadata */
  manifest: DiceManifest | null
}

/**
 * Hook for managing production dice
 */
export function useProductionDice() {
  const [state, setState] = useState<ProductionDiceState>({
    dice: [],
    isLoading: true,
    error: null,
    manifest: null,
  })

  const addDie = useInventoryStore((state) => state.addDie)
  const inventory = useInventoryStore((state) => state.dice)

  // Load production dice on mount
  useEffect(() => {
    let mounted = true

    async function loadDice() {
      try {
        const [manifest, dice] = await Promise.all([
          fetchDiceManifest(),
          loadAllProductionDice(),
        ])

        if (mounted) {
          setState({
            dice,
            isLoading: false,
            error: null,
            manifest,
          })
        }
      } catch (error) {
        if (mounted) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to load dice',
          }))
        }
      }
    }

    loadDice()

    return () => {
      mounted = false
    }
  }, [])

  /**
   * Add a production dice to the player's inventory
   */
  const addToInventory = useCallback(
    (productionDice: LoadedProductionDice) => {
      // Check if already in inventory (using assetId in customAsset)
      const existingDie = inventory.find(
        (d) => d.customAsset?.assetId === productionDice.id
      )
      if (existingDie) {
        devLog.log(`[useProductionDice] Dice ${productionDice.id} already in inventory`)
        return existingDie
      }

      const { metadata } = productionDice

      // Add to inventory
      const newDie = addDie({
        type: metadata.diceType,
        setId: productionDice.setId,
        rarity: getDiceRarity(metadata),
        appearance: {
          baseColor: '#8b5cf6', // Default purple for custom dice
          accentColor: '#ffffff',
          material: 'plastic',
          roughness: 0.7,
          metalness: 0.0,
        },
        vfx: {},
        name: metadata.name,
        description: getDiceDescription(metadata),
        isFavorite: false,
        isLocked: false,
        isDev: false, // Production dice are NOT dev dice
        source: 'event', // Production dice are special releases
        customAsset: {
          modelUrl: productionDice.asset.modelUrl,
          assetId: productionDice.id,
          metadata: productionDice.asset.metadata,
        },
      })

      devLog.log(`[useProductionDice] Added ${productionDice.id} to inventory:`, newDie.id)
      return newDie
    },
    [addDie, inventory]
  )

  /**
   * Add all production dice to inventory (for initial setup)
   */
  const addAllToInventory = useCallback(() => {
    const added: string[] = []

    state.dice.forEach((productionDice) => {
      const existingDie = inventory.find(
        (d) => d.customAsset?.assetId === productionDice.id
      )
      if (!existingDie) {
        addToInventory(productionDice)
        added.push(productionDice.id)
      }
    })

    if (added.length > 0) {
      devLog.log(`[useProductionDice] Added ${added.length} production dice to inventory`)
    }

    return added
  }, [state.dice, inventory, addToInventory])

  /**
   * Check if a production dice is in the player's inventory
   */
  const isInInventory = useCallback(
    (productionDiceId: string) => {
      return inventory.some((d) => d.customAsset?.assetId === productionDiceId)
    },
    [inventory]
  )

  /**
   * Get production dice by set
   */
  const getDiceBySet = useCallback(
    (setName: string) => {
      return state.dice.filter((d) => d.setId === setName)
    },
    [state.dice]
  )

  /**
   * Get unique set names
   */
  const getSets = useCallback(() => {
    const sets = new Set(state.dice.map((d) => d.setId))
    return Array.from(sets).sort()
  }, [state.dice])

  return {
    ...state,
    addToInventory,
    addAllToInventory,
    isInInventory,
    getDiceBySet,
    getSets,
  }
}
