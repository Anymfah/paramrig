import type { ParamValue } from '@/rigs/types'
import type { EditMesh } from '@/scene/mesh/editMesh'
import { add, cross, dot, length, normalize, scale, subtract } from '@/scene/mesh/normals'
import { requireEdit, runOnMeshes, selectedVertices, type EditOutcome, type EditTarget } from '@/scene/operators/edit'
import { registerOperator } from '@/scene/operators/registry'
import {
  numberParam,
  switchParam,
  vectorParam,
  type OperatorContext,
  type OperatorParams,
} from '@/scene/operators/types'
import type { Vec3 } from '@/scene/types'

/**
 * Sweeping a profile, and the three ways of nudging vertices about.
 *
 * Spin and screw are one algorithm: the selection is copied step by step around an axis, and the
 * ring left behind is bridged to the ring in front along the selection's boundary. Screw is the
 * same sweep with a rise added to each turn, so it is written as a spin with a rise rather than as
 * a second sweep, and the two operators cannot drift apart.
 *
 * Smooth, Laplacian smooth and Randomize share a shape too: each moves the selected vertices and
 * nothing else, leaving the topology exactly as it was, so that a person can press one of them
 * repeatedly and always be looking at the same mesh. Randomize draws its numbers from the vertex's
 * own id and the seed rather than from a generator with a position in a sequence — the same seed on
 * the same mesh gives the same mesh, whatever else has happened in between and in whatever order
 * the vertices are visited.
 */

const NOTHING_SELECTED = 'Nothing is selected.'
const NEEDS_AXIS = 'Give the spin an axis to turn about.'
const NEEDS_ANGLE = 'A spin of no angle has nothing to sweep.'
const NEEDS_STEPS = 'A spin needs at least one step.'

/* --------------------------------------------------------------- reading params */

