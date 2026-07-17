type CryptoLike = {
  randomUUID?: () => string
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T
}

function randomBytesUuid(cryptoObject: CryptoLike): string {
  const bytes = new Uint8Array(16)
  cryptoObject.getRandomValues?.(bytes)

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

export function createRandomId(cryptoObject: CryptoLike | null | undefined = globalThis.crypto): string {
  if (typeof cryptoObject?.randomUUID === 'function') {
    return cryptoObject.randomUUID()
  }

  if (typeof cryptoObject?.getRandomValues === 'function') {
    return randomBytesUuid(cryptoObject)
  }

  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`
}
