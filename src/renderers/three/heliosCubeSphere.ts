import * as THREE from 'three'

// Source-faithful port of Helios Ray's
// frontend/src/app/modules/3d/utils/cube-sphere-geometry.ts.
// A cube-sphere avoids the pole pinch and meridian seam of SphereGeometry.
const geometryCache = new Map<string, THREE.BufferGeometry>()

export function createHeliosCubeSphereGeometry(radius: number, resolution: number): THREE.BufferGeometry {
  const cacheKey = `${radius}_${resolution}`
  const cached = geometryCache.get(cacheKey)
  if (cached) return cached

  const geometry = new THREE.BufferGeometry()
  const vertsPerFace = resolution * resolution
  const totalVerts = vertsPerFace * 6
  const indicesPerFace = (resolution - 1) * (resolution - 1) * 6
  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const tangents = new Float32Array(totalVerts * 3)
  const indices = new Uint32Array(indicesPerFace * 6)
  const faces = [
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ]
  const direction = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const right = new THREE.Vector3(1, 0, 0)
  const up = new THREE.Vector3(0, 1, 0)
  let vertexIndex = 0
  let indexIndex = 0

  for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
    const localUp = faces[faceIndex]!
    const axisA = new THREE.Vector3(localUp.y, localUp.z, localUp.x)
    const axisB = new THREE.Vector3().crossVectors(localUp, axisA)
    const startIndex = faceIndex * vertsPerFace

    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const px = (x / (resolution - 1) - 0.5) * 2
        const py = (y / (resolution - 1) - 0.5) * 2
        direction.copy(localUp).addScaledVector(axisA, px).addScaledVector(axisB, py).normalize()

        const offset = vertexIndex * 3
        positions[offset] = direction.x * radius
        positions[offset + 1] = direction.y * radius
        positions[offset + 2] = direction.z * radius
        normals[offset] = direction.x
        normals[offset + 1] = direction.y
        normals[offset + 2] = direction.z

        tangent.crossVectors(direction, up).normalize()
        if (tangent.lengthSq() < 0.1) tangent.crossVectors(direction, right).normalize()
        tangents[offset] = tangent.x
        tangents[offset + 1] = tangent.y
        tangents[offset + 2] = tangent.z

        if (x !== resolution - 1 && y !== resolution - 1) {
          const index = startIndex + x + y * resolution
          indices[indexIndex++] = index
          indices[indexIndex++] = index + resolution + 1
          indices[indexIndex++] = index + resolution
          indices[indexIndex++] = index
          indices[indexIndex++] = index + 1
          indices[indexIndex++] = index + resolution + 1
        }
        vertexIndex += 1
      }
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('tangent', new THREE.BufferAttribute(tangents, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  geometryCache.set(cacheKey, geometry)
  return geometry
}
