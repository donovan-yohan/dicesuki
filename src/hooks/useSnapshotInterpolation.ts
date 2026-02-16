import { useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useMultiplayerStore } from '../store/useMultiplayerStore'

/**
 * Manages interpolation timing between physics snapshots.
 *
 * Server sends snapshots at a configurable rate (SNAPSHOT_DIVISOR in room.rs).
 * Client renders at 60fps (every 16.7ms).
 * We interpolate between the two most recent snapshots for smooth motion.
 *
 * Returns `tRef` (0 to 1): how far between prev snapshot and target snapshot.
 * t=0 means render at prev position, t=1 means render at target position.
 */
export function useSnapshotInterpolation(): MutableRefObject<number> {
  const lastSnapshotTime = useMultiplayerStore((s) => s.lastSnapshotTime)
  const snapshotInterval = useMultiplayerStore((s) => s.snapshotInterval)
  const tRef = useRef(0)

  useFrame(() => {
    const now = performance.now()
    const elapsed = now - lastSnapshotTime

    // Clamp t to [0, 1] — don't extrapolate beyond the target
    tRef.current = Math.min(elapsed / snapshotInterval, 1.0)
  })

  return tRef
}
