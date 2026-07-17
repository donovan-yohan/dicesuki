import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  CANONICAL_CANVAS_SIZE,
  CANONICAL_MANIFEST_VERSION,
  SUPPORTED_DICE_SHAPES,
  validateManifestStructure,
} from './canonical-dice-contract.mjs'

const CANONICAL_REFERENCE_DIRECTORY = fileURLToPath(new URL('./fixtures/', import.meta.url))
const CANONICAL_REFERENCE_PATTERN = /^canonical-contract-v(\d+)\.json$/

export function listCanonicalReferencePaths(directory = CANONICAL_REFERENCE_DIRECTORY) {
  return readdirSync(directory)
    .filter((file) => CANONICAL_REFERENCE_PATTERN.test(file))
    .sort((first, second) => referenceVersionFromPath(first) - referenceVersionFromPath(second))
    .map((file) => path.join(directory, file))
}

export function selectCanonicalReferencePath(directory = CANONICAL_REFERENCE_DIRECTORY) {
  const referencePath = listCanonicalReferencePaths(directory).at(-1)
  if (!referencePath) throw new Error('No canonical ImageGen reference fixtures found')
  return referencePath
}

export const CANONICAL_REFERENCE_URL = pathToFileURL(selectCanonicalReferencePath())

export function loadCanonicalReference(referencePath = CANONICAL_REFERENCE_URL) {
  const value = JSON.parse(readFileSync(referencePath, 'utf8'))
  const declaredVersion = referenceVersionFromPath(fileURLToPathOrPath(referencePath))
  if (value.referenceVersion !== declaredVersion) {
    throw new Error(
      `${path.basename(fileURLToPathOrPath(referencePath))} must declare referenceVersion ${declaredVersion}`,
    )
  }
  return value
}

export function validateCanonicalManifest(manifest, reference = loadCanonicalReference()) {
  const structural = validateManifestStructure(manifest)
  const errors = [...structural.errors]
  const expected = reference.shapes?.[manifest?.shape]

  if (!Number.isInteger(reference.referenceVersion) || reference.referenceVersion < 1) {
    errors.push(`unsupported canonical reference version ${reference.referenceVersion}`)
  }
  if (reference.manifestVersion !== CANONICAL_MANIFEST_VERSION) {
    errors.push(`reference expects manifest version ${reference.manifestVersion}`)
  }
  if (reference.canvasSize !== CANONICAL_CANVAS_SIZE) {
    errors.push(`reference expects ${reference.canvasSize}px canvas`)
  }
  if (!expected) {
    errors.push(`canonical reference has no ${manifest?.shape} entry`)
    return { valid: false, errors }
  }

  if (manifest.faceValues?.join(',') !== expected.faceValues.join(',')) {
    errors.push(`canonical face order drifted for ${manifest.shape}`)
  }
  if (JSON.stringify(manifest.materialMap) !== JSON.stringify(expected.materialMap)) {
    errors.push(`canonical face/material mapping drifted for ${manifest.shape}`)
  }

  for (const island of manifest.islands ?? []) {
    const expectedFace = expected.faces.find((face) => face.value === island.faceValue)
    if (!expectedFace) {
      errors.push(`canonical reference has no ${manifest.shape} face ${island.faceValue}`)
      continue
    }
    if (island.materialIndex !== expectedFace.materialIndex) {
      errors.push(`${manifest.shape} face ${island.faceValue} material mapping drifted`)
    }
    if (island.triangleIndices?.join(',') !== expectedFace.triangleIndices.join(',')) {
      errors.push(`${manifest.shape} face ${island.faceValue} triangle grouping drifted`)
    }
  }

  const uvDigest = digestCanonicalUvContract(manifest)
  const meshDigest = digestCanonicalMeshContract(manifest)
  if (uvDigest !== expected.uvDigest) {
    errors.push(`canonical UV mapping drifted for ${manifest.shape}: ${uvDigest}`)
  }
  if (meshDigest !== expected.meshDigest) {
    errors.push(`canonical mesh topology drifted for ${manifest.shape}: ${meshDigest}`)
  }

  return { valid: errors.length === 0, errors, uvDigest, meshDigest }
}

export function buildCanonicalReference(manifests, provenance, referenceVersion) {
  const byShape = new Map(manifests.map((manifest) => [manifest.shape, manifest]))
  const missing = SUPPORTED_DICE_SHAPES.filter((shape) => !byShape.has(shape))
  if (missing.length > 0) throw new Error(`Missing canonical manifests: ${missing.join(', ')}`)
  if (!Number.isInteger(referenceVersion) || referenceVersion < 1) {
    throw new Error(`Invalid canonical reference version ${referenceVersion}`)
  }

  return {
    referenceVersion,
    manifestVersion: CANONICAL_MANIFEST_VERSION,
    canvasSize: CANONICAL_CANVAS_SIZE,
    provenance,
    shapes: Object.fromEntries(SUPPORTED_DICE_SHAPES.map((shape) => {
      const manifest = byShape.get(shape)
      const structural = validateManifestStructure(manifest)
      if (!structural.valid) {
        throw new Error(`${shape} cannot become a reference:\n${structural.errors.join('\n')}`)
      }
      return [shape, {
        faceValues: manifest.faceValues,
        materialMap: manifest.materialMap,
        faces: manifest.islands.map((island) => ({
          value: island.faceValue,
          materialIndex: island.materialIndex,
          triangleIndices: island.triangleIndices,
        })),
        uvDigest: digestCanonicalUvContract(manifest),
        meshDigest: digestCanonicalMeshContract(manifest),
      }]
    })),
  }
}

export function digestCanonicalUvContract(manifest) {
  return sha256({
    version: manifest.version,
    shape: manifest.shape,
    canvasSize: manifest.canvasSize,
    faceValues: manifest.faceValues,
    materialMap: manifest.materialMap,
    islands: manifest.islands?.map((island) => ({
      faceValue: island.faceValue,
      materialIndex: island.materialIndex,
      triangleIndices: island.triangleIndices,
      points: island.points,
      safePoints: island.safePoints,
      baselineEdge: island.baselineEdge,
      baselineAngleDegrees: island.baselineAngleDegrees,
      uvByTriangle: island.uvByTriangle,
      sharedAtlasIsland: island.sharedAtlasIsland,
    })),
  })
}

export function digestCanonicalMeshContract(manifest) {
  return sha256({
    version: manifest.version,
    shape: manifest.shape,
    geometry: manifest.geometry,
    canonicalFaceCount: manifest.canonicalFaceCount,
    canonicalTriangleCount: manifest.canonicalTriangleCount,
    trianglesPerFace: manifest.trianglesPerFace,
    islands: manifest.islands?.map((island) => ({
      faceValue: island.faceValue,
      materialIndex: island.materialIndex,
      meshTriangles: island.meshTriangles,
    })),
  })
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function referenceVersionFromPath(referencePath) {
  return Number(path.basename(referencePath).match(CANONICAL_REFERENCE_PATTERN)?.[1])
}

function fileURLToPathOrPath(value) {
  return value instanceof URL ? fileURLToPath(value) : path.resolve(value)
}
