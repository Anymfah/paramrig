import { add, length, normalize, scale as scaled } from '@/scene/mesh/normals'
import { applyMatrix, invert } from '@/scene/modifiers/matrix'
import { chosenOf, numberOf, defineModifier, vectorOf, wholeOf, type ModifierInput } from '@/scene/modifiers/types'
import { numberParam, selectParam, vectorParam } from '@/scene/operators/types'
import { sample } from '@/scene/textures/procedural'
import type { Vec3 } from '@/scene/types'

/**
 * Displace: every vertex moved along a direction by what a texture says where it stands.
 *
 * The whole modifier is one line of arithmetic — the offset is `(sample − midlevel) × strength` —
 * and everything else here is about which number goes into it and which way the vertex then goes.
 * Two decisions are worth stating.
 *
 * The midlevel is the value that means *do not move*, which is why the offset is measured from it
 * rather than from zero: a noise field sits around a half, so a midlevel of a half leaves the
 * surface where it was and pushes half of it out and half of it in. With no texture at all the
 * sample is one, so every vertex moves by `(1 − midlevel) × strength` — Blender does the same, and
 * it is the one case a test can assert to the millimetre.
 *
 * Every normal is read before any vertex is moved. Reading them as the loop went would have each
 * vertex leaning on neighbours some of which had already moved, so the same modifier would give a
 * different mesh depending on which slot happened to come first.
 */

type DisplaceParams = {
  direction: string
  customDirection: Vec3
  strength: number
  midlevel: number
  texture: string
  scale: number
  detail: number
  roughness: number
  distortion: number
  seed: number
  space: string
  textureObject: string
}

const DIRECTIONS = ['x', 'y', 'z', 'normal', 'custom'] as const
const TEXTURES = ['none', 'noise', 'clouds', 'voronoi', 'wood'] as const
const SPACES = ['local', 'global'] as const

/**
 * The stack hands a modifier the mesh in its own frame and the objects it reads placed in that
 * frame; it does not hand it the object's own place in the world, so there is no world to sample a
 * texture in. Saying so is better than sampling in local space and calling it global — that would
 * be right for an object at the origin and quietly wrong for every other one.
 */
const NO_GLOBAL_SPACE = 'Displace cannot sample in global space: the stack does not give a modifier the object’s place in the world. Use local coordinates, or a texture object.'
const NO_TEXTURE_OBJECT = 'Displace cannot find the object it takes its texture frame from. Choose another, or clear the field.'
const NO_CUSTOM_DIRECTION = 'Displace has no way to go: the custom direction is zero. Give it a direction, or choose one of the axes.'

/** Under this a direction has no length left to normalise and the vector is a point, not a way. */
const TINY = 1e-9

const AXES: Record<string, Vec3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
}

/**
 * Where the texture is read for a vertex.
 *
 * With no texture object that is the vertex's own position, so the pattern is stuck to the mesh and
 * moves with it. With one, the point is taken back into that object's frame first — which is what
 * makes moving the object slide the pattern across the surface, and is Blender's object texture
 * coordinates.
 */
function frameOf(input: ModifierInput | null): number[] | null {
  return input ? invert(input.matrix) : null
}

