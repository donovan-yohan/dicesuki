#!/usr/bin/env node
import { DICE_SHAPES, createAtlasLayout, validateAtlas } from './dice-atlas.mjs'

const failures = []

for (const shape of DICE_SHAPES) {
  const layout = createAtlasLayout(shape)
  const result = validateAtlas(layout)
  if (!result.valid) {
    failures.push(`${shape}:\n${result.errors.map((error) => `  - ${error}`).join('\n')}`)
  }
}

if (failures.length > 0) {
  console.error(`ImageGen UV atlas validation failed:\n${failures.join('\n\n')}`)
  process.exit(1)
}

console.log(`ImageGen UV atlas validation passed for ${DICE_SHAPES.join(', ')}`)
