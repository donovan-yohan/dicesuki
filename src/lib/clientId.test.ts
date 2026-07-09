import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClientId } from './clientId'

describe('createClientId', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => '11111111-2222-4333-8444-555555555555'),
    })

    expect(createClientId('die')).toBe('die_11111111-2222-4333-8444-555555555555')
  })

  it('falls back to getRandomValues when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: vi.fn((bytes: Uint8Array) => {
        bytes.set([
          0x00, 0x11, 0x22, 0x33,
          0x44, 0x55,
          0x66, 0x77,
          0x88, 0x99,
          0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
        ])
        return bytes
      }),
    })

    expect(createClientId('die')).toBe('die_00112233-4455-4677-8899-aabbccddeeff')
  })

  it('falls back to a timestamp token when crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined)
    vi.spyOn(Date, 'now').mockReturnValue(1_783_606_900_000)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    expect(createClientId('roll')).toBe('roll_mrdlhvz4_i')
  })
})
