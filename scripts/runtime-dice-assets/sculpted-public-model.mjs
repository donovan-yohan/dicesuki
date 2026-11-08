import { createHash } from 'node:crypto'

export const PUBLIC_MODEL_TRANSFORM = 'woodland-scene-authoring-extras-v1'
export const AUTHORING_SCENE_EXTRAS = Object.freeze([
  'type_source_scene', 'selected_source_scene', 'inset_base_scene',
  'inset_recovered_source', 'canonical_export_metadata', 'source_hashes',
])
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const requireThat = (condition, message) => { if (!condition) throw Error(message) }

function splitGlb(bytes) {
  requireThat(Buffer.isBuffer(bytes) && bytes.length >= 28 && bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, 'Invalid public metadata GLB header')
  const length = bytes.readUInt32LE(12)
  requireThat(length % 4 === 0 && bytes.readUInt32LE(16) === 0x4e4f534a && 28 + length <= bytes.length, 'Invalid public metadata JSON chunk')
  const binHeader = 20 + length
  requireThat(bytes.readUInt32LE(binHeader + 4) === 0x004e4942 && bytes.readUInt32LE(binHeader) % 4 === 0 && binHeader + 8 + bytes.readUInt32LE(binHeader) === bytes.length, 'Expected one complete BIN chunk')
  return { json: JSON.parse(bytes.subarray(20, binHeader).toString('utf8')), tail: bytes.subarray(binHeader), bin: bytes.subarray(binHeader + 8) }
}

function assertPublicJson(json) {
  for (const scene of json.scenes ?? []) {
    requireThat(AUTHORING_SCENE_EXTRAS.every(key => !Object.hasOwn(scene.extras ?? {}, key)), 'Public GLB contains authoring extras')
  }
  // Match keys as well as values, including JSON serialized inside strings.
  requireThat(!/(?:\/(?:Users|home|private|Volumes)\/|[A-Za-z]:\\|file:\/\/)/i.test(JSON.stringify(json)), 'Public GLB contains private absolute paths')
}

/** The sole v1 derivation: delete existing allowlisted scene extras, nothing else.
 * JSON is serialized with JSON.stringify and space padded to four bytes; the
 * entire original BIN chunk (including its header and padding) is copied. */
export function derivePublicSculptedModel(sourceBytes, sourceSha256) {
  requireThat(sha256(sourceBytes) === sourceSha256, 'Public derivation source hash mismatch')
  const { json, tail } = splitGlb(sourceBytes)
  const removedPointers = []
  for (const [index, scene] of (json.scenes ?? []).entries()) {
    for (const key of AUTHORING_SCENE_EXTRAS) {
      if (Object.hasOwn(scene.extras ?? {}, key)) {
        delete scene.extras[key]
        removedPointers.push(`/scenes/${index}/extras/${key}`)
      }
    }
  }
  assertPublicJson(json)
  const text = Buffer.from(JSON.stringify(json))
  const padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)])
  const header = Buffer.from(sourceBytes.subarray(0, 20))
  header.writeUInt32LE(20 + padded.length + tail.length, 8)
  header.writeUInt32LE(padded.length, 12)
  return { bytes: Buffer.concat([header, padded, tail]), removedPointers }
}

