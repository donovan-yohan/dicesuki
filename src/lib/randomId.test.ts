import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRandomId } from './randomId'

describe('createRandomId', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses native randomUUID when available', () => {
    expect(createRandomId({ randomUUID: () => 'native-id' })).toBe('native-id')
  })

  it('generates a UUID from getRandomValues when randomUUID is unavailable', () => {
    const id = createRandomId({
      getRandomValues: (array) => {
        const bytes = array as unknown as Uint8Array
        bytes.set([
          0x00, 0x11, 0x22, 0x33,
          0x44, 0x55,
          0x66, 0x77,
          0x88, 0x99,
          0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
        ])
        return array
      },
    })

    expect(id).toBe('00112233-4455-4677-8899-aabbccddeeff')
  })

  it('falls back to a local id when Web Crypto is unavailable', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1783629899265)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    expect(createRandomId(null)).toBe('id_mrdz6ubl_i')
  })
})
