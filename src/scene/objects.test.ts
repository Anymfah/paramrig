import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createSceneDocument, ROOT_COLLECTION_ID } from '@/scene/document'
import { decomposeMatrix, localMatrix, worldMatrix } from '@/scene/objects'
import type { SceneObject, Transform, Vec3 } from '@/scene/types'

/**
 * Where an object is, and which way it faces.
 *
 * The Euler order is the whole of what is tested here, because it is the thing that was quietly
 * wrong: Blender names its rotations in the order they are applied to the *world's* axes, and
 * three.js names them in the order they are applied to the object — the same letters, backwards.
 * Handing one spelling to the other leaves every single-axis rotation right and every compound one
 * wrong, which is exactly the kind of error that survives a long time.
 */

function object(transform: Partial<Transform>): SceneObject {
  return {
    id: 'object-1',
    name: 'Object',
    kind: 'empty',
    collectionId: ROOT_COLLECTION_ID,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], ...transform },
    visible: true,
    selectable: true,
    renderable: true,
    data: { kind: 'empty', display: 'plain-axes', size: 1 },
    modifiers: [],
    materialSlots: [],
  }
}

/** Where a local direction points once the object's rotation is applied. */
function direction(transform: Partial<Transform>, local: Vec3): Vec3 {
  const matrix = localMatrix(object(transform))
  const vector = new Vector3(local[0], local[1], local[2]).transformDirection(matrix)
  return [vector.x, vector.y, vector.z]
}

describe('an object’s rotation', () => {
  it('turns about the world’s axes in the order it names, as Blender does', () => {
    /*
     * X by 90° takes +Y onto +Z. Z by 90° afterwards takes that nowhere — it is the axis. So the
     * pair applied in Blender's order leaves +Y on +Z; applied the other way round it would not.
     */
    const [x, y, z] = direction({ rotation: [90, 0, 90] }, [0, 1, 0])
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(1, 6)
  })

  it('turns +X into the plane the Z rotation puts it in', () => {
    // X by 90° leaves +X alone; Z by 90° then takes it to +Y.
    const [x, y, z] = direction({ rotation: [90, 0, 90] }, [1, 0, 0])
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(1, 6)
    expect(z).toBeCloseTo(0, 6)
  })

  it('reads a matrix back into the same numbers it was built from', () => {
    const transform = { rotation: [30, -20, 55] as Vec3, position: [1, 2, 3] as Vec3 }
    const read = decomposeMatrix(localMatrix(object(transform)), 'XYZ')
    expect(read.rotation[0]).toBeCloseTo(30, 6)
    expect(read.rotation[1]).toBeCloseTo(-20, 6)
    expect(read.rotation[2]).toBeCloseTo(55, 6)
    expect(read.position).toEqual([1, 2, 3])
  })

  it('honours an object’s own rotation order', () => {
    // The same numbers in the other order give a different orientation, or the order means nothing.
    const asXYZ = direction({ rotation: [90, 0, 90] }, [0, 1, 0])
    const asZYX = direction({ rotation: [90, 0, 90], rotationMode: 'ZYX' }, [0, 1, 0])
    expect(Math.abs(asXYZ[2] - asZYX[2])).toBeGreaterThan(0.5)
  })

  it('aims the startup camera at what the startup scene is built around', () => {
    /*
     * Blender's own numbers for its default camera. A camera looks down its local −Z, so this is
     * the check that the whole convention is right rather than merely self-consistent: the camera
     * has to point at the origin, where the cube is.
     */
    const document = createSceneDocument()
    const camera = document.objects.find((entry) => entry.data.kind === 'camera')!
    const matrix = worldMatrix(document, camera)
    const forward = new Vector3(0, 0, -1).transformDirection(matrix)
    const toOrigin = new Vector3(...camera.transform.position).negate().normalize()
    expect(forward.dot(toOrigin)).toBeGreaterThan(0.999)
  })
})
