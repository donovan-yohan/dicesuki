import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace } from 'three'

/** Original brush-mark albedos, generated once. No extracted game artwork. */
export function createGrassAlbedoTextures(): { ground: DataTexture; blade: DataTexture } {
  let seed = 0x6273cfe1
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const size = 128
  const groundBytes = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const shade = 216 + Math.round(5 * Math.sin(x / size * Math.PI * 2) * Math.cos(y / size * Math.PI * 2))
    groundBytes.set([shade - 6, shade + 2, shade - 10, 255], (y * size + x) * 4)
  }
  // Short, tapered brush marks wrap at tile edges, avoiding cut-off strokes.
  for (let mark = 0; mark < 520; mark++) {
    const cx = random() * size, cy = random() * size
    const angle = random() * Math.PI * 2
    const c = Math.cos(angle), s = Math.sin(angle)
    const length = 5 + random() * 8, width = 0.9 + random() * 1.5
    const ink = (random() - 0.48) * 38
    const extent = Math.ceil(length + width)
    for (let dy = -extent; dy <= extent; dy++) for (let dx = -extent; dx <= extent; dx++) {
      const along = dx * c + dy * s
      const across = -dx * s + dy * c
      const t = along / length + 0.5
      if (t < 0 || t > 1) continue
      const taper = Math.sin(t * Math.PI)
      const opacity = Math.max(0, 1 - Math.abs(across) / (width * taper + 0.01)) * 0.7
      if (opacity <= 0) continue
      const x = ((Math.floor(cx) + dx) % size + size) % size
      const y = ((Math.floor(cy) + dy) % size + size) % size
      const offset = (y * size + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        groundBytes[offset + channel] = Math.max(175, Math.min(242, Math.round(groundBytes[offset + channel] + ink * opacity)))
      }
    }
  }
  const ground = new DataTexture(groundBytes, size, size, RGBAFormat)
  ground.wrapS = ground.wrapT = RepeatWrapping
  const bladeBytes = new Uint8Array(32 * 128 * 4)
  for (let y = 0; y < 128; y++) for (let x = 0; x < 32; x++) {
    const across = x / 31 * 2 - 1
    const height = y / 127
    const rib = Math.exp(-across * across * 70)
    const shade = Math.round(210 + height * 20 + rib * 10 - Math.abs(across) * 7 + Math.sin(height * 17 + across * 3) * 3)
    bladeBytes.set([shade - 3, shade + 2, shade - 5, 255], (y * 32 + x) * 4)
  }
  const blade = new DataTexture(bladeBytes, 32, 128, RGBAFormat)
  for (const texture of [ground, blade]) {
    texture.colorSpace = SRGBColorSpace
    texture.magFilter = LinearFilter
    texture.minFilter = LinearMipmapLinearFilter
    texture.generateMipmaps = true
    texture.needsUpdate = true
  }
  return { ground, blade }
}
