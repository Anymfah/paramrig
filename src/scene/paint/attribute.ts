import { loopStarts } from '@/scene/mesh/uv'
import type { MeshData } from '@/scene/types'

/**
 * The colour a mesh carries, on one of two domains.
 *
 * Blender lets a colour attribute live on the vertices or on the corners, and the difference is the
 * one a UV seam makes: a colour on a vertex is the same colour whichever face you look at it from,
 * and a colour on a corner can be red on one face and blue on the next. Painting writes whichever
 * the mesh has; everything downstream — the viewport, the material, the exporter — reads through
 * `cornerColours`, which is the domain a GPU understands.
 *
 * Three floats a value. Alpha is deliberately absent: Blender's byte colour attribute carries one
 * and almost nothing reads it, and a channel nobody uses is a channel that goes wrong quietly.
 */

export type PaintDomain = 'vertex' | 'corner'

export const CHANNELS = 3

/** White, which is what an unpainted mesh is: a colour attribute multiplies the material's own. */
export const UNPAINTED: [number, number, number] = [1, 1, 1]

/** Which domain the mesh's colour is on, or nothing when it carries none. */
export function colourDomain(mesh: MeshData): PaintDomain | null {
  if (mesh.attributes.loop.color) return 'corner'
  if (mesh.attributes.vertex.color) return 'vertex'
  return null
}

/** How many values the domain holds: one a vertex, or one a corner. */
export function domainSize(mesh: MeshData, domain: PaintDomain): number {
  if (domain === 'vertex') return mesh.vertexIds.length
  return mesh.faces.reduce((total, face) => total + face.length, 0)
}

/**
 * The mesh's colour, read as one value per corner — which is what a `BufferAttribute` wants and
 * what a shader samples. A mesh with no colour attribute reads as white throughout.
 */
export function cornerColours(mesh: MeshData): Float32Array {
  const corners = domainSize(mesh, 'corner')
  const out = new Float32Array(corners * CHANNELS)
  out.fill(1)
  const loop = mesh.attributes.loop.color
  if (loop) {
    for (let index = 0; index < out.length && index < loop.length; index += 1) out[index] = loop[index] ?? 1
    return out
  }
  const vertex = mesh.attributes.vertex.color
  if (!vertex) return out
  const stride = strideOf(vertex.length, mesh.vertexIds.length)
  const starts = loopStarts(mesh)
  mesh.faces.forEach((face, faceSlot) => {
    const start = starts[faceSlot] ?? 0
    face.forEach((slot, corner) => {
      const at = (start + corner) * CHANNELS
      for (let channel = 0; channel < CHANNELS; channel += 1) {
        out[at + channel] = vertex[slot * stride + channel] ?? 1
      }
    })
  })
  return out
}

/** Whether a flat array holds three or four channels a value, from how long it is. */
export function strideOf(length: number, count: number): number {
  if (count <= 0) return CHANNELS
  return length >= count * 4 ? 4 : CHANNELS
}

/* ------------------------------------------------------------ colour space */

/**
 * The document holds what the colour picker said, which is sRGB; the GPU and glTF want linear.
 *
 * Blender stores its colour attributes the other way round — scene-linear, converted on the way
 * into the picker — and either is defensible. This way the number in the file is the number a
 * person chose, which is what makes a painted mesh readable in a diff and a hex code mean what it
 * says; the conversion happens once, where the values leave for a renderer.
 */
export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

export function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
}

/** A whole buffer of sRGB values as linear ones, for a shader or an exporter. */
export function linearColours(values: Float32Array): Float32Array {
  const out = new Float32Array(values.length)
  for (let index = 0; index < values.length; index += 1) out[index] = srgbToLinear(values[index] ?? 1)
  return out
}