// Exact successor receipt. The original frozen source record is not rewritten.
// Graph digests bind all JSON semantics after ONLY the allowlisted deletion;
// BIN digests include all binary payload/padding. Reproduction verifies the
// derivation against the checked original; routine public validation needs no
// private authoring packet.
const woodlandCustody = {
  "d4": {
    "sourceSha256": "3e7f61f34eafc8f803682a9a16e8c485c91823209db81e1ff77d1348c4bad96a",
    "publicSha256": "b1bbfce78fed5f431b8be03bd906533c3e708278faabe191e28d4186048b25a2",
    "publicGraphSha256": "82717a0281aa365a6e4f149de7b0c00b2200af578fd8fd4103b75099f4ca3e73",
    "binSha256": "f880b48616bfb13695f950a4f985c1e04e43a1814717d92008499e21768d448b",
    "removedPointers": [
      "/scenes/0/extras/type_source_scene",
      "/scenes/0/extras/selected_source_scene",
      "/scenes/0/extras/inset_base_scene",
      "/scenes/0/extras/inset_recovered_source",
      "/scenes/0/extras/canonical_export_metadata"
    ]
  },
  "d6": {
    "sourceSha256": "80f3cd24d3910f6924e4054b38dc00f07ed4e56b97339789f27e95158f7cc601",
    "publicSha256": "7e2e629e71cce4ebc16c8b49d1377aa67d634e5a6faf07f20005111a46d78628",
    "publicGraphSha256": "bc8692374faf459038ec961549284f0c46bd9b4277b9ff3c28618cdfa15b12dd",
    "binSha256": "c0980300111c4e30893bc21fb7768bda077bef53f9fcc65d54a5b3bad1f2c17d",
    "removedPointers": [
      "/scenes/0/extras/source_hashes"
    ]
  },
  "d8": {
    "sourceSha256": "09adbc367da2c91347bd2b3a75709169df90ab48aaabd2259a1b394f51b48341",
    "publicSha256": "5c0d763f73d08e3bdbe66f19ae7bb1614112d3c95ca6447dda5aac0f050baa5c",
    "publicGraphSha256": "3ec0dd4d65d18b18c9b14b21b8b983834c58cc5fff34e3f8247d1d3c3f776903",
    "binSha256": "420b1b205a74951048ff8d5a18a89ba94c41a1b894414801ce0d00426b087720",
    "removedPointers": [
      "/scenes/0/extras/type_source_scene",
      "/scenes/0/extras/selected_source_scene",
      "/scenes/0/extras/canonical_export_metadata"
    ]
  },
  "d10": {
    "sourceSha256": "a14364ec32e67398102c3fe627097128390fc6e6e9c281b645290e2560d93ecb",
    "publicSha256": "f42f6d0ec2968a5d90f3e168fd44c37e92ddb3bbfcf09e1e68fd9c50c4aa5f4e",
    "publicGraphSha256": "c07adadb39af2808325eb6f7a00141a282ea6bf6e92591d1e26759c94af03bfc",
    "binSha256": "828aacceed4dcd35c00d498d91ee247c7c2e4ce6679018e3065b5e3cdf8a01b4",
    "removedPointers": [
      "/scenes/0/extras/type_source_scene",
      "/scenes/0/extras/selected_source_scene",
      "/scenes/0/extras/inset_base_scene",
      "/scenes/0/extras/inset_recovered_source",
      "/scenes/0/extras/canonical_export_metadata"
    ]
  },
  "d12": {
    "sourceSha256": "03a6c476ec0b258089de874513a58f5164fdb346f8675f9e2ec0204280594620",
    "publicSha256": "efefc7f950e8da99d371586bb07f9e4ee69e562c54fe44bb3b5ecc0f984d9a1b",
    "publicGraphSha256": "90deacb890f19e310a3910137ccc17dba448c82266803b3b7a04c32553202267",
    "binSha256": "4ba45e0fc69431028105347b2c95b71d5f159dc7fa4e85e2b54691d1560efd74",
    "removedPointers": [
      "/scenes/0/extras/type_source_scene",
      "/scenes/0/extras/selected_source_scene",
      "/scenes/0/extras/inset_base_scene",
      "/scenes/0/extras/inset_recovered_source",
      "/scenes/0/extras/canonical_export_metadata"
    ]
  },
  "d20": {
    "sourceSha256": "76de28b317d94d8e1c225842b8aeab35cf76144c5015e5615ba4fce88d391fd4",
    "publicSha256": "46a60c3bd7106d8c2bcde66ee7cf33b6361ae57729ef94665feef9b40e57ea93",
    "publicGraphSha256": "e0c5b6fb45058386c130901d4d71b8f35a138a126b98e548a80b5762efd1cd8e",
    "binSha256": "cee271d3560a1fe0d7eed0be9339a7ee12f4da74411f849ec22fff6ac2fc08b6",
    "removedPointers": [
      "/scenes/0/extras/source_hashes"
    ]
  }
}

export function publicSculptedModelDeclaration(shape) {
  const receipt = woodlandCustody[shape]
  requireThat(Object.hasOwn(woodlandCustody, shape), 'Unknown Woodland derivation shape')
  return { kind: PUBLIC_MODEL_TRANSFORM, sourceSha256: receipt.sourceSha256, publicSha256: receipt.publicSha256 }
}

export function validatePublicSculptedModel(bytes, setId, shape, sourceSha256, declaration) {
  if (setId !== 'woodland-sculpted-set') {
    requireThat(declaration === undefined && sha256(bytes) === sourceSha256, 'Unexpected transform or frozen source hash drift')
    return
  }
  const receipt = woodlandCustody[shape]
  requireThat(Object.hasOwn(woodlandCustody, shape) && sourceSha256 === receipt.sourceSha256, 'Woodland original source hash drift')
  const expected = publicSculptedModelDeclaration(shape)
  requireThat(declaration && Object.keys(declaration).length === 3 && Object.keys(expected).every(key => declaration[key] === expected[key]), 'Invalid public derivation declaration')
  const { json, bin } = splitGlb(bytes)
  assertPublicJson(json)
  requireThat(sha256(bytes) === receipt.publicSha256 && sha256(Buffer.from(JSON.stringify(json))) === receipt.publicGraphSha256 && sha256(bin) === receipt.binSha256, 'Public derivation payload differs from frozen successor')
}
