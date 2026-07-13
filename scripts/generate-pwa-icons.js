#!/usr/bin/env node

/**
 * Generate PWA Icons
 *
 * Produces the dice-themed PNG icons the web app manifest references
 * (issue #116). Runs with zero native dependencies — a tiny hand-rolled RGBA
 * canvas rasterized to PNG via Node's built-in `zlib`, so it works in CI and
 * on machines without ImageMagick/sharp installed.
 *
 * Output (public/icons/):
 *   pwa-192x192.png            — standard install icon
 *   pwa-512x512.png            — standard install / splash icon
 *   pwa-512x512-maskable.png   — maskable (content within the safe zone)
 *   apple-touch-icon.png       — 180x180 iOS home-screen icon
 *   favicon.svg                — crisp scalable tab icon
 *
 * Usage: node scripts/generate-pwa-icons.js
 */

import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, '..', 'public', 'icons')

// Brand palette (matches theme-color / manifest).
const BRAND = [0x58, 0x65, 0xf2] // #5865F2 Discord blurple
const BRAND_DEEP = [0x3b, 0x45, 0xb5] // darker blurple for the gradient base
const WHITE = [0xff, 0xff, 0xff]
const PIP = [0x2a, 0x2f, 0x4a] // dark slate pips

/** Simple RGBA canvas. */
class Canvas {
  constructor(size) {
    this.size = size
    this.data = Buffer.alloc(size * size * 4)
  }
  set(x, y, [r, g, b], a = 255) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return
    const i = (y * this.size + x) * 4
    // Alpha-blend over existing pixel.
    const ia = a / 255
    const inv = 1 - ia
    this.data[i] = Math.round(r * ia + this.data[i] * inv)
    this.data[i + 1] = Math.round(g * ia + this.data[i + 1] * inv)
    this.data[i + 2] = Math.round(b * ia + this.data[i + 2] * inv)
    this.data[i + 3] = Math.max(this.data[i + 3], a)
  }
  fillBackgroundGradient() {
    for (let y = 0; y < this.size; y++) {
      const t = y / (this.size - 1)
      const c = [
        Math.round(BRAND[0] * (1 - t) + BRAND_DEEP[0] * t),
        Math.round(BRAND[1] * (1 - t) + BRAND_DEEP[1] * t),
        Math.round(BRAND[2] * (1 - t) + BRAND_DEEP[2] * t),
      ]
      for (let x = 0; x < this.size; x++) this.set(x, y, c, 255)
    }
  }
  // Anti-aliased filled circle.
  disc(cx, cy, r, color) {
    const x0 = Math.floor(cx - r - 1)
    const x1 = Math.ceil(cx + r + 1)
    const y0 = Math.floor(cy - r - 1)
    const y1 = Math.ceil(cy + r + 1)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        const a = Math.max(0, Math.min(1, r - d + 0.5))
        if (a > 0) this.set(x, y, color, Math.round(a * 255))
      }
    }
  }
  // Anti-aliased rounded square (die body).
  roundedSquare(cx, cy, half, radius, color) {
    const x0 = Math.floor(cx - half - 1)
    const x1 = Math.ceil(cx + half + 1)
    const y0 = Math.floor(cy - half - 1)
    const y1 = Math.ceil(cy + half + 1)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = Math.abs(x + 0.5 - cx)
        const dy = Math.abs(y + 0.5 - cy)
        const inner = half - radius
        let dist
        if (dx <= inner || dy <= inner) {
          dist = Math.max(dx, dy) - half // straight edges
        } else {
          dist = Math.hypot(dx - inner, dy - inner) - radius // rounded corners
        }
        const a = Math.max(0, Math.min(1, -dist + 0.5))
        if (a > 0) this.set(x, y, color, Math.round(a * 255))
      }
    }
  }
  toPNG() {
    return encodePNG(this.size, this.size, this.data)
  }
}

/** Minimal PNG encoder (truecolor + alpha, filter 0). */
function encodePNG(width, height, rgba) {
  const bytesPerPixel = 4
  const stride = width * bytesPerPixel
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })

  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const typeBuf = Buffer.from(type, 'ascii')
    const body = Buffer.concat([typeBuf, data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0, 0)
    return Buffer.concat([len, body, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Draw a die face (rounded square + pips) centered on the canvas.
 * `contentScale` shrinks the die so maskable icons keep the face inside the
 * platform safe zone (~80% of the canvas).
 */
function drawDie(canvas, contentScale) {
  canvas.fillBackgroundGradient()
  const s = canvas.size
  const cx = s / 2
  const cy = s / 2
  const half = (s / 2) * 0.62 * contentScale
  const radius = half * 0.28
  canvas.roundedSquare(cx, cy, half, radius, WHITE)

  // Classic "5" face: four corners + center.
  const off = half * 0.44
  const pipR = half * 0.13
  const pips = [
    [cx - off, cy - off],
    [cx + off, cy - off],
    [cx, cy],
    [cx - off, cy + off],
    [cx + off, cy + off],
  ]
  for (const [px, py] of pips) canvas.disc(px, py, pipR, PIP)
}

function make(size, name, contentScale = 1) {
  const canvas = new Canvas(size)
  drawDie(canvas, contentScale)
  fs.writeFileSync(path.join(OUT_DIR, name), canvas.toPNG())
  return name
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5865F2"/>
      <stop offset="1" stop-color="#3B45B5"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <rect x="16" y="16" width="32" height="32" rx="8" fill="#fff"/>
  <g fill="#2A2F4A">
    <circle cx="24" cy="24" r="3"/>
    <circle cx="40" cy="24" r="3"/>
    <circle cx="32" cy="32" r="3"/>
    <circle cx="24" cy="40" r="3"/>
    <circle cx="40" cy="40" r="3"/>
  </g>
</svg>
`

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const written = [
    make(192, 'pwa-192x192.png'),
    make(512, 'pwa-512x512.png'),
    make(512, 'pwa-512x512-maskable.png', 0.8),
    make(180, 'apple-touch-icon.png'),
  ]
  fs.writeFileSync(path.join(OUT_DIR, 'favicon.svg'), FAVICON_SVG)
  written.push('favicon.svg')
  console.log(`Generated ${written.length} PWA icons in public/icons/:`)
  for (const name of written) console.log(`  - ${name}`)
}

main()
