#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import sharp from 'sharp'

export async function createRuntimeThumbnail(sourcePath, outputPath) {
  await sharp(sourcePath)
    .extract({ left: 104, top: 104, width: 512, height: 512 })
    .resize(320, 320, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: true,
      quality: 90,
      effort: 10,
    })
    .toFile(outputPath)
}

async function main() {
  const [sourcePath, outputPath] = process.argv.slice(2)
  if (!sourcePath || !outputPath || process.argv.length !== 4) {
    throw new Error('Usage: capture-thumbnails.mjs <720px-source.png> <thumbnail.png>')
  }
  await createRuntimeThumbnail(path.resolve(sourcePath), path.resolve(outputPath))
}

if (process.argv[1]?.endsWith('capture-thumbnails.mjs')) await main()
