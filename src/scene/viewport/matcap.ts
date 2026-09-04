/**
 * The matcaps, made rather than shipped.
 *
 * A matcap is a photograph of a sphere: look up the pixel that the surface's normal points at in
 * view space, and the sphere's lighting comes with it. It is how a modeller reads a form when the
 * scene has no lighting worth looking through — Blender ships two dozen for exactly that.
 *
 * These are computed instead of bundled, which is worth the arithmetic three times over. There is
 * no image to download, no licence to attribute and no binary in the repository; each one is a
 * paragraph of shading maths that says plainly what it is — a clay, a metal, a wax — where a PNG
 * says only "some pixels"; and any size can be asked for. The cost is a few milliseconds, once.
 *
 * The pixels are computed without a canvas so that the whole thing is testable and can run
 * anywhere: a normal is recovered from each pixel of the disc, shaded by a handful of lights, and
 * written straight into an RGBA array the viewport hands to a `DataTexture`.
 */

export type MatcapName = 'basic' | 'clay' | 'metal' | 'plastic' | 'wax' | 'ceramic'

export const MATCAPS: readonly MatcapName[] = ['basic', 'clay', 'metal', 'plastic', 'wax', 'ceramic']

export const MATCAP_LABELS: Record<MatcapName, string> = {
  basic: 'Basic',
  clay: 'Clay',
  metal: 'Metal',
  plastic: 'Plastic',
  wax: 'Wax',
  ceramic: 'Ceramic',
}

type Light = {
  /** Where the light is, in the sphere's own view space; it is normalised on the way in. */
  direction: [number, number, number]
  colour: [number, number, number]
  strength: number
}

type Recipe = {
  base: [number, number, number]
  /** How much of the base survives where nothing lights it, which is what reads as material. */
  ambient: number
  lights: Light[]
  /** Specular strength and how tight it is; a high exponent is a small hard highlight. */
  specular: number
  shininess: number
  /** How much the edge of the sphere lights up, which is what makes a form's silhouette legible. */
  rim: number
  /** Metals tint their highlight with their own colour; dielectrics keep it white. */
  metallic: boolean
}

const RECIPES: Record<MatcapName, Recipe> = {
  basic: {
    base: [0.72, 0.72, 0.74],
    ambient: 0.26,
    lights: [
      { direction: [-0.4, 0.6, 0.8], colour: [1, 1, 1], strength: 0.85 },
      { direction: [0.7, -0.2, 0.5], colour: [0.85, 0.88, 1], strength: 0.3 },
    ],
    specular: 0.28,
    shininess: 26,
    rim: 0.18,
    metallic: false,
  },
  clay: {
    base: [0.78, 0.5, 0.4],
    ambient: 0.3,
    lights: [
      { direction: [-0.35, 0.7, 0.7], colour: [1, 0.96, 0.9], strength: 0.9 },
      { direction: [0.8, -0.35, 0.4], colour: [0.6, 0.5, 0.55], strength: 0.35 },
    ],
    specular: 0.05,
    shininess: 8,
    rim: 0.12,
    metallic: false,
  },
  metal: {
    base: [0.55, 0.57, 0.6],
    ambient: 0.12,
    lights: [
      { direction: [-0.5, 0.55, 0.7], colour: [1, 1, 1], strength: 0.7 },
      { direction: [0.6, 0.4, 0.6], colour: [0.8, 0.85, 1], strength: 0.55 },
      { direction: [0.1, -0.9, 0.4], colour: [0.5, 0.5, 0.55], strength: 0.5 },
    ],
    specular: 0.9,
    shininess: 90,
    rim: 0.3,
    metallic: true,
  },
  plastic: {
    base: [0.72, 0.73, 0.78],
    ambient: 0.3,
    lights: [
      { direction: [-0.4, 0.6, 0.75], colour: [1, 1, 1], strength: 0.62 },
      { direction: [0.5, -0.5, 0.6], colour: [0.9, 0.92, 1], strength: 0.22 },
    ],
    specular: 0.65,
    shininess: 160,
    rim: 0.1,
    metallic: false,
  },
  wax: {
    base: [0.76, 0.68, 0.58],
    ambient: 0.38,
    lights: [
      { direction: [-0.3, 0.55, 0.8], colour: [1, 0.97, 0.92], strength: 0.5 },
      { direction: [0.4, -0.6, 0.5], colour: [1, 0.85, 0.75], strength: 0.28 },
    ],
    specular: 0.12,
    shininess: 14,
    // Wax lets light through at the edge, which is the whole of why it looks like wax.
    rim: 0.42,
    metallic: false,
  },
  ceramic: {
    base: [0.8, 0.81, 0.83],
    ambient: 0.32,
    lights: [
      { direction: [-0.45, 0.65, 0.7], colour: [1, 1, 1], strength: 0.58 },
      { direction: [0.65, -0.15, 0.55], colour: [0.9, 0.93, 1], strength: 0.26 },
    ],
    specular: 0.8,
    shininess: 220,
    rim: 0.22,
    metallic: false,
  },
}