function numberOf(value: ParamValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function switchOf(value: ParamValue | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function vectorOf(value: ParamValue | undefined): Vec3 | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const [x, y, z] = value
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null
  return [x, y, z]
}

/**
 * Blender fills the redo panel's Centre with the 3D cursor at the moment the operator is invoked,
 * so it cannot be a constant in `defaults` — a document whose cursor has moved would go on spinning
 * about the old place for the rest of the session. `add.ts` reads Location the same way, and for
 * the same reason. A caller that names a centre is taken at its word.
 */
function centreOf(context: OperatorContext, params: OperatorParams): Vec3 {
  return vectorOf(params.centre) ?? [...context.cursor.position]
}

/* ------------------------------------------------------------------- the sweep */

type Rail = { from: number; to: number; face: number | null }

/**
 * What a sweep turns. An `EditTarget` is one of these, and so is a whole mesh with all of its slots
 * in it: the Screw modifier hands over the second kind, which is why the sweep asks for no more of
 * a target than the four things it actually reads.
 */
export type SweepTarget = Pick<EditTarget, 'mesh' | 'vertices' | 'edges' | 'faces'>

export type SweepOptions = {
  steps: number
  /** The whole turn in radians, not one step's worth. */
  angle: number
  axis: Vec3
  centre: Vec3
  /** How far the sweep climbs along the axis over the whole turn; zero for a plain spin. */
  rise: number
  duplicates: boolean
  autoMerge: boolean
  /**
   * Whether a wire profile's edges are walked end to end before they are swept. Left off they are
   * taken in the order the mesh holds them, which is Blender's Calculate order switched off:
   * quicker on a big profile, and a wall here and there comes out inside out.
   */
  calcOrder?: boolean
}

/** Rodrigues' rotation about an axis through a point, with the screw's climb folded in. */
function turned(point: Vec3, centre: Vec3, axis: Vec3, angle: number, rise: number): Vec3 {
  const local = subtract(point, centre)
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const along = dot(axis, local)
  const rotated = add(
    add(scale(local, cosine), scale(cross(axis, local), sine)),
    scale(axis, along * (1 - cosine)),
  )
  return add(add(centre, rotated), scale(axis, rise))
}

/**
 * The edges the sweep bridges, wound so that every wall of the tube faces the same way.
 *
 * A face selection gives its rim, already wound like the faces it came from. An edge or vertex
 * selection gives a wire, and a wire's edges are stored low-slot-first rather than in the order a
 * person drew them — so the chain is walked and re-wound, or a ring of four edges would come back
 * with one of its four walls inside out.
 */
function railsOf(target: SweepTarget, seeds: Set<number>, calcOrder: boolean): Rail[] {
  const mesh = target.mesh
  if (target.faces.size > 0) {
    const rails: Rail[] = []
    for (const loop of mesh.boundaryLoops(target.faces)) {
      for (let corner = 0; corner < loop.length; corner += 1) {
        const from = loop[corner]!
        const to = loop[(corner + 1) % loop.length]!
        const edge = mesh.edgeSlot(from, to)
        const owner = edge < 0 ? null : (mesh.edgeFaces(edge).find((face) => target.faces.has(face)) ?? null)
        rails.push({ from, to, face: owner })
      }
    }
    return rails
  }
  const wanted: number[] = []
  if (target.edges.size > 0) {
    for (const edge of target.edges) wanted.push(edge)
  } else {
    for (let edge = 0; edge < mesh.edgeCount; edge += 1) {
      const [a, b] = mesh.edgeVertices(edge)
      if (seeds.has(a) && seeds.has(b)) wanted.push(edge)
    }
  }
  return calcOrder ? chained(target, wanted) : stored(target, wanted)
}

/** The edges exactly as the mesh holds them, low slot first, with no walk over them at all. */
function stored(target: SweepTarget, edges: number[]): Rail[] {
  return edges.map((edge) => {
    const [from, to] = target.mesh.edgeVertices(edge)
    return { from, to, face: null }
  })
}

/** A wire's edges walked end to end, so consecutive rails point the same way along it. */
function chained(target: SweepTarget, edges: number[]): Rail[] {
  const mesh = target.mesh
  const neighbours = new Map<number, number[]>()
  const pairs = edges.map((edge) => mesh.edgeVertices(edge))
  for (const [a, b] of pairs) {
    if (a < 0 || b < 0) continue
    neighbours.set(a, [...(neighbours.get(a) ?? []), b])
    neighbours.set(b, [...(neighbours.get(b) ?? []), a])
  }
  // A vertex where three edges meet has no single way round, so the whole selection is taken as it
  // is stored rather than half of it walked and half of it guessed.
  for (const list of neighbours.values()) {
    if (list.length > 2) return stored(target, edges)
  }
  const used = new Set<string>()
  const key = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const rails: Rail[] = []
  const ends = [...neighbours.keys()].filter((vertex) => (neighbours.get(vertex) ?? []).length === 1)
  for (const start of [...ends, ...neighbours.keys()]) {
    let here = start
    for (;;) {
      const onward = (neighbours.get(here) ?? []).find((candidate) => !used.has(key(here, candidate)))
      if (onward === undefined) break
      used.add(key(here, onward))
      rails.push({ from: here, to: onward, face: null })
      here = onward
    }
  }
  return rails
}

/** Every vertex a sweep turns: the corners of the edges and faces it was given, and its own. */
function sweptVertices(target: SweepTarget): Set<number> {
  const slots = new Set(target.vertices)
  for (const edge of target.edges) for (const end of target.mesh.edgeVertices(edge)) if (end >= 0) slots.add(end)
  for (const face of target.faces) for (const corner of target.mesh.faceVertices(face)) slots.add(corner)
  return slots
}

export function sweep(target: SweepTarget, options: SweepOptions): EditOutcome {
  const mesh = target.mesh
  const seeds = [...sweptVertices(target)].sort((first, second) => first - second)
  if (seeds.length === 0) return NOTHING_SELECTED
  const rails = railsOf(target, new Set(seeds), options.calcOrder !== false)
  const faces = [...target.faces].sort((first, second) => first - second)
  const at = new Map(seeds.map((slot, index) => [slot, index]))
  // A whole turn that climbs nowhere comes back to where it started, so the last ring is the first
  // one rather than a second set of vertices sitting on top of it.
  const closesUp = options.autoMerge
    && Math.abs(Math.abs(options.angle) - Math.PI * 2) < 1e-6
    && Math.abs(options.rise) < 1e-9
  const rings: number[][] = [seeds]
  for (let step = 1; step <= options.steps; step += 1) {
    if (closesUp && step === options.steps) {
      rings.push(seeds)
      break
    }
    const share = step / options.steps
    rings.push(seeds.map((slot) => mesh.addVertex(
      turned(mesh.position(slot), options.centre, options.axis, options.angle * share, options.rise * share),
    )))
  }
  if (options.duplicates) {
    const copies: number[] = []
    for (let step = 1; step < rings.length; step += 1) {
      const ring = rings[step]!
      // At a whole turn the last ring is the first one again, and a copy laid exactly on the
      // original is not a duplicate anybody asked for.
      if (ring === seeds) continue
      for (const face of faces) {
        const added = mesh.addFace(mesh.faceVertices(face).map((slot) => ring[at.get(slot)!]!))
        if (added >= 0) mesh.copyFaceAttributes(face, added)
      }
      for (const rail of rails) mesh.addEdge(ring[at.get(rail.from)!]!, ring[at.get(rail.to)!]!)
      copies.push(...ring)
    }
    return { select: { vertices: copies } }
  }
  for (let step = 1; step < rings.length; step += 1) {
    const behind = rings[step - 1]!
    const ahead = rings[step]!
    for (const rail of rails) {
      const from = at.get(rail.from)!
      const to = at.get(rail.to)!
      const added = mesh.addFace([behind[from]!, behind[to]!, ahead[to]!, ahead[from]!])
      if (added >= 0 && rail.face !== null) mesh.copyFaceAttributes(rail.face, added)
    }
    // A vertex on no rail still leaves a trail behind it, which is what spinning a lone vertex or a
    // stray corner is for.
    for (let index = 0; index < seeds.length; index += 1) mesh.addEdge(behind[index]!, ahead[index]!)
  }
  const last = rings[rings.length - 1]!
  for (const face of faces) {
    mesh.setFaceLoop(face, mesh.faceVertices(face).map((slot) => last[at.get(slot)!]!))
  }
  return { select: { vertices: last, faces } }
}

/** What every sweep checks before it starts, so the two operators refuse in the same words. */
function sweepOptions(
  context: OperatorContext,
  params: OperatorParams,
  options: { steps: number; angle: number; rise: number; duplicates: boolean; autoMerge: boolean },
): SweepOptions | string {
  if (!Number.isFinite(options.steps) || options.steps < 1) return NEEDS_STEPS
  const axis = vectorOf(params.axis) ?? [0, 0, 1]
  if (length(axis) < 1e-9) return NEEDS_AXIS
  if (Math.abs(options.angle) < 1e-9 && Math.abs(options.rise) < 1e-9) return NEEDS_ANGLE
  return {
    steps: Math.min(512, Math.round(options.steps)),
    angle: options.angle,
    axis: normalize(axis),
    centre: centreOf(context, params),
    rise: options.rise,
    duplicates: options.duplicates,
    autoMerge: options.autoMerge,
  }
}

const SPIN_PARAMS = [
  numberParam('steps', 'Steps', { min: 1, max: 512, step: 1, defaultValue: 12 }),
  numberParam('angle', 'Angle', { min: -3600, max: 3600, step: 1, defaultValue: 360, unit: '°', view: 'angle' }),
  vectorParam('axis', 'Axis', { defaultValue: [0, 0, 1], step: 0.1, view: 'direction' }),
  vectorParam('centre', 'Centre', { defaultValue: [0, 0, 0], step: 0.1, unit: 'm' }),
  switchParam('duplicates', 'Duplicates', false),
  switchParam('autoMerge', 'Merge at a whole turn', true),
]

registerOperator<OperatorParams>({
  id: 'mesh.spin',
  label: 'Spin',
  section: 'Mesh',
  icon: 'spin',
  description: 'Sweep the selection around an axis, bridging each step to the one before it.',
  params: SPIN_PARAMS,
  // `centre` is deliberately absent: see `centreOf`. Everything else has a constant default.
  defaults: { steps: 12, angle: 360, axis: [0, 0, 1], duplicates: false, autoMerge: true },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => {
    const options = sweepOptions(context, params, {
      steps: numberOf(params.steps, 12),
      angle: (numberOf(params.angle, 360) * Math.PI) / 180,
      rise: 0,
      duplicates: switchOf(params.duplicates, false),
      autoMerge: switchOf(params.autoMerge, true),
    })
    if (typeof options === 'string') return { error: options }
    return runOnMeshes(context, (target) => sweep(target, options), { label: 'Spin' })
  },
})

registerOperator<OperatorParams>({
  id: 'mesh.screw',
  label: 'Screw',
  section: 'Mesh',
  icon: 'modifier-screw',
  description: 'Spin the selection through several turns, climbing along the axis as it goes.',
  params: [
    numberParam('steps', 'Steps a turn', { min: 1, max: 512, step: 1, defaultValue: 12 }),
    numberParam('turns', 'Turns', { min: -64, max: 64, step: 1, defaultValue: 1 }),
    vectorParam('axis', 'Axis', { defaultValue: [0, 0, 1], step: 0.1, view: 'direction' }),
    vectorParam('centre', 'Centre', { defaultValue: [0, 0, 0], step: 0.1, unit: 'm' }),
  ],
  // `centre` is deliberately absent: see `centreOf`.
  defaults: { steps: 12, turns: 1, axis: [0, 0, 1] },
  modal: true,
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => {
    const turns = numberOf(params.turns, 1)
    const perTurn = Math.max(1, Math.round(numberOf(params.steps, 12)))
    const axis = vectorOf(params.axis) ?? [0, 0, 1]
    if (length(axis) < 1e-9) return { error: NEEDS_AXIS }
    const direction = normalize(axis)
    return runOnMeshes(context, (target) => {
      const seeds = [...selectedVertices(target)]
      if (seeds.length === 0) return NOTHING_SELECTED
      // Blender takes the climb from the profile's open edge. This takes it from how far the
      // selection reaches along the axis, which is the same number for the profiles a screw is
      // reached for — a line, an arc, a small loop — and is defined for the ones where it is not.
      const along = seeds.map((slot) => dot(direction, target.mesh.position(slot)))
      const rise = (Math.max(...along) - Math.min(...along)) * turns
      const options = sweepOptions(context, params, {
        steps: perTurn * Math.max(1, Math.abs(Math.round(turns))),
        angle: turns * Math.PI * 2,
        rise,
        duplicates: false,
        autoMerge: false,
      })
      return typeof options === 'string' ? options : sweep(target, options)
    }, { label: 'Screw' })
  },
})

/* -------------------------------------------------------------------- smoothing */

/**
 * Which of the three axes a smoothing pass is allowed to move a vertex along.
 *
 * Exported because the Smooth modifier is this operator run over a whole mesh rather than over a
 * selection, and one algorithm written twice is two algorithms as soon as either is corrected.
 */
export type SmoothAxes = [boolean, boolean, boolean]

type Axes = SmoothAxes

/** The average of a vertex's neighbours, or null where it has none to average. */
function neighbourhood(mesh: EditMesh, slot: number): Vec3 | null {
  const edges = mesh.vertexEdges(slot)
  if (edges.length === 0) return null
  let total: Vec3 = [0, 0, 0]
  let count = 0
  for (const edge of edges) {
    const [a, b] = mesh.edgeVertices(edge)
    const other = a === slot ? b : a
    if (other < 0 || other === slot) continue
    total = add(total, mesh.position(other))
    count += 1
  }
  return count === 0 ? null : scale(total, 1 / count)
}

/** One pass of `position += factor · (average of the neighbours − position)`, over all of them at once. */
function relax(mesh: EditMesh, slots: number[], factor: number, axes: Axes): void {
  const moved = new Map<number, Vec3>()
  for (const slot of slots) {
    const average = neighbourhood(mesh, slot)
    if (!average) continue
    const here = mesh.position(slot)
    moved.set(slot, [
      axes[0] ? here[0] + (average[0] - here[0]) * factor : here[0],
      axes[1] ? here[1] + (average[1] - here[1]) * factor : here[1],
      axes[2] ? here[2] + (average[2] - here[2]) * factor : here[2],
    ])
  }
  // Every vertex is written after every average is read: a pass that wrote as it went would smooth
  // the low slots against positions the high slots had not reached yet, and depend on slot order.
  for (const [slot, point] of moved) mesh.setPosition(slot, point)
}

/**
 * Repeated relaxation of some vertices of a mesh, which is all Smooth is: the operator hands it a
 * selection, the modifier of the same name hands it every vertex there is.
 */
export function smoothVertices(
  mesh: EditMesh,
  slots: Iterable<number>,
  options: { factor: number; repeat: number; axes: SmoothAxes },
): void {
  const moving = [...slots]
  if (moving.length === 0) return
  for (let pass = 0; pass < options.repeat; pass += 1) relax(mesh, moving, options.factor, options.axes)
}

registerOperator<{ repeat: number; factor: number; axisX: boolean; axisY: boolean; axisZ: boolean }>({
  id: 'mesh.smoothVertices',
  label: 'Smooth vertices',
  section: 'Vertex',
  icon: 'smooth',
  description: 'Move each selected vertex towards the average of the vertices it is joined to.',
  params: [
    numberParam('repeat', 'Repeat', { min: 1, max: 200, step: 1, defaultValue: 1 }),
    numberParam('factor', 'Smoothing', { min: -10, max: 10, step: 0.05, defaultValue: 0.5, view: 'bar' }),
    switchParam('axisX', 'X', true),
    switchParam('axisY', 'Y', true),
    switchParam('axisZ', 'Z', true),
  ],
  defaults: { repeat: 1, factor: 0.5, axisX: true, axisY: true, axisZ: true },
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => runOnMeshes(context, (target) => {
    const slots = [...selectedVertices(target)]
    if (slots.length === 0) return NOTHING_SELECTED
    const axes: Axes = [params.axisX, params.axisY, params.axisZ]
    if (!axes[0] && !axes[1] && !axes[2]) return 'Leave at least one axis on, or nothing can move.'
    smoothVertices(target.mesh, slots, {
      factor: params.factor,
      repeat: Math.max(1, Math.round(params.repeat)),
      axes,
    })
    return {}
  }, { label: 'Smooth vertices' }),
})

/**
 * Taubin's shrinkage constant. A plain Laplacian pass always pulls a surface inwards; following it
 * with a pass of the opposite sign and slightly larger size pushes it back out, and 0.1 is the
 * pass-band value Taubin gives, which is the one Blender uses too.
 */
const PASS_BAND = 0.1

registerOperator<{ repeat: number; lambda: number; preserveVolume: boolean }>({
  id: 'mesh.laplacianSmooth',
  label: 'Laplacian smooth',
  section: 'Vertex',
  icon: 'smooth',
  description: 'Smooth the selection by the Laplacian of the surface, optionally keeping its volume.',
  params: [
    numberParam('repeat', 'Repeat', { min: 1, max: 200, step: 1, defaultValue: 1 }),
    numberParam('lambda', 'Lambda', { min: 0, max: 1, step: 0.01, defaultValue: 0.5, view: 'bar' }),
    switchParam('preserveVolume', 'Preserve volume', true),
  ],
  defaults: { repeat: 1, lambda: 0.5, preserveVolume: true },
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => runOnMeshes(context, (target) => {
    const slots = [...selectedVertices(target)]
    if (slots.length === 0) return NOTHING_SELECTED
    const lambda = Math.min(1, Math.max(0, params.lambda))
    if (lambda === 0) return 'A lambda of zero moves nothing.'
    const axes: Axes = [true, true, true]
    const mu = 1 / (PASS_BAND - 1 / lambda)
    for (let pass = 0; pass < Math.max(1, Math.round(params.repeat)); pass += 1) {
      relax(target.mesh, slots, lambda, axes)
      if (params.preserveVolume) relax(target.mesh, slots, mu, axes)
    }
    return {}
  }, { label: 'Laplacian smooth' }),
})

/* ------------------------------------------------------------------- randomize */

/**
 * A number in [0, 1) from a vertex's own id, the seed and which of the three draws this is.
 *
 * Nothing here holds a position in a sequence, so the offset a vertex gets does not depend on how
 * many vertices came before it, on the order they were visited in, or on anything the editor did
 * earlier: the same seed on the same mesh is the same mesh, which is what makes the redo panel's
 * Seed field a thing a person can actually work with.
 */
function draw(seed: number, id: number, channel: number): number {
  const mixed = Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(id + 1, 0x85ebca6b) ^ Math.imul(channel + 1, 0xc2b2ae35)
  let value = mixed >>> 0
  value ^= value >>> 15
  value = Math.imul(value, 0x2545f491) >>> 0
  value ^= value >>> 13
  return (value >>> 0) / 0x100000000
}

registerOperator<{ amount: number; uniform: number; normal: number; seed: number }>({
  id: 'mesh.randomize',
  label: 'Randomize',
  section: 'Vertex',
  icon: 'smooth',
  description: 'Push each selected vertex a random distance, the same way every time for a seed.',
  params: [
    numberParam('amount', 'Amount', { min: 0, max: 100, step: 0.01, defaultValue: 0.1, unit: 'm' }),
    numberParam('uniform', 'Uniform', { min: 0, max: 1, step: 0.01, defaultValue: 0, view: 'bar' }),
    numberParam('normal', 'Along the normal', { min: 0, max: 1, step: 0.01, defaultValue: 0, view: 'bar' }),
    numberParam('seed', 'Seed', { min: 0, max: 100000, step: 1, defaultValue: 0, view: 'seed' }),
  ],
  defaults: { amount: 0.1, uniform: 0, normal: 0, seed: 0 },
  mode: 'edit',
  available: (context) => requireEdit(context, 'any'),
  run: (context, params) => runOnMeshes(context, (target) => {
    const slots = [...selectedVertices(target)]
    if (slots.length === 0) return NOTHING_SELECTED
    if (params.amount === 0) return 'An amount of zero moves nothing.'
    const seed = Math.max(0, Math.round(params.seed))
    const towardsNormal = Math.min(1, Math.max(0, params.normal))
    const uniform = Math.min(1, Math.max(0, params.uniform))
    // Every offset is worked out before any of them is applied: a vertex normal read after its
    // neighbours have already moved is the normal of a mesh nobody asked to randomize.
    const moved = new Map<number, Vec3>()
    for (const slot of slots) {
      const id = target.mesh.vertexId(slot)
      const drawn: Vec3 = [
        draw(seed, id, 0) * 2 - 1,
        draw(seed, id, 1) * 2 - 1,
        draw(seed, id, 2) * 2 - 1,
      ]
      const chosen = length(drawn) < 1e-9 ? ([0, 0, 1] as Vec3) : normalize(drawn)
      const direction = towardsNormal > 0
        ? normalize(add(scale(chosen, 1 - towardsNormal), scale(target.mesh.vertexNormal(slot), towardsNormal)))
        : chosen
      const spread = uniform + (1 - uniform) * draw(seed, id, 3)
      moved.set(slot, add(target.mesh.position(slot), scale(direction, params.amount * spread)))
    }
    for (const [slot, point] of moved) target.mesh.setPosition(slot, point)
    return {}
  }, { label: 'Randomize' }),
})
