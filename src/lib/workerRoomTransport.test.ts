import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  WorkerRoomTransport,
  TransportReadyState,
  type WorkerLike,
  type WorkerInbound,
  type WorkerOutbound,
} from './workerRoomTransport'

/**
 * A mock `Worker` that records what the transport posts and lets the test drive
 * the worker→main direction via `emit`.
 */
class MockWorker implements WorkerLike {
  posted: WorkerInbound[] = []
  onmessage: ((event: { data: WorkerOutbound }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  terminated = false

  postMessage(message: WorkerInbound): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  /** Simulate a message coming back from the worker. */
  emit(message: WorkerOutbound): void {
    this.onmessage?.({ data: message })
  }
}

describe('WorkerRoomTransport', () => {
  let worker: MockWorker

  beforeEach(() => {
    worker = new MockWorker()
  })

  it('posts an init message with the room id on construction', () => {
    new WorkerRoomTransport(worker, 'room-abc')
    expect(worker.posted).toEqual([{ type: 'init', roomId: 'room-abc' }])
  })

  it('forwards the viewport aspect in init when provided', () => {
    new WorkerRoomTransport(worker, 'room-abc', 1.5)
    expect(worker.posted).toEqual([{ type: 'init', roomId: 'room-abc', viewportAspect: 1.5 }])
  })

  it('omits viewportAspect from init when none is provided (fixed-arena fallback)', () => {
    new WorkerRoomTransport(worker, 'room-abc', undefined)
    expect(worker.posted).toEqual([{ type: 'init', roomId: 'room-abc' }])
    expect(worker.posted[0]).not.toHaveProperty('viewportAspect')
  })

  it('starts CONNECTING and opens only after the worker signals ready', () => {
    const transport = new WorkerRoomTransport(worker, 'r')
    const onopen = vi.fn()
    transport.onopen = onopen

    expect(transport.readyState).toBe(TransportReadyState.CONNECTING)
    expect(onopen).not.toHaveBeenCalled()

    worker.emit({ type: 'ready' })

    expect(transport.readyState).toBe(TransportReadyState.OPEN)
    expect(transport.readyState).toBe(transport.OPEN)
    expect(onopen).toHaveBeenCalledTimes(1)
  })

  it('delivers server-protocol JSON through onmessage as an event with .data', () => {
    const transport = new WorkerRoomTransport(worker, 'r')
    const onmessage = vi.fn()
    transport.onmessage = onmessage
    worker.emit({ type: 'ready' })

    const payload = '{"type":"room_state","roomId":"r"}'
    worker.emit({ type: 'message', data: payload })

    expect(onmessage).toHaveBeenCalledWith({ data: payload })
  })

  it('forwards send() to the worker as a send message', () => {
    const transport = new WorkerRoomTransport(worker, 'r')
    worker.emit({ type: 'ready' })
    worker.posted.length = 0

    const join = '{"type":"join","roomId":"r","displayName":"Solo","color":"#fff"}'
    transport.send(join)

    expect(worker.posted).toEqual([{ type: 'send', data: join }])
  })

  it('surfaces worker error messages through onerror', () => {
    const transport = new WorkerRoomTransport(worker, 'r')
    const onerror = vi.fn()
    transport.onerror = onerror

    worker.emit({ type: 'error', message: 'wasm boom' })

    expect(onerror).toHaveBeenCalledTimes(1)
    const arg = onerror.mock.calls[0][0]
    expect(arg).toBeInstanceOf(Error)
    expect((arg as Error).message).toBe('wasm boom')
  })

  it('close() tells the worker to close, terminates it, and fires onclose', () => {
    const transport = new WorkerRoomTransport(worker, 'r')
    worker.emit({ type: 'ready' })
    worker.posted.length = 0
    const onclose = vi.fn()
    transport.onclose = onclose

    transport.close()

    expect(worker.posted).toContainEqual({ type: 'close' })
    expect(worker.terminated).toBe(true)
    expect(transport.readyState).toBe(TransportReadyState.CLOSED)
    expect(onclose).toHaveBeenCalledTimes(1)
  })

  it('drops sends after close and is idempotent on repeated close', () => {
    const transport = new WorkerRoomTransport(worker, 'r')
    worker.emit({ type: 'ready' })
    transport.close()
    worker.posted.length = 0
    const onclose = vi.fn()
    transport.onclose = onclose

    transport.send('{"type":"roll"}')
    transport.close()

    expect(worker.posted).toEqual([])
    expect(onclose).not.toHaveBeenCalled()
  })

  it('ignores a late ready after close', () => {
    const transport = new WorkerRoomTransport(worker, 'r')
    transport.close()
    const onopen = vi.fn()
    transport.onopen = onopen

    worker.emit({ type: 'ready' })

    expect(onopen).not.toHaveBeenCalled()
    expect(transport.readyState).toBe(TransportReadyState.CLOSED)
  })
})
