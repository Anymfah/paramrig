import type { Vec3 } from '@/scene/types'

/**
 * The procedural textures: four fields defined everywhere in space, each answering one number
 * between zero and one for any point it is asked about.
 *
 * Three decisions run through the whole module.
 *
 * — **Nothing here calls `Math.random`.** Every value comes from a hash of the lattice coordinates
 *   and the seed, so the same point with the same seed gives the same number for ever. A texture
 *   that rolled a die would move a displaced mesh every time the stack ran: undo would not give
 *   back what was there, a saved file would not reopen as it was saved, and no test could assert
 *   anything about a vertex at all.
 * — **Value noise rather than gradient noise.** Interpolating eight corner values that are already
 *   in 0..1 lands in 0..1, so the promised range is closed by the arithmetic rather than by a clamp
 *   that would flatten the field wherever it fired. Perlin's quintic fade is used for the
 *   interpolation, so the field is smooth to the second derivative and a displaced surface has no
 *   creases along the lattice.
 * — **Nothing returns NaN.** A point with an infinity in it, or a seed that arrived as a string,
 *   answers the midlevel rather than a NaN: in a mesh a NaN is not an error, it is a hole, and one
 *   that only shows up three operations later.
 *
 * All four fields share one fractal loop over octaves; what differs is the function summed. Noise
 * sums the value field, clouds sums it folded about its midline, voronoi sums the distance to the
 * nearest scattered point, and wood is a ring function whose radius the noise field wanders.
 */

export type TextureKind = 'noise' | 'clouds' | 'voronoi' | 'wood'

export type TextureOptions = {
  /** How many times the pattern repeats over a metre of space. */
  scale?: number
  /** How many octaves are summed: one is the bare field, eight is as fine as a mesh can carry. */
  detail?: number
  /** How much of its amplitude each octave keeps from the one before it. */
  roughness?: number
  /** How far the point is dragged by a second noise field before it is read. */
  distortion?: number
  seed?: number
}

export const TEXTURE_DEFAULTS: Required<TextureOptions> = {
  scale: 5,
  detail: 2,
  roughness: 0.5,
  distortion: 0,
  seed: 0,
}

/** The value a field answers where it has nothing to say: the midlevel, which displaces nothing. */
const MIDLEVEL = 0.5

/** Past this an octave is finer than the lattice of any mesh that could show it. */
const MAX_OCTAVES = 8

/* ------------------------------------------------------------------ the hash */

/**
 * Three lattice coordinates and a seed in, one number in 0..1 out, the same one for ever.
 *
 * The multipliers are the odd thirty-two-bit constants of the xxHash and MurmurHash mixers. What
 * matters about them is only that they are odd — an odd multiply on thirty-two bits is invertible,
 * so no information is thrown away — and that their bits are irregular enough that a change in the
 * lowest bit of a coordinate reaches the highest bit of the result. The shifts fold the high bits
 * back down, which is what stops neighbouring lattice cells from answering neighbouring numbers.
 */
const PRIME_SEED = 0x85ebca6b
const PRIME_X = 0x27d4eb2d
const PRIME_Y = 0x165667b1
const PRIME_Z = 0x9e3779b1

/** Two to the thirty-two: what an unsigned thirty-two-bit hash is divided by to land in 0..1. */
const HASH_RANGE = 4294967296

function hash(x: number, y: number, z: number, seed: number): number {
  let value = Math.imul(seed | 0, PRIME_SEED)
  value = Math.imul(value ^ (x | 0), PRIME_X)
  value ^= value >>> 15
  value = Math.imul(value ^ (y | 0), PRIME_Y)
  value ^= value >>> 13
  value = Math.imul(value ^ (z | 0), PRIME_Z)
  value ^= value >>> 16
  return (value >>> 0) / HASH_RANGE
}

/* ----------------------------------------------------------------- the fields */

/** Perlin's fade: zero slope and zero curvature at both ends, so octaves meet without a crease. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Value noise: the eight corners of the lattice cell the point falls in, faded together. Because
 * every corner is a hash in 0..1 and every weight is in 0..1, so is the answer.
 */
function valueNoise(point: Vec3, seed: number): number {
  const x = Math.floor(point[0])
  const y = Math.floor(point[1])
  const z = Math.floor(point[2])
  const fx = fade(point[0] - x)
  const fy = fade(point[1] - y)
  const fz = fade(point[2] - z)
  const near = mix(
    mix(hash(x, y, z, seed), hash(x + 1, y, z, seed), fx),
    mix(hash(x, y + 1, z, seed), hash(x + 1, y + 1, z, seed), fx),
    fy,
  )
  const far = mix(
    mix(hash(x, y, z + 1, seed), hash(x + 1, y, z + 1, seed), fx),
    mix(hash(x, y + 1, z + 1, seed), hash(x + 1, y + 1, z + 1, seed), fx),
    fy,
  )
  return mix(near, far, fz)
}

/**
 * The same field folded about its midline. A fold turns every crossing of the midline into a
 * crease, and it is those creases stacked across the octaves that read as the edge of a cloud
 * rather than as a hillside — Blender calls the same thing hard noise.
 */
