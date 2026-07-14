import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeContext } from '../../contexts/ThemeContext'
import { defaultTheme } from '../../themes/tokens'
import type { MultiplayerDie } from '../../store/useMultiplayerStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useCreateRoom, type UseCreateRoomOptions } from '../../hooks/useCreateRoom'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { consumePendingRoomSetup, clearPendingRoomSetup } from '../../lib/roomCarry'
import { SoloRoomControls } from './SoloRoomControls'

const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('../../hooks/useCreateRoom', () => ({ useCreateRoom: vi.fn() }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: vi.fn(() => true) }))

// The mocked createRoom simulates a successful create by firing the caller's
// onRoomCreated (which is what stashes the carry buffer, keyed to the room id).
let capturedOptions: UseCreateRoomOptions | undefined
const CREATED_ROOM_ID = 'TEST-ROOM'
const createRoomMock = vi.fn(async () => {
  capturedOptions?.onRoomCreated?.(CREATED_ROOM_ID)
})

function die(id: string, overrides: Partial<MultiplayerDie> = {}): MultiplayerDie {
  return {
    id,
    ownerId: 'me',
    diceType: 'd20',
    position: [1, 2, 3],
    rotation: [0, 0, 0, 1],
    targetPosition: [1, 2, 3],
    targetRotation: [0, 0, 0, 1],
    prevPosition: [1, 2, 3],
    prevRotation: [0, 0, 0, 1],
    isRolling: false,
    faceValue: 20,
    ...overrides,
  }
}

function renderControls() {
  return render(
    <ThemeContext.Provider
      value={{
        currentTheme: defaultTheme,
        setTheme: vi.fn(),
        availableThemes: [defaultTheme],
        ownedThemes: [defaultTheme.id],
        purchaseTheme: vi.fn(async () => true),
      }}
    >
      <SoloRoomControls />
    </ThemeContext.Provider>,
  )
}

describe('SoloRoomControls (go online)', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
    clearPendingRoomSetup()
    createRoomMock.mockClear()
    navigateMock.mockClear()
    capturedOptions = undefined
    vi.mocked(useCreateRoom).mockImplementation((options = {}) => {
      capturedOptions = options
      return {
        phase: 'idle',
        isCreating: false,
        wakingMessage: null,
        error: null,
        createRoom: createRoomMock,
        clearError: vi.fn(),
      }
    })
    vi.mocked(useOnlineStatus).mockReturnValue(true)
  })

  it('carries the current dice + discovery choice into the room it creates', () => {
    useMultiplayerStore.setState({
      roomSettings: { version: 1 },
      dice: new Map([
        ['d1', die('d1', {
          diceType: 'd20',
          presentation: { inventoryDieId: 'inv-1', baseColor: '#abcdef' },
          position: [1, 2, 3],
          rotation: [0, 0, 0, 1],
        })],
        ['d2', die('d2', { diceType: 'd6', position: [-1, 0.5, 2], rotation: [0.1, 0.2, 0.3, 0.9] })],
      ]),
    })

    renderControls()

    // Pick Public + name the room, then create.
    fireEvent.click(screen.getByTestId('solo-visibility-public'))
    fireEvent.change(screen.getByTestId('solo-room-name-input'), { target: { value: 'Game Night' } })
    fireEvent.click(screen.getByTestId('go-online-create'))

    expect(createRoomMock).toHaveBeenCalledOnce()

    // The buffer is keyed to the created room and only claimable by that room.
    expect(consumePendingRoomSetup('SOME-OTHER-ROOM')).toBeNull()
    const setup = consumePendingRoomSetup(CREATED_ROOM_ID)
    expect(setup).not.toBeNull()
    expect(setup!.visibility).toBe('public')
    expect(setup!.roomName).toBe('Game Night')
    expect(setup!.dice).toEqual([
      {
        diceType: 'd20',
        presentation: { inventoryDieId: 'inv-1', baseColor: '#abcdef' },
        position: [1, 2, 3],
        rotation: [0, 0, 0, 1],
      },
      {
        diceType: 'd6',
        presentation: undefined,
        position: [-1, 0.5, 2],
        rotation: [0.1, 0.2, 0.3, 0.9],
      },
    ])
  })

  it('defaults the created room to unlisted and hides the name field', () => {
    renderControls()
    expect(screen.queryByTestId('solo-room-name-input')).toBeNull()

    fireEvent.click(screen.getByTestId('go-online-create'))

    const setup = consumePendingRoomSetup(CREATED_ROOM_ID)
    expect(setup!.visibility).toBe('unlisted')
    expect(setup!.roomName).toBe('')
  })

  it('browses existing rooms', () => {
    renderControls()
    fireEvent.click(screen.getByTestId('go-online-browse'))
    expect(navigateMock).toHaveBeenCalledWith('/rooms')
  })

  it('disables the actions and stashes nothing when offline', () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false)
    renderControls()

    expect(screen.getByTestId('go-online-create')).toBeDisabled()
    expect(screen.getByTestId('go-online-browse')).toBeDisabled()

    fireEvent.click(screen.getByTestId('go-online-create'))
    expect(createRoomMock).not.toHaveBeenCalled()
    expect(consumePendingRoomSetup(CREATED_ROOM_ID)).toBeNull()
  })
})
