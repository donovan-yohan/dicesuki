# Custom Dice Persistence System

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed custom dice guidance.

## Overview
Custom dice uploaded through the Artist Testing Platform persist across page reloads using IndexedDB. The system stores GLB file data and regenerates blob URLs on app initialization.

## Architecture

### Core Components
1. **`src/lib/customDiceDB.ts`**: IndexedDB operations for GLB file storage
2. **`src/store/useInventoryStore.ts`**: Blob URL regeneration on app load
3. **`src/components/panels/ArtistTestingPanel.tsx`**: Upload UI with IndexedDB integration
4. **`src/hooks/useCustomDiceLoader.ts`**: GLB loading hook for custom dice

### Database Schema
```typescript
// IndexedDB Database
DB_NAME = 'DaisuCustomDiceDB'
STORE_NAME = 'customDiceModels'

// Key-Value Structure
key: diceId (string)
value: ArrayBuffer (GLB file data)
```

## Blob URL Lifecycle

### 1. Upload Phase
When artist uploads custom die:
- User selects GLB file + metadata
- `handleAddToInventory()` creates blob URL: `URL.createObjectURL(file)`
- Adds die to inventory with `customAsset: { modelUrl: blobUrl, metadata }`
- Saves GLB file to IndexedDB: `saveCustomDiceModel(diceId, file)`
- **Important**: Blob URLs are NOT revoked to prevent breaking multiple uploads

### 2. Page Reload
On app initialization (`useInventoryStore` mount):
- `regenerateCustomDiceBlobUrls()` scans inventory for custom dice
- For each custom die: loads ArrayBuffer from IndexedDB
- Creates fresh blob URL: `createBlobUrlFromStorage(diceId)`
- Updates inventory store with new blob URL
- Old session blob URLs become invalid automatically

### 3. Spawn Phase
When spawning custom die:
- Scene.tsx checks if die has `customAsset`
- Renders `<CustomDice>` instead of standard `<Dice>`
- `useCustomDiceLoader` loads GLB from blob URL
- Three.js GLTFLoader handles model rendering

## Critical Fix: IndexedDB Transaction Timing

### The Problem
**Error**: `TransactionInactiveError: The transaction has finished`

IndexedDB transactions auto-commit when there's no pending work. Async operations like `Blob.arrayBuffer()` must complete BEFORE opening a transaction.

### The Solution (src/lib/customDiceDB.ts)
```typescript
export async function saveCustomDiceModel(diceId: string, fileData: ArrayBuffer | Blob) {
  // STEP 1: Convert Blob to ArrayBuffer FIRST (async operation)
  const arrayBuffer = fileData instanceof Blob
    ? await fileData.arrayBuffer()  // Do this BEFORE opening DB
    : fileData

  // STEP 2: THEN open database and transaction
  const db = await openDatabase()
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  const store = transaction.objectStore(STORE_NAME)

  // STEP 3: Put ArrayBuffer (transaction still active)
  return new Promise((resolve, reject) => {
    const request = store.put(arrayBuffer, diceId)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}
```

## Common Issues

### Issue: Blob URL Revocation Breaking Multiple Uploads
**Symptom**: Second upload causes first die's blob URL to become invalid
**Root Cause**: `URL.revokeObjectURL()` invalidates blob URLs stored in inventory
**Solution**: Remove ALL blob URL revocation logic from ArtistTestingPanel
- Blob URLs persist for session (acceptable memory trade-off for dev dice)
- Blob URLs regenerated fresh from IndexedDB on page reload anyway

### Issue: Custom Dice Not Persisting on Reload
**Symptom**: `ERR_FILE_NOT_FOUND` when trying to spawn custom die after reload
**Diagnosis**:
- Check browser console for `[CustomDiceDB]` logs
- Verify IndexedDB save succeeded: `✓ Saved model for dice: ...`
- Verify blob URL regeneration: `[InventoryStore] Regenerated blob URL for die: ...`
- Check Application > IndexedDB > DaisuCustomDiceDB in DevTools

## Testing Workflow

1. **Fresh Upload Test**:
   - Remove old dev dice (button in Inventory)
   - Upload new custom die through Artist Testing Platform
   - Verify console: `[CustomDiceDB] ✓ Saved model for dice: ...`
   - Spawn die in current session (should work)

2. **Multiple Upload Test**:
   - Upload first custom die
   - Upload second custom die (same or different file)
   - Verify both dice can be spawned in current session

3. **Persistence Test**:
   - Upload custom die
   - Reload page (Cmd+R / Ctrl+R)
   - Verify console: `[InventoryStore] Regenerating blob URLs for X custom dice`
   - Spawn custom die after reload (should work with regenerated blob URL)

## Performance Considerations

1. **Memory**: Blob URLs kept alive for session (acceptable for dev dice)
2. **Storage**: IndexedDB size limited by browser (~50MB typical)
3. **Load Time**: Blob URL regeneration happens async on app init
4. **File Size**: GLB files should be <10MB (5MB recommended)