function foldedNoise(point: Vec3, seed: number): number {
  return Math.abs(valueNoise(point, seed) * 2 - 1)
}

/**
 * The three seed offsets that separate the feature point's coordinates from each other. Any three
 * distinct numbers do; these are far enough apart that no seed a person types can make two of them
 * collide with a third seed's.
 */
const FEATURE_X = 0x1f3a5b
const FEATURE_Y = 0x2c8d41
const FEATURE_Z = 0x3b91e7

/**
 * The distance from the point to the nearest of a set of scattered points — one to a lattice cell,
 * anywhere inside it — searched over the twenty-seven cells that could hold the nearest one.
 *
 * Twenty-seven is enough: a point in the middle cell cannot be closer to anything outside that
 * block than to something inside it, because every cell of the block already contains a point and
 * no cell is more than one cell away.
 */
function nearestFeature(point: Vec3, seed: number): { distance: number; cell: [number, number, number] } {
  const baseX = Math.floor(point[0])
  const baseY = Math.floor(point[1])
  const baseZ = Math.floor(point[2])
  let nearest = Infinity
  let cell: [number, number, number] = [baseX, baseY, baseZ]
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const cx = baseX + dx
        const cy = baseY + dy
        const cz = baseZ + dz
        const featureX = cx + hash(cx, cy, cz, seed + FEATURE_X)
        const featureY = cy + hash(cx, cy, cz, seed + FEATURE_Y)
        const featureZ = cz + hash(cx, cy, cz, seed + FEATURE_Z)
        const distance = Math.hypot(featureX - point[0], featureY - point[1], featureZ - point[2])
        if (distance < nearest) {
          nearest = distance
          cell = [cx, cy, cz]
        }
      }
    }
  }
  return { distance: nearest, cell }
}

/**
 * What the nearest distance is divided by to land in 0..1.
 *
 * With one point to a cell the nearest one is a little over half a cell away on average, and past
 * one whole cell only when all twenty-seven of them have pushed their point to the far side — which
 * a sweep of a hundred thousand points never once produced. One cell is therefore the divisor that
 * uses the whole range without the clamp below ever having anything to do.
 */
const VORONOI_REACH = 8

function voronoiField(point: Vec3, seed: number): number {
  return Math.min(1, nearestFeature(point, seed).distance / VORONOI_REACH)
}

/* ---------------------------------------------------------------- the fractal */

/**
 * The step between one octave's seed and the next.
 *
 * Octaves are usually the same field read at twice the frequency. Here each one is read from a
 * different seed as well, because a lattice field read at exactly double the frequency lines its
 * cell corners up with the octave below it, and the sum shows that grid.
 */
const OCTAVE_SEED_STEP = 0x51ed27

type Settled = Required<TextureOptions>

/**
 * A field summed over octaves: each one twice as fine as the last and worth `roughness` of it,
 * divided by the total weight so the sum stays inside the range each octave was already in.
 *
 * A fractional `detail` fades the last octave in by its fraction rather than switching it on whole,
 * so dragging the field does not make the surface jump.
 */
function fractal(field: (point: Vec3, seed: number) => number, point: Vec3, settings: Settled): number {
  const octaves = Math.min(MAX_OCTAVES, Math.max(1, settings.detail))
  const whole = Math.floor(octaves)
  const fraction = octaves - whole
  let total = 0
  let weight = 0
  let amplitude = 1
  let frequency = 1
  for (let octave = 0; octave < whole; octave += 1) {
    const seed = settings.seed + octave * OCTAVE_SEED_STEP
    total += amplitude * field([point[0] * frequency, point[1] * frequency, point[2] * frequency], seed)
    weight += amplitude
    amplitude *= settings.roughness
    frequency *= 2
  }
  if (fraction > 0) {
    const seed = settings.seed + whole * OCTAVE_SEED_STEP
    const part = amplitude * fraction
    total += part * field([point[0] * frequency, point[1] * frequency, point[2] * frequency], seed)
    weight += part
  }
  return weight > 0 ? total / weight : MIDLEVEL
}

/**
 * The three offsets that decorrelate the warp's own three components. They are irrational-looking
 * on purpose: whole numbers would put all three reads on the same lattice corners.
 */
const WARP_X: Vec3 = [12.31, 7.17, 4.93]
const WARP_Y: Vec3 = [-5.71, 19.43, 8.29]
const WARP_Z: Vec3 = [3.37, -11.09, 15.61]

/** Dragging the point through a second noise field, which is what bends a pattern out of its grid. */
function distort(point: Vec3, settings: Settled): Vec3 {
  if (settings.distortion === 0) return point
  const pull = (offset: Vec3): number => (
    (valueNoise([point[0] + offset[0], point[1] + offset[1], point[2] + offset[2]], settings.seed) - MIDLEVEL)
    * 2 * settings.distortion
  )
  return [point[0] + pull(WARP_X), point[1] + pull(WARP_Y), point[2] + pull(WARP_Z)]
}

