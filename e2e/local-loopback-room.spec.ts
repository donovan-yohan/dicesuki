import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import * as path from 'node:path'

test.describe.configure({ mode: 'serial' })

const ROOM_SERVER_PORT = Number(process.env.DICESUKI_ROOM_TEST_PORT || '18180')
const ROOM_SERVER_HTTP_URL = `http://127.0.0.1:${ROOM_SERVER_PORT}`
const ROOM_SERVER_WS_URL = `ws://127.0.0.1:${ROOM_SERVER_PORT}`

let roomServer: ChildProcessWithoutNullStreams | null = null
let roomServerLog = ''

test.afterEach(async () => {
  await stopRoomServer()
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

test('shows actionable local loopback failure UI when the room server is unavailable', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: /open local solo room/i }).click()

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Room server unavailable')
  await expect(alert).toContainText(ROOM_SERVER_HTTP_URL)
  await expect(alert).toContainText('npm run dev:local-room')
  await expect(page).not.toHaveURL(/\/room\//)
})

test('creates and joins a local solo room from /, then spawns a die through the backend', async ({ page }) => {
  test.setTimeout(90_000)

  await startRoomServer()
  const observed = observeRoomTraffic(page)

  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: /open local solo room/i }).click()

  await expect(page).toHaveURL(/\/room\/[^?]+\?server=local&solo=1&name=Solo\+Player/)
  await expect(page.getByText(/Starting Solo Room/i)).toHaveCount(0)

  const room = page.getByTestId('multiplayer-room')
  await expect(room).toHaveAttribute('data-server-mode', 'local-loopback')
  await expect(room).toHaveAttribute('data-connection-status', 'connected')
  await expect(room).toHaveAttribute('data-local-player-ready', 'true')
  await expect(room).toHaveAttribute('data-player-count', '1')

  await expect.poll(() => observed.createdRoomStatus).toBe(201)
  await expect.poll(() => observed.sentMessageTypes).toContain('join')
  await expect.poll(() => observed.receivedMessageTypes).toContain('room_state')

  const roomId = new URL(page.url()).pathname.split('/').at(-1)
  expect(roomId).toBeTruthy()

  const spawnResult = await spawnDieThroughBrowserWebSocket(page, roomId as string)
  expect(spawnResult.sentMessageTypes).toContain('spawn_dice')
  expect(spawnResult.receivedMessageTypes).toContain('dice_spawned')
  expect(spawnResult.spawnedDiceCount).toBe(1)

  await expect.poll(() => observed.sentMessageTypes).toContain('spawn_dice')
  await expect.poll(() => observed.receivedMessageTypes).toContain('dice_spawned')
})

function observeRoomTraffic(page: Page) {
  const traffic = {
    createdRoomStatus: 0,
    sentMessageTypes: [] as string[],
    receivedMessageTypes: [] as string[],
  }

  page.on('response', (response) => {
    if (response.url() === `${ROOM_SERVER_HTTP_URL}/api/rooms`) {
      traffic.createdRoomStatus = response.status()
    }
  })

  page.on('websocket', (webSocket) => {
    if (!webSocket.url().startsWith(`${ROOM_SERVER_WS_URL}/ws/`)) return

    webSocket.on('framesent', (frame) => {
      const type = readMessageType(frame.payload)
      if (type) traffic.sentMessageTypes.push(type)
    })

    webSocket.on('framereceived', (frame) => {
      const type = readMessageType(frame.payload)
      if (type) traffic.receivedMessageTypes.push(type)
    })
  })

  return traffic
}

function readMessageType(payload: string | Buffer): string | null {
  try {
    const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload
    const parsed = JSON.parse(text) as { type?: unknown }
    return typeof parsed.type === 'string' ? parsed.type : null
  } catch {
    return null
  }
}

async function spawnDieThroughBrowserWebSocket(page: Page, roomId: string) {
  return page.evaluate(
    ({ roomId: targetRoomId, roomServerWsUrl }) => new Promise<{
      sentMessageTypes: string[]
      receivedMessageTypes: string[]
      spawnedDiceCount: number
    }>((resolve, reject) => {
      const sentMessageTypes: string[] = []
      const receivedMessageTypes: string[] = []
      const socket = new WebSocket(`${roomServerWsUrl}/ws/${targetRoomId}`)
      const timeout = window.setTimeout(() => {
        socket.close()
        reject(new Error(`Timed out waiting for dice_spawned in ${targetRoomId}`))
      }, 10_000)

      socket.onopen = () => {
        sentMessageTypes.push('join')
        socket.send(JSON.stringify({
          type: 'join',
          roomId: targetRoomId,
          displayName: 'Smoke Bot',
          color: '#f97316',
        }))
      }

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as { type?: string; dice?: unknown[] }
        if (message.type) receivedMessageTypes.push(message.type)

        if (message.type === 'room_state') {
          sentMessageTypes.push('spawn_dice')
          socket.send(JSON.stringify({
            type: 'spawn_dice',
            dice: [{ id: `smoke-d20-${Date.now()}`, diceType: 'd20' }],
          }))
        }

        if (message.type === 'dice_spawned') {
          window.clearTimeout(timeout)
          socket.close()
          resolve({
            sentMessageTypes,
            receivedMessageTypes,
            spawnedDiceCount: Array.isArray(message.dice) ? message.dice.length : 0,
          })
        }
      }

      socket.onerror = () => {
        window.clearTimeout(timeout)
        reject(new Error(`Smoke WebSocket failed for ${targetRoomId}`))
      }
    }),
    { roomId, roomServerWsUrl: ROOM_SERVER_WS_URL },
  )
}

async function startRoomServer() {
  const rustHome = process.env.DICESUKI_RUST_HOME || process.env.HERMES_REAL_HOME || homedir()
  const cargoPath = process.env.CARGO || path.join(rustHome, '.cargo/bin/cargo')
  const cargoCommand = existsSync(cargoPath) ? cargoPath : 'cargo'
  const repoRoot = process.cwd()
  const serverDir = path.join(repoRoot, 'server')

  roomServerLog = ''
  roomServer = spawn(cargoCommand, ['run'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(ROOM_SERVER_PORT),
      RUSTUP_HOME: process.env.RUSTUP_HOME || path.join(rustHome, '.rustup'),
      CARGO_HOME: process.env.CARGO_HOME || path.join(rustHome, '.cargo'),
    },
  })

  roomServer.stdout.on('data', (chunk) => {
    roomServerLog += chunk.toString()
  })
  roomServer.stderr.on('data', (chunk) => {
    roomServerLog += chunk.toString()
  })

  await waitForRoomServerReady()
}

async function waitForRoomServerReady() {
  const deadline = Date.now() + 60_000
  let lastError: unknown = null

  while (Date.now() < deadline) {
    if (roomServer?.exitCode !== null) {
      throw new Error(`room server exited early with ${roomServer.exitCode}:\n${roomServerLog}`)
    }

    try {
      const response = await fetch(`${ROOM_SERVER_HTTP_URL}/health`)
      if (response.ok) {
        const body = await response.json() as { status?: unknown; instanceId?: unknown }
        if (body.status === 'ok' && typeof body.instanceId === 'string') return
      }
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`room server did not become ready: ${String(lastError)}\n${roomServerLog}`)
}

async function stopRoomServer() {
  if (!roomServer) return

  const server = roomServer
  roomServer = null

  if (server.exitCode !== null) return

  server.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (server.exitCode === null) server.kill('SIGKILL')
      resolve()
    }, 5_000)

    server.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}