/**
 * One matcap as RGBA bytes, `size` square, row by row from the top.
 *
 * Outside the sphere the pixels are the background rather than transparent: a matcap is sampled
 * near its edge whenever a surface turns away from the camera, and a transparent border there shows
 * as a bright fringe around every silhouette.
 */
export function matcapPixels(name: MatcapName, size = 256): Uint8Array {
  const recipe = RECIPES[name] ?? RECIPES.basic
  const data = new Uint8Array(size * size * 4)
  const background = shade(recipe, [0, 0, 1], 1)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // The pixel's place on the sphere: −1 to 1 across, with +Y up, which is how a normal is read.
      const nx = ((x + 0.5) / size) * 2 - 1
      const ny = 1 - ((y + 0.5) / size) * 2
      const radius = Math.hypot(nx, ny)
      const at = (y * size + x) * 4
      if (radius > 1) {
        write(data, at, background)
        continue
      }
      const nz = Math.sqrt(Math.max(0, 1 - radius * radius))
      write(data, at, shade(recipe, [nx, ny, nz], radius))
    }
  }
  return data
}

/** What the sphere looks like where its normal points this way. */
function shade(recipe: Recipe, normal: [number, number, number], radius: number): [number, number, number] {
  const colour: [number, number, number] = [
    recipe.base[0] * recipe.ambient,
    recipe.base[1] * recipe.ambient,
    recipe.base[2] * recipe.ambient,
  ]
  for (const light of recipe.lights) {
    const direction = normalise(light.direction)
    const diffuse = Math.max(0, dot(normal, direction)) * light.strength
    for (let channel = 0; channel < 3; channel += 1) {
      colour[channel]! += recipe.base[channel]! * light.colour[channel]! * diffuse
    }
    // Blinn-Phong, with the eye straight down +Z because a matcap is always seen head on.
    const half = normalise([direction[0], direction[1], direction[2] + 1])
    const specular = Math.pow(Math.max(0, dot(normal, half)), recipe.shininess) * recipe.specular * light.strength
    for (let channel = 0; channel < 3; channel += 1) {
      const tint = recipe.metallic ? recipe.base[channel]! : 1
      colour[channel]! += specular * light.colour[channel]! * tint
    }
  }
  // The rim: strongest where the sphere turns away, which is the edge of the disc.
  const rim = Math.pow(radius, 3) * recipe.rim
  for (let channel = 0; channel < 3; channel += 1) colour[channel]! += rim * recipe.base[channel]!
  return colour
}

/** Linear light into the bytes a texture holds, which is sRGB. */
function write(data: Uint8Array, at: number, colour: [number, number, number]): void {
  for (let channel = 0; channel < 3; channel += 1) {
    const value = Math.min(1, Math.max(0, colour[channel]!))
    data[at + channel] = Math.round((value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055) * 255)
  }
  data[at + 3] = 255
}

function normalise(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  return length < 1e-9 ? [0, 0, 1] : [vector[0] / length, vector[1] / length, vector[2] / length]
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
