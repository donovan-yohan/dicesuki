/**
 * workerRoomTransport — a WebSocket-shaped adapter over the in-browser WASM room
 * Web Worker (issue #113).
 *
 * `useMultiplayerStore` talks to the multiplayer server through a `WebSocket`,
 * using only a small slice of its surface: the `onopen` / `onmessage` /
 * `onerror` / `onclose` handlers, `send(json)`, `close()`, and the `readyState`
 * / `OPEN` pair. This transport exposes that exact slice but is backed by a Web
 * Worker running the solo WASM room instead of a network socket, so #114 can
 * route solo play through the worker by swapping the connection factory — with
 * no other store changes.
 *
 * This module deliberately does NOT rewire the store; it only provides the
 * adapter and the worker message protocol. Wiring is issue #114's job.
 */

/** Messages the transport (main thread) sends to the worker. */
export type WorkerInbound =
  | { type: 'init'; roomId: string }
  | { type: 'send'; data: string }
  | { type: 'close' }

/** Messages the worker sends back to the transport (main thread). */
export type WorkerOutbound =
  | { type: 'ready' }
  | { type: 'message'; data: string }
  | { type: 'error'; message: string }

/**
 * The subset of `Worker` this transport depends on. Narrowed to an interface so
 * unit tests can inject a mock without a real Worker/JSDOM worker environment.
 */
export interface WorkerLike {
  postMessage(message: WorkerInbound): void
  onmessage: ((event: { data: WorkerOutbound }) => void) | null
  onerror: ((event: unknown) => void) | null
  terminate(): void
}

/** The event shape the `onmessage` handler receives, mirroring `MessageEvent`. */
export interface TransportMessageEvent {
  data: string
}

/** WebSocket `readyState` values, re-declared so the transport is standalone. */
export const enum TransportReadyState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

/**
 * A `WebSocket`-compatible façade over a WASM room worker.
 *
 * Lifecycle: constructing it tells the worker to instantiate the room; once the
 * worker reports `ready`, `readyState` flips to `OPEN` and `onopen` fires (on a
 * later task, exactly like a real socket, so the consumer has time to attach
 * handlers). Outbound server-protocol JSON arrives via `onmessage`. `close()`
 * tears the worker down and fires `onclose`.
 */
export class WorkerRoomTransport {
  /** @see WebSocket.CONNECTING */
  static readonly CONNECTING = TransportReadyState.CONNECTING
  /** @see WebSocket.OPEN */
  static readonly OPEN = TransportReadyState.OPEN
  /** @see WebSocket.CLOSING */
  static readonly CLOSING = TransportReadyState.CLOSING
  /** @see WebSocket.CLOSED */
  static readonly CLOSED = TransportReadyState.CLOSED

  readonly OPEN = TransportReadyState.OPEN

  onopen: (() => void) | null = null
  onmessage: ((event: TransportMessageEvent) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: (() => void) | null = null

  private _readyState: TransportReadyState = TransportReadyState.CONNECTING
  private readonly worker: WorkerLike

  constructor(worker: WorkerLike, roomId: string) {
    this.worker = worker

    worker.onmessage = ({ data }) => {
      switch (data.type) {
        case 'ready':
          // Ignore a duplicate/late ready after close.
          if (this._readyState !== TransportReadyState.CONNECTING) return
          this._readyState = TransportReadyState.OPEN
          this.onopen?.()
          break
        case 'message':
          this.onmessage?.({ data: data.data })
          break
        case 'error':
          this.onerror?.(new Error(data.message))
          break
      }
    }

    worker.onerror = (event) => {
      this.onerror?.(event)
    }

    worker.postMessage({ type: 'init', roomId })
  }

  /** Current connection state, mirroring `WebSocket.readyState`. */
  get readyState(): TransportReadyState {
    return this._readyState
  }

  /**
   * Forward a client-protocol JSON string to the room worker. No-ops after
   * close, matching a socket that silently drops sends once closing/closed.
   */
  send(data: string): void {
    if (
      this._readyState === TransportReadyState.CLOSING ||
      this._readyState === TransportReadyState.CLOSED
    ) {
      return
    }
    this.worker.postMessage({ type: 'send', data })
  }

  /** Tear down the worker and fire `onclose`. Idempotent. */
  close(): void {
    if (
      this._readyState === TransportReadyState.CLOSING ||
      this._readyState === TransportReadyState.CLOSED
    ) {
      return
    }
    this._readyState = TransportReadyState.CLOSING
    try {
      this.worker.postMessage({ type: 'close' })
    } catch {
      // Worker may already be gone; the terminate + onclose below still run.
    }
    this.worker.terminate()
    this._readyState = TransportReadyState.CLOSED
    this.onclose?.()
  }
}

/**
 * Build a `WorkerRoomTransport` backed by the real room worker module. Kept
 * separate from the class so the class stays trivially unit-testable with a mock
 * worker. Consumed by #114 when solo is routed through the worker.
 */
export function createWorkerRoomTransport(roomId: string): WorkerRoomTransport {
  const worker = new Worker(new URL('../workers/roomWorker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike
  return new WorkerRoomTransport(worker, roomId)
}