export const displaceModifier = defineModifier<DisplaceParams>({
  kind: 'displace',
  label: 'Displace',
  category: 'deform',
  description: 'Move every vertex along a direction by what a procedural texture says where it stands.',
  icon: 'modifier-displace',
  defaults: {
    direction: 'normal',
    customDirection: [1, 0, 0],
    strength: 1,
    midlevel: 0.5,
    texture: 'none',
    scale: 5,
    detail: 2,
    roughness: 0.5,
    distortion: 0,
    seed: 0,
    space: 'local',
    textureObject: '',
  },
  schema: [
    selectParam('texture', 'Texture', [
      { value: 'none', label: 'None' },
      { value: 'noise', label: 'Noise' },
      { value: 'clouds', label: 'Clouds' },
      { value: 'voronoi', label: 'Voronoi' },
      { value: 'wood', label: 'Wood' },
    ], 'none'),
    numberParam('scale', 'Scale', { min: 0, max: 100, step: 0.1, defaultValue: 5 }),
    numberParam('detail', 'Detail', { min: 1, max: 8, step: 0.1, defaultValue: 2, view: 'bar' }),
    numberParam('roughness', 'Roughness', { min: 0, max: 1, step: 0.01, defaultValue: 0.5, view: 'bar' }),
    numberParam('distortion', 'Distortion', { min: 0, max: 10, step: 0.01, defaultValue: 0 }),
    numberParam('seed', 'Seed', { min: 0, max: 100000, step: 1, defaultValue: 0, view: 'seed' }),
    selectParam('direction', 'Direction', [
      { value: 'x', label: 'X' },
      { value: 'y', label: 'Y' },
      { value: 'z', label: 'Z' },
      { value: 'normal', label: 'Normal' },
      { value: 'custom', label: 'Custom' },
    ], 'normal'),
    vectorParam('customDirection', 'Custom direction', { defaultValue: [1, 0, 0], min: -1, max: 1, step: 0.01, view: 'direction' }),
    selectParam('space', 'Coordinates', [
      { value: 'local', label: 'Local' },
      { value: 'global', label: 'Global' },
    ], 'local'),
    // The options are filled in by the panel from the objects of the document; an empty value is
    // no object, which is the same thing the stack reads it as.
    selectParam('textureObject', 'Texture object', [{ value: '', label: 'None' }], ''),
    numberParam('midlevel', 'Midlevel', { min: 0, max: 1, step: 0.01, defaultValue: 0.5, view: 'bar' }),
    numberParam('strength', 'Strength', { min: -100, max: 100, step: 0.01, defaultValue: 1, unit: 'm' }),
  ],
  objectInputs: ['textureObject'],
  apply: (mesh, params, context) => {
    const space = chosenOf(params.space, SPACES, 'local')
    if (space === 'global') return NO_GLOBAL_SPACE

    const named = typeof params.textureObject === 'string' ? params.textureObject : ''
    const input = context.inputs.textureObject ?? null
    if (named !== '' && !input) return NO_TEXTURE_OBJECT

    const direction = chosenOf(params.direction, DIRECTIONS, 'normal')
    let axis = AXES[direction] ?? null
    if (direction === 'custom') {
      const wanted = vectorOf(params.customDirection, [1, 0, 0])
      if (length(wanted) < TINY) return NO_CUSTOM_DIRECTION
      axis = normalize(wanted)
    }

    const texture = chosenOf(params.texture, TEXTURES, 'none')
    const strength = numberOf(params.strength, 1, -1e4, 1e4)
    const midlevel = numberOf(params.midlevel, 0.5, -1e4, 1e4)
    const options = {
      scale: numberOf(params.scale, 5, 0, 1e4),
      detail: numberOf(params.detail, 2, 1, 8),
      roughness: numberOf(params.roughness, 0.5, 0, 1),
      distortion: numberOf(params.distortion, 0, 0, 100),
      seed: wholeOf(params.seed, 0, 0, 1e6),
    }
    const frame = frameOf(input)

    const offsets: Vec3[] = []
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
      const here = mesh.position(slot)
      // No texture is a sample of one everywhere, so the whole surface moves by the same amount.
      const value = texture === 'none' ? 1 : sample(texture, frame ? applyMatrix(frame, here) : here, options)
      offsets.push(scaled(axis ?? mesh.vertexNormal(slot), (value - midlevel) * strength))
    }
    for (let slot = 0; slot < mesh.vertexCount; slot += 1) {
      mesh.setPosition(slot, add(mesh.position(slot), offsets[slot]!))
    }
    return undefined
  },
})
