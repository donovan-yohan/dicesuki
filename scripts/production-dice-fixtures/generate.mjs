#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import {
  PRODUCTION_FIXTURE_SETS,
  getFixtureFaceNormals,
} from './fixture-data.mjs'
import { createImageGenD20Glb } from './imagegen-atlas-glb.mjs'

const DICE_DIR = path.resolve('public/dice')
const require = createRequire(import.meta.url)
const THREE_PACKAGE_DIR = path.resolve(path.dirname(require.resolve('three')), '..')
const FONT_PATH = path.join(THREE_PACKAGE_DIR, 'examples/fonts/helvetiker_bold.typeface.json')

installFileReaderPolyfill()
const font = await loadFont()

for (const set of PRODUCTION_FIXTURE_SETS) {
  const setDir = path.join(DICE_DIR, set.id)
  await mkdir(setDir, { recursive: true })

  const { dice, ...setMetadata } = set
  await writeJson(path.join(setDir, 'set.json'), setMetadata)

  for (const die of dice) {
    const dieDir = path.join(setDir, die.id)
    await mkdir(dieDir, { recursive: true })

    const faceNormals = getFixtureFaceNormals(die.diceType)
    const glb = die.imagegenAtlas
      ? await createImageGenD20Glb({
          ...die.imagegenAtlas,
          roughness: die.material.roughness,
          metalness: die.material.metalness,
        })
      : await exportGlb(createFixtureModel(die, faceNormals))
    await writeFile(path.join(dieDir, 'model.glb'), Buffer.from(glb))

    await writeJson(path.join(dieDir, 'metadata.json'), {
      version: '1.0',
      diceType: die.diceType,
      name: die.name,
      artist: die.artist ?? set.artist,
      created: set.releaseDate,
      scale: 1.0,
      rarity: die.rarity,
      description: die.description,
      ...(die.imagegenAtlas
        ? { uvManifestUrl: `/${die.imagegenAtlas.manifestPath.replace(/^public\//, '')}` }
        : {}),
      tags: [
        ...set.tags,
        die.diceType,
        'numbered-faces',
        'raised-trim',
        ...(die.imagegenAtlas ? ['codex-imagegen', 'uv-atlas', 'derived-normal-map'] : []),
      ],
      faceNormals,
      physics: {
        density: die.material.metalness > 0.5 ? 0.6 : 0.3,
        restitution: 0.32,
        friction: 0.65,
      },
      colliderType: die.diceType === 'd6' ? 'roundCuboid' : 'hull',
      colliderArgs: die.diceType === 'd6'
        ? { halfExtents: [0.5, 0.5, 0.5], borderRadius: 0.06 }
        : {},
    })
  }
}

console.log(`Generated ${PRODUCTION_FIXTURE_SETS.length} production dice fixture set(s) in ${DICE_DIR}`)

function createFixtureModel(die, faceNormals) {
  const group = new THREE.Group()
  group.name = die.name.replaceAll(' ', '_')

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: die.bodyColor,
    roughness: die.material.roughness,
    metalness: die.material.metalness,
    flatShading: true,
  })

  const bodyGeometry = die.diceType === 'd6'
    ? new THREE.BoxGeometry(1, 1, 1)
    : new THREE.IcosahedronGeometry(0.72, 0)

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
  body.name = `${die.id}_body`
  group.add(body)

  const panelMaterial = new THREE.MeshStandardMaterial({
    color: die.panelColor,
    roughness: Math.min(0.9, die.material.roughness + 0.12),
    metalness: Math.max(0, die.material.metalness - 0.35),
    side: THREE.DoubleSide,
  })
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: die.trimColor,
    roughness: 0.28,
    metalness: 0.9,
    side: THREE.DoubleSide,
  })
  const numberMaterial = new THREE.MeshStandardMaterial({
    color: die.numberColor,
    roughness: 0.22,
    metalness: 0.88,
  })

  const faceCenters = getFaceCenters(bodyGeometry)

  for (const face of faceNormals) {
    const normal = vectorFromArray(face.normal).normalize()
    const faceCenter = findFaceCenter(faceCenters, normal) ?? normal.clone().multiplyScalar(die.diceType === 'd6' ? 0.505 : 0.58)
    addFacePanel(group, faceCenter, normal, die.diceType, panelMaterial)
    addFaceFrame(group, faceCenter, normal, die.diceType, trimMaterial)
    addTextNumber(group, String(face.value), faceCenter, normal, die.diceType, numberMaterial)
  }

  return group
}

function addFacePanel(group, center, normal, diceType, material) {
  const { tangent, bitangent } = createFaceBasis(normal)
  const radius = diceType === 'd6' ? 0.36 : 0.205
  const panelCenter = center.clone().addScaledVector(normal, 0.011)
  const sides = diceType === 'd6' ? 4 : 3
  const rotation = diceType === 'd6' ? Math.PI / 4 : -Math.PI / 2
  const points = Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (Math.PI * 2 * index) / sides
    return panelCenter
      .clone()
      .addScaledVector(tangent, Math.cos(angle) * radius)
      .addScaledVector(bitangent, Math.sin(angle) * radius)
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap((point) => point.toArray()), 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(points.flatMap(() => normal.toArray()), 3))
  geometry.setIndex(sides === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2])
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'inset_face_panel'
  group.add(mesh)
}

