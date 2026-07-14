/**
 * roomWorker — the Web Worker host for the in-browser WASM room (issue #113).
 *
 * This is a THIN SHIM (epic #111 anti-drift guardrail): it instantiates the
 * `dicesuki-core` engine compiled to WASM, forwards protocol JSON both ways over
 * `postMessage`, and drives the 60Hz tick timer. It contains ZERO room /
 * physics / game logic — every decision lives in Rust (`dicesuki-core` +
 * `dicesuki-wasm`'s `RoomHost`).
 *
 * Wiring into `useMultiplayerStore` is issue #114; this file plus
 * `workerRoomTransport.ts` are the host half only.
 */

// Load the wasm binary through an explicit Vite `?url` import and hand it to
// `init()`. Left to itself the generated module resolves its `.wasm` via
// `new URL('…_bg.wasm', import.meta.url)`, which Vite only rewrites to a served
// asset at *build* time — in `vite dev` that path 404s and the room never boots.
// The `?url` import resolves correctly in both dev and build.
import init, { WasmRoom } from '../generated/wasm-room/dicesuki_wasm.js'
import wasmUrl from '../generated/wasm-room/dicesuki_wasm_bg.wasm?url'
import type { WorkerInbound, WorkerOutbound } from '../lib/workerRoomTransport'

/**
 * Minimal typed view of the dedicated-worker global. Declared locally so this
 * file does not need the `WebWorker` TS lib (the project's `lib` is DOM), whose
 * `postMessage` signature would otherwise clash with `Window`'s.
 */
interface WorkerScope {
  postMessage(message: WorkerOutbound): void
  onmessage: ((event: { data: WorkerInbound }) => void) | null
}
const ctx = self as unknown as WorkerScope

/** Fixed 60Hz cadence, matching the native server's simulation loop. */
const TICK_MS = 1000 / 60

let room: WasmRoom | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
/** Re-entrancy guard: a slow tick must never overlap the next timer fire. */
let ticking = false
/** Memoized wasm instantiation so repeated inits share one module load. */
let wasmReady: Promise<unknown> | null = null
/** Sends that arrive before the room exists (should be rare); flushed on init. */
const pending: string[] = []

function post(message: WorkerOutbound): void {
  ctx.postMessage(message)
}

function startTicking(): void {
  if (tickTimer !== null) return
  tickTimer = setInterval(() => {
    if (room === null || ticking) return
    // Skip the wasm call entirely while the room is idle; the tick would be a
    // no-op in Rust, but the guard avoids the boundary crossing 60x/sec.
    if (!room.isSimulating()) return
    ticking = true
    try {
      // Outbound snapshots/settles are delivered synchronously via the room's
      // on-message callback wired in `createRoom`.
      room.tick(TICK_MS)
    } finally {
      ticking = false
    }
  }, TICK_MS)
}

function createRoom(roomId: string, viewportAspect?: number): void {
  if (room !== null) return
  // The callback fires once per outbound `ServerMessage`, forwarding its JSON to
  // the main thread. We ignore the value the room methods also return. The arena
  // is sized to `viewportAspect` in core; passing `undefined` keeps the fixed
  // 9:16 arena. The shim forwards the number and nothing else (Shared-ADR-007).
  room = new WasmRoom(roomId, viewportAspect, (json: string) =>
    post({ type: 'message', data: json }),
  )
  startTicking()
}

async function handleInit(roomId: string, viewportAspect?: number): Promise<void> {
  try {
    if (wasmReady === null) wasmReady = init(wasmUrl)
    await wasmReady
    createRoom(roomId, viewportAspect)
    // Flush anything that raced ahead of instantiation.
    const queued = pending.splice(0)
    for (const data of queued) room?.handleMessage(data)
    post({ type: 'ready' })
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function shutdown(): void {
  if (tickTimer !== null) {
    clearInterval(tickTimer)
    tickTimer = null
  }
  room?.free()
  room = null
}

ctx.onmessage = ({ data }) => {
  switch (data.type) {
    case 'init':
      void handleInit(data.roomId, data.viewportAspect)
      break
    case 'send':
      if (room !== null) {
        // The room's on-message callback emits any resulting outbound messages.
        room.handleMessage(data.data)
      } else {
        pending.push(data.data)
      }
      break
    case 'close':
      shutdown()
      break
  }
}
