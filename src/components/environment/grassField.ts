function hash(x: number, z: number, seed: number) {
  let value = Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ seed
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295
}

function noise(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z)
  const fx = x - ix, fz = z - iz
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz)
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed)
  const c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed)
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v
}

/** Coherent density and palette sampled in world units, independent of arena size. */
export function sampleGrassField(x: number, z: number, seed: number) {
  const wx = x + (noise(x * 0.17 + 13.7, z * 0.17 - 5.2, seed) - 0.5) * 2.6
  const wz = z + (noise(x * 0.17 - 8.1, z * 0.17 + 21.4, seed ^ 0x5a731) - 0.5) * 2.6
  const broad = noise(wx * 0.29 + 17.3, wz * 0.29 - 7.6, seed)
  const medium = noise(wx * 0.73 - 4.7, wz * 0.73 + 11.8, seed ^ 0x71ac93d5)
  const patch = broad * 0.7 + medium * 0.3
  const growth = Math.max(0, Math.min(1, (patch - 0.36) / 0.3))
  return { density: growth * growth * (3 - 2 * growth), patch }
}
