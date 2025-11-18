/**
 * IndexedDB Storage for Custom Dice GLB Files
 *
 * Stores GLB file data persistently so blob URLs can be regenerated after page reload.
 * Blob URLs are session-scoped and become invalid when the page reloads.
 *
 * Database Schema:
 * - Store Name: 'customDiceModels'
 * - Key: diceId (string)
 * - Value: ArrayBuffer (GLB file data)
 */

const DB_NAME = 'DaisuCustomDiceDB'
const DB_VERSION = 1
const STORE_NAME = 'customDiceModels'

/**
 * Open or create the IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      console.error('[CustomDiceDB] Failed to open database:', request.error)
      reject(request.error)
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
        console.log(`[CustomDiceDB] Created object store: ${STORE_NAME}`)
      }
    }
  })
}

/**
 * Store GLB file data in IndexedDB
 *
 * @param diceId - Unique identifier for the dice
 * @param fileData - GLB file as ArrayBuffer or Blob
 */
export async function saveCustomDiceModel(diceId: string, fileData: ArrayBuffer | Blob): Promise<void> {
  try {
    // IMPORTANT: Convert Blob to ArrayBuffer BEFORE opening transaction
    // Transactions auto-complete when there's no pending work, so async operations
    // like arrayBuffer() will cause the transaction to finish prematurely
    console.log(`[CustomDiceDB] Converting file data to ArrayBuffer...`, {
      isBlob: fileData instanceof Blob,
      size: fileData instanceof Blob ? fileData.size : fileData.byteLength
    })
    const arrayBuffer = fileData instanceof Blob
      ? await fileData.arrayBuffer()
      : fileData

    console.log(`[CustomDiceDB] ArrayBuffer ready, size: ${arrayBuffer.byteLength} bytes`)
    console.log(`[CustomDiceDB] Opening database for save...`)

    const db = await openDatabase()
    console.log(`[CustomDiceDB] Database opened, creating transaction...`)

    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.put(arrayBuffer, diceId)

      request.onsuccess = () => {
        console.log(`[CustomDiceDB] ✓ Saved model for dice: ${diceId}`)
        resolve()
      }

      request.onerror = () => {
        console.error(`[CustomDiceDB] ✗ Failed to save model for dice ${diceId}:`, request.error)
        reject(request.error)
      }
    })
  } catch (error) {
    console.error('[CustomDiceDB] ✗ Error in saveCustomDiceModel:', error)
    throw error
  }
}

/**
 * Retrieve GLB file data from IndexedDB
 *
 * @param diceId - Unique identifier for the dice
 * @returns GLB file as ArrayBuffer, or null if not found
 */
export async function loadCustomDiceModel(diceId: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDatabase()
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.get(diceId)

      request.onsuccess = () => {
        const result = request.result as ArrayBuffer | undefined
        if (result) {
          console.log(`[CustomDiceDB] Loaded model for dice: ${diceId} (${result.byteLength} bytes)`)
          resolve(result)
        } else {
          console.warn(`[CustomDiceDB] No model found for dice: ${diceId}`)
          resolve(null)
        }
      }

      request.onerror = () => {
        console.error(`[CustomDiceDB] Failed to load model for dice ${diceId}:`, request.error)
        reject(request.error)
      }
    })
  } catch (error) {
    console.error('[CustomDiceDB] Error loading model:', error)
    return null
  }
}

/**
 * Delete GLB file data from IndexedDB
 *
 * @param diceId - Unique identifier for the dice
 */
export async function deleteCustomDiceModel(diceId: string): Promise<void> {
  try {
    const db = await openDatabase()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.delete(diceId)

      request.onsuccess = () => {
        console.log(`[CustomDiceDB] Deleted model for dice: ${diceId}`)
        resolve()
      }

      request.onerror = () => {
        console.error(`[CustomDiceDB] Failed to delete model for dice ${diceId}:`, request.error)
        reject(request.error)
      }
    })
  } catch (error) {
    console.error('[CustomDiceDB] Error deleting model:', error)
    throw error
  }
}

/**
 * Get all stored dice IDs
 *
 * @returns Array of dice IDs that have stored models
 */
export async function getAllCustomDiceIds(): Promise<string[]> {
  try {
    const db = await openDatabase()
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.getAllKeys()

      request.onsuccess = () => {
        const keys = request.result as string[]
        console.log(`[CustomDiceDB] Found ${keys.length} stored models`)
        resolve(keys)
      }

      request.onerror = () => {
        console.error('[CustomDiceDB] Failed to get dice IDs:', request.error)
        reject(request.error)
      }
    })
  } catch (error) {
    console.error('[CustomDiceDB] Error getting dice IDs:', error)
    return []
  }
}

/**
 * Create a blob URL from stored GLB data
 *
 * @param diceId - Unique identifier for the dice
 * @returns Blob URL for the GLB file, or null if not found
 */
export async function createBlobUrlFromStorage(diceId: string): Promise<string | null> {
  const arrayBuffer = await loadCustomDiceModel(diceId)

  if (!arrayBuffer) {
    return null
  }

  // Create blob from ArrayBuffer
  const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' })

  // Create and return blob URL
  const blobUrl = URL.createObjectURL(blob)
  console.log(`[CustomDiceDB] Created blob URL for dice ${diceId}: ${blobUrl}`)

  return blobUrl
}

/**
 * Clear all custom dice models from storage
 * Useful for debugging or resetting the database
 */
export async function clearAllCustomDiceModels(): Promise<void> {
  try {
    const db = await openDatabase()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.clear()

      request.onsuccess = () => {
        console.log('[CustomDiceDB] Cleared all custom dice models')
        resolve()
      }

      request.onerror = () => {
        console.error('[CustomDiceDB] Failed to clear models:', request.error)
        reject(request.error)
      }
    })
  } catch (error) {
    console.error('[CustomDiceDB] Error clearing models:', error)
    throw error
  }
}
