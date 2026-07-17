#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const SIZE = 2048
const FACE = 360
const GAP = 22
const OUT = path.resolve('public/artist-resources/imagegen-uv/continuous')

const START_X = Math.round((SIZE - (FACE * 4 + GAP * 3)) / 2)
const START_Y = Math.round((SIZE - (FACE * 4 + GAP * 3)) / 2)

const FACE_LAYOUT = [
  { value: 6, label: 'top +Y', col: 1, row: 0 },
  { value: 4, label: 'left -X', col: 0, row: 1 },
  { value: 2, label: 'front +Z', col: 1, row: 1 },
  { value: 3, label: 'right +X', col: 2, row: 1 },
  { value: 1, label: 'bottom -Y', col: 1, row: 2 },
  { value: 5, label: 'back -Z', col: 1, row: 3 },
]

await mkdir(OUT, { recursive: true })

const guideSvg = renderTemplateSvg({ labels: true })
const cleanSvg = renderTemplateSvg({ labels: false })
const heightSvg = renderHeightSvg()

await writeFile(path.join(OUT, 'd6-continuous-guide.svg'), guideSvg, 'utf8')
await writeFile(path.join(OUT, 'd6-continuous-clean.svg'), cleanSvg, 'utf8')
await writeFile(path.join(OUT, 'd6-continuous-height.svg'), heightSvg, 'utf8')
await rasterizeHeightAndNormal(heightSvg)

console.log(`Generated continuous D6 UV proof assets in ${path.relative(process.cwd(), OUT)}`)

function renderTemplateSvg({ labels }) {
  const faces = FACE_LAYOUT.map((face) => {
    const { x, y } = faceRect(face)
    const panelInset = 42
    const safeInset = 92
    return [
      `<g id="d6-face-${face.value}" data-face-value="${face.value}">`,
      `<rect x="${x}" y="${y}" width="${FACE}" height="${FACE}" rx="16" fill="#0f172a" stroke="#d6b45d" stroke-width="28" />`,
      `<rect x="${x + panelInset}" y="${y + panelInset}" width="${FACE - panelInset * 2}" height="${FACE - panelInset * 2}" rx="8" fill="#1d4ed8" stroke="#f6d978" stroke-width="8" />`,
      `<rect x="${x + safeInset}" y="${y + safeInset}" width="${FACE - safeInset * 2}" height="${FACE - safeInset * 2}" rx="4" fill="none" stroke="#fef08a" stroke-width="4" stroke-dasharray="16 10" />`,
      labels ? `<text x="${x + FACE / 2}" y="${y + FACE / 2 - 8}" text-anchor="middle" dominant-baseline="middle" fill="#fff7c2" font-family="Georgia, serif" font-size="118" font-weight="700">${face.value}</text>` : '',
      labels ? `<text x="${x + FACE / 2}" y="${y + FACE / 2 + 72}" text-anchor="middle" dominant-baseline="middle" fill="#e5e7eb" font-family="Arial, sans-serif" font-size="26">${face.label}</text>` : '',
      '</g>',
    ].filter(Boolean).join('\n')
  }).join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    '<rect width="100%" height="100%" fill="#111827" />',
    '<text x="96" y="112" fill="#f9fafb" font-family="Arial, sans-serif" font-size="44" font-weight="700">D6 Continuous UV Sheet Proof</text>',
    '<text x="96" y="158" fill="#d1d5db" font-family="Arial, sans-serif" font-size="26">Cube cross with shared edge intent: gold trim, blue inset panels, deterministic face values.</text>',
    faces,
    '</svg>',
    '',
  ].join('\n')
}

function renderHeightSvg() {
  const faces = FACE_LAYOUT.map((face) => {
    const { x, y } = faceRect(face)
    const panelInset = 42
    return [
      `<rect x="${x}" y="${y}" width="${FACE}" height="${FACE}" rx="16" fill="#5c5c5c" />`,
      `<rect x="${x + panelInset}" y="${y + panelInset}" width="${FACE - panelInset * 2}" height="${FACE - panelInset * 2}" rx="8" fill="#1f1f1f" />`,
      `<rect x="${x + 11}" y="${y + 11}" width="${FACE - 22}" height="${FACE - 22}" rx="12" fill="none" stroke="#f4f4f4" stroke-width="30" />`,
      `<text x="${x + FACE / 2}" y="${y + FACE / 2 + 42}" text-anchor="middle" fill="#ffffff" font-family="Georgia, serif" font-size="154" font-weight="700">${face.value}</text>`,
    ].join('\n')
  }).join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    '<rect width="100%" height="100%" fill="#000000" />',
    faces,
    '</svg>',
    '',
  ].join('\n')
}

async function rasterizeHeightAndNormal(svg) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } })
  const result = await page.evaluate(async ({ svg, size }) => {
    const image = new Image()
    image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
    await image.decode()

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const heightData = ctx.getImageData(0, 0, size, size)
    const normalData = ctx.createImageData(size, size)
    const strength = 7.5

    const heightAt = (x, y) => {
      const clampedX = Math.max(0, Math.min(size - 1, x))
      const clampedY = Math.max(0, Math.min(size - 1, y))
      return heightData.data[(clampedY * size + clampedX) * 4] / 255
    }

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * strength
        const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * strength
        const length = Math.sqrt(dx * dx + dy * dy + 1)
        const nx = -dx / length
        const ny = -dy / length
        const nz = 1 / length
        const offset = (y * size + x) * 4
        normalData.data[offset] = Math.round((nx * 0.5 + 0.5) * 255)
        normalData.data[offset + 1] = Math.round((ny * 0.5 + 0.5) * 255)
        normalData.data[offset + 2] = Math.round((nz * 0.5 + 0.5) * 255)
        normalData.data[offset + 3] = 255
      }
    }

    const normalCanvas = document.createElement('canvas')
    normalCanvas.width = size
    normalCanvas.height = size
    normalCanvas.getContext('2d').putImageData(normalData, 0, 0)

    return {
      height: canvas.toDataURL('image/png').split(',')[1],
      normal: normalCanvas.toDataURL('image/png').split(',')[1],
    }
  }, { svg, size: SIZE })

  await browser.close()
  await writeFile(path.join(OUT, 'd6-continuous-height.png'), Buffer.from(result.height, 'base64'))
  await writeFile(path.join(OUT, 'd6-continuous-normal.png'), Buffer.from(result.normal, 'base64'))
}

function faceRect(face) {
  return {
    x: START_X + face.col * (FACE + GAP),
    y: START_Y + face.row * (FACE + GAP),
  }
}
