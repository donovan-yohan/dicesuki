import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildRoomUrl, copyToClipboard, shareRoomLink } from './roomLinks'

describe('buildRoomUrl', () => {
  it('builds the canonical /room/:roomId URL from the provided origin', () => {
    expect(buildRoomUrl('ABC123', { origin: 'https://dice.app' })).toBe(
      'https://dice.app/room/ABC123',
    )
  })

  it('appends ?server=local when local is true', () => {
    expect(buildRoomUrl('ABC123', { origin: 'https://dice.app', local: true })).toBe(
      'https://dice.app/room/ABC123?server=local',
    )
  })

  it('strips a trailing slash from the origin', () => {
    expect(buildRoomUrl('r1', { origin: 'https://dice.app/' })).toBe(
      'https://dice.app/room/r1',
    )
  })

  it('url-encodes the room id', () => {
    expect(buildRoomUrl('a b/c', { origin: 'https://x' })).toBe(
      'https://x/room/a%20b%2Fc',
    )
  })

  it('throws on an empty room id', () => {
    expect(() => buildRoomUrl('  ', { origin: 'https://x' })).toThrow()
    expect(() => buildRoomUrl('', { origin: 'https://x' })).toThrow()
  })
})

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error cleanup test override
    delete navigator.clipboard
  })

  it('uses the async Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const ok = await copyToClipboard('hello')

    expect(ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to execCommand when the Clipboard API is unavailable', async () => {
    // No navigator.clipboard defined.
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand

    const ok = await copyToClipboard('fallback-text')

    expect(ok).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('falls back to execCommand when writeText rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand

    const ok = await copyToClipboard('x')

    expect(ok).toBe(true)
    expect(execCommand).toHaveBeenCalled()
  })
})

describe('shareRoomLink', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error cleanup test override
    delete navigator.share
    // @ts-expect-error cleanup test override
    delete navigator.clipboard
  })

  it('returns "shared" when the native share sheet completes', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    const outcome = await shareRoomLink({ url: 'https://x/room/1', title: 't' })

    expect(outcome).toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: 't', text: undefined, url: 'https://x/room/1' })
  })

  it('returns "dismissed" when the user cancels (AbortError)', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError'))
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    const outcome = await shareRoomLink({ url: 'https://x/room/1' })

    expect(outcome).toBe('dismissed')
  })

  it('falls back to copy (returns "copied") when Web Share is unsupported', async () => {
    // No navigator.share.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const outcome = await shareRoomLink({ url: 'https://x/room/1' })

    expect(outcome).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('https://x/room/1')
  })

  it('returns "error" when share fails and copy also fails', async () => {
    const share = vi.fn().mockRejectedValue(new Error('boom'))
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    // No clipboard API; execCommand reports failure.
    document.execCommand = vi.fn().mockReturnValue(false)

    const outcome = await shareRoomLink({ url: 'https://x/room/1' })

    expect(outcome).toBe('error')
  })
})
