import { registerModifier, numberOf, switchOf, wholeOf } from '@/scene/modifiers/types'
import { solidifyFaces } from '@/scene/operators/shell'
import { numberParam, switchParam } from '@/scene/operators/types'

/**
 * Solidify: the surface as an object with two sides.
 *
 * The geometry is the operator's, `solidifyFaces` in `operators/shell.ts`, run over every face of
 * the mesh instead of over a selection — one shell in the codebase rather than a modifier's and an
 * operator's slowly disagreeing about what a fold does. Everything this adds on top of the operator
 * is bookkeeping the modifier panel exposes and edit mode does not: which skin gets which material,
 * whether the border is filled, whether it is all that is kept, and how creased its edges are.
 *
 * Two departures from Blender are deliberate and are in the report. Only rim drops both skins and
 * keeps the band, which is what Blender's `do_shell` does and not what its manual's wording
 * suggests; and one crease covers the whole rim, where Blender has three — inner, outer and rim.
 */

const NEEDS_FACES = 'Solidify needs faces; this mesh has none.'
const NEEDS_THICKNESS = 'Give Solidify a thickness; nought has nothing to build.'

registerModifier({
  kind: 'solidify',
  label: 'Solidify',
  category: 'generate',
  description: 'Give the mesh a thickness, with a second skin inside it and a rim around the border.',
  icon: 'modifier-solidify',
  defaults: {
    thickness: 0.1,
    offset: -1,
    even: true,
    rim: true,
    onlyRim: false,
    flipNormals: false,
    materialOffset: 0,
    crease: 0,
  },
  schema: [
    numberParam('thickness', 'Thickness', { min: -100, max: 100, step: 0.01, defaultValue: 0.1, unit: 'm' }),
    numberParam('offset', 'Offset', { min: -1, max: 1, step: 0.01, defaultValue: -1, view: 'bar' }),
    switchParam('even', 'Even thickness', true),
    switchParam('rim', 'Fill the rim', true),
    switchParam('onlyRim', 'Only the rim', false),
    switchParam('flipNormals', 'Flip normals', false),
    numberParam('materialOffset', 'Material offset', { min: 0, max: 32, step: 1, defaultValue: 0, view: 'stepper' }),
    numberParam('crease', 'Rim crease', { min: 0, max: 1, step: 0.01, defaultValue: 0, view: 'bar' }),
  ],
  apply: (mesh, params) => {
    if (mesh.faceCount === 0) return NEEDS_FACES
    const thickness = numberOf(params.thickness, 0.1, -100, 100)
    if (thickness === 0) return NEEDS_THICKNESS
    // Read before anything is minted: the skins and the rim are faces too, and a shell built over
    // the shell it has just built is a mesh nobody asked for.
    const faces: number[] = []
    for (let face = 0; face < mesh.faceCount; face += 1) faces.push(face)
    solidifyFaces(mesh, faces, {
      thickness,
      offset: numberOf(params.offset, -1, -1, 1),
      even: switchOf(params.even, true),
      rim: switchOf(params.rim, true),
      onlyRim: switchOf(params.onlyRim, false),
      flipNormals: switchOf(params.flipNormals, false),
      materialOffset: wholeOf(params.materialOffset, 0, 0, 32),
      crease: numberOf(params.crease, 0, 0, 1),
    })
  },
})
