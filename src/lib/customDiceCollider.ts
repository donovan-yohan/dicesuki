import * as THREE from 'three'

/** Collects transformed model vertices for an explicit Rapier convex hull. */
export function collectConvexHullVertices(scene: THREE.Object3D, scale = 1): Float32Array {
  scene.updateMatrixWorld(true)
  const vertices: number[] = []
  const vertex = new THREE.Vector3()

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const position = object.geometry?.getAttribute('position')
    if (!position) return

    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index)
      vertex.applyMatrix4(object.matrixWorld).multiplyScalar(scale)
      vertices.push(vertex.x, vertex.y, vertex.z)
    }
  })

  return new Float32Array(vertices)
}