function addFaceFrame(group, center, normal, diceType, material) {
  const { tangent, bitangent } = createFaceBasis(normal)
  const radius = diceType === 'd6' ? 0.39 : 0.225
  const insetCenter = center.clone().addScaledVector(normal, 0.018)
  const sides = diceType === 'd6' ? 4 : 3
  const points = Array.from({ length: sides }, (_, index) => {
    const angle = (diceType === 'd6' ? Math.PI / 4 : -Math.PI / 2) + (Math.PI * 2 * index) / sides
    return insetCenter
      .clone()
      .addScaledVector(tangent, Math.cos(angle) * radius)
      .addScaledVector(bitangent, Math.sin(angle) * radius)
  })

  const lineWidth = diceType === 'd6' ? 0.038 : 0.021
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    addQuadStrip(group, a, b, normal, lineWidth, material, 'face_frame')
  }
}

function addTextNumber(group, value, center, normal, diceType, material) {
  const { tangent, bitangent } = createFaceBasis(normal)
  const size = diceType === 'd6' ? 0.36 : 0.17
  const maxWidth = diceType === 'd6' ? 0.46 : 0.24
  const maxHeight = diceType === 'd6' ? 0.44 : 0.19
  const depth = diceType === 'd6' ? 0.026 : 0.012
  const geometry = new TextGeometry(value, {
    font,
    size,
    depth,
    curveSegments: 4,
    bevelEnabled: true,
    bevelThickness: depth * 0.28,
    bevelSize: depth * 0.22,
    bevelSegments: 1,
  })
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (!box) return

  const width = box.max.x - box.min.x
  const height = box.max.y - box.min.y
  const currentDepth = Math.max(box.max.z - box.min.z, 0.0001)
  const scale = Math.min(maxWidth / width, maxHeight / height, 1)
  geometry.scale(scale, scale, depth / currentDepth)
  geometry.computeBoundingBox()
  const scaledBox = geometry.boundingBox
  if (!scaledBox) return
  geometry.translate(
    -(scaledBox.min.x + scaledBox.max.x) / 2,
    -(scaledBox.min.y + scaledBox.max.y) / 2,
    0,
  )

  const matrix = new THREE.Matrix4().makeBasis(tangent, bitangent, normal)
  matrix.setPosition(center.clone().addScaledVector(normal, diceType === 'd6' ? 0.032 : 0.026))
  geometry.applyMatrix4(matrix)

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = `face_${value}_beveled_number`
  group.add(mesh)
}

function addQuadStrip(group, a, b, normal, width, material, name) {
  const edge = b.clone().sub(a)
  const side = new THREE.Vector3().crossVectors(normal, edge).normalize().multiplyScalar(width / 2)
  const corners = [
    a.clone().add(side),
    b.clone().add(side),
    b.clone().sub(side),
    a.clone().sub(side),
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap((corner) => corner.toArray()), 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    ...normal.toArray(),
    ...normal.toArray(),
    ...normal.toArray(),
    ...normal.toArray(),
  ], 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  group.add(mesh)
}

function getFaceCenters(geometry) {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const centers = []
  const readVertex = (vertexIndex) => new THREE.Vector3().fromBufferAttribute(position, vertexIndex)

  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      centers.push(centerForTriangle(readVertex(index.getX(i)), readVertex(index.getX(i + 1)), readVertex(index.getX(i + 2))))
    }
  } else {
    for (let i = 0; i < position.count; i += 3) {
      centers.push(centerForTriangle(readVertex(i), readVertex(i + 1), readVertex(i + 2)))
    }
  }

  return centers
}

function centerForTriangle(a, b, c) {
  const center = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3)
  const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
  return { center, normal }
}

function findFaceCenter(faceCenters, expectedNormal) {
  let best = null
  let bestDot = -Infinity
  for (const candidate of faceCenters) {
    const dot = candidate.normal.dot(expectedNormal)
    if (dot > bestDot) {
      bestDot = dot
      best = candidate
    }
  }
  return bestDot > 0.98 ? best.center : null
}

function createFaceBasis(normal) {
  const reference = Math.abs(normal.y) > 0.92
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3().crossVectors(reference, normal).normalize()
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize()
  return { tangent, bitangent }
}

function vectorFromArray(value) {
  return new THREE.Vector3(value[0], value[1], value[2])
}

async function exportGlb(model) {
  const exporter = new GLTFExporter()
  return await new Promise((resolve, reject) => {
    exporter.parse(model, resolve, reject, {
      binary: true,
      trs: false,
      onlyVisible: true,
    })
  })
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function loadFont() {
  const rawFont = await readFile(FONT_PATH, 'utf8')
  return new FontLoader().parse(JSON.parse(rawFont))
}

function installFileReaderPolyfill() {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer()
        .then((buffer) => {
          this.result = buffer
          this.onloadend?.({ target: this })
        })
        .catch((error) => this.onerror?.(error))
    }

    readAsDataURL(blob) {
      blob.arrayBuffer()
        .then((buffer) => {
          const mimeType = blob.type || 'application/octet-stream'
          this.result = `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`
          this.onloadend?.({ target: this })
        })
        .catch((error) => this.onerror?.(error))
    }
  }
}