/* ------------------------------------------------------------------- the wood */

/**
 * How far the grain wanders, as a fraction of the distance between two rings.
 *
 * Rings straight off a sine are a target rather than a plank, so the radius always carries some
 * noise whatever the distortion is set to. Half a ring is the most it can wander and still read as
 * a ring; `distortion` adds to it from there.
 */
const WOOD_WOBBLE = 0.5

/**
 * Rings around the vertical axis, their radius wandered by the noise field.
 *
 * The axis is Z because that is which way up the scene stands, so a trunk grows along it. The
 * radius is measured in the scaled space, so `scale` is how many rings there are to the metre, and
 * the sine is mapped into 0..1 rather than clamped: the extremes are the rings themselves.
 */
function woodField(point: Vec3, settings: Settled): number {
  const radius = Math.hypot(point[0], point[1])
  const wander = (fractal(valueNoise, point, settings) - MIDLEVEL) * 2 * (WOOD_WOBBLE + settings.distortion)
  return MIDLEVEL + MIDLEVEL * Math.sin((radius + wander) * 2 * Math.PI)
}

/* -------------------------------------------------------------------- reading */

function finite(value: unknown, fallback: number, low: number, high: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(high, Math.max(low, number))
}

function settle(options: TextureOptions): Settled {
  return {
    scale: finite(options.scale, TEXTURE_DEFAULTS.scale, -1e6, 1e6),
    detail: finite(options.detail, TEXTURE_DEFAULTS.detail, 1, MAX_OCTAVES),
    roughness: finite(options.roughness, TEXTURE_DEFAULTS.roughness, 0, 1),
    distortion: finite(options.distortion, TEXTURE_DEFAULTS.distortion, 0, 100),
    // Rounded because a seed is a name for a field, not a measurement, and 3.5 must not be a field
    // of its own sitting between 3 and 4.
    seed: Math.round(finite(options.seed, TEXTURE_DEFAULTS.seed, -1e9, 1e9)),
  }
}

/** The point in the texture's own space: scaled, then dragged by the distortion. */
function placed(point: Vec3, settings: Settled): Vec3 | null {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || !Number.isFinite(point[2])) return null
  return distort([point[0] * settings.scale, point[1] * settings.scale, point[2] * settings.scale], settings)
}

/** The last gate before a number reaches a vertex: in range, and a number at all. */
function safe(value: number): number {
  if (!Number.isFinite(value)) return MIDLEVEL
  return Math.min(1, Math.max(0, value))
}

/**
 * One number in 0..1 for a point, whatever the texture. The same point and the same options always
 * give the same number, which is the whole promise of the module.
 */
export function sample(kind: TextureKind, point: Vec3, options: TextureOptions = {}): number {
  const settings = settle(options)
  const here = placed(point, settings)
  if (!here) return MIDLEVEL
  switch (kind) {
    case 'noise':
      return safe(fractal(valueNoise, here, settings))
    case 'clouds':
      return safe(fractal(foldedNoise, here, settings))
    case 'voronoi':
      return safe(fractal(voronoiField, here, settings))
    case 'wood':
      return safe(woodField(here, settings))
  }
}

/**
 * The three offsets that make a colour out of a field: the same texture read from three seeds far
 * enough apart to be three unrelated fields.
 */
const COLOUR_RED = 0x0
const COLOUR_GREEN = 0x6d2b79
const COLOUR_BLUE = 0xc4f1a3

/**
 * A colour in 0..1 per channel.
 *
 * Noise and clouds have a colour the way Blender's texture nodes do: the same field read from three
 * seeds. Voronoi's is the colour of the cell the point belongs to, which is what makes its cells
 * read as separate things rather than as a gradient. Wood has no colour of its own — a ring pattern
 * is one number — so it answers its own value as a grey rather than inventing two more channels.
 */
export function sampleColour(kind: TextureKind, point: Vec3, options: TextureOptions = {}): Vec3 {
  const settings = settle(options)
  const here = placed(point, settings)
  if (!here) return [MIDLEVEL, MIDLEVEL, MIDLEVEL]
  if (kind === 'voronoi') {
    const [cx, cy, cz] = nearestFeature(here, settings.seed).cell
    return [
      safe(hash(cx, cy, cz, settings.seed + COLOUR_RED)),
      safe(hash(cx, cy, cz, settings.seed + COLOUR_GREEN)),
      safe(hash(cx, cy, cz, settings.seed + COLOUR_BLUE)),
    ]
  }
  if (kind === 'wood') {
    const grey = safe(woodField(here, settings))
    return [grey, grey, grey]
  }
  const field = kind === 'clouds' ? foldedNoise : valueNoise
  return [
    safe(fractal(field, here, { ...settings, seed: settings.seed + COLOUR_RED })),
    safe(fractal(field, here, { ...settings, seed: settings.seed + COLOUR_GREEN })),
    safe(fractal(field, here, { ...settings, seed: settings.seed + COLOUR_BLUE })),
  ]
}
