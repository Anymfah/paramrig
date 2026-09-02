import { chains, chainToRun, localNetwork, runPathData, sanitizeNetwork, type Run } from '@/vector/network'
import { rotatePoint } from '@/vector/directTransform'
import { profileWidth, walkRun } from '@/vector/strokeProfile'
import type { VectorBrush, VectorBrushSettings, VectorElement, VectorNetwork, VectorPoint } from '@/vector/types'

const KAPPA = 0.5522847498307936 / 2
const MAX_STAMPS = 2000

/** A unit circle in the brush's 0-to-1 box. */
const ROUND: VectorNetwork = {
  nodes: [
    { id: 'n1', x: 0.5, y: 0, handles: 'mirrored' }, { id: 'n2', x: 1, y: 0.5, handles: 'mirrored' },
    { id: 'n3', x: 0.5, y: 1, handles: 'mirrored' }, { id: 'n4', x: 0, y: 0.5, handles: 'mirrored' },
  ],
  segments: [
    { id: 's1', a: 'n1', b: 'n2', ah: { x: KAPPA, y: 0 }, bh: { x: 0, y: -KAPPA } },
    { id: 's2', a: 'n2', b: 'n3', ah: { x: 0, y: KAPPA }, bh: { x: KAPPA, y: 0 } },
    { id: 's3', a: 'n3', b: 'n4', ah: { x: -KAPPA, y: 0 }, bh: { x: 0, y: KAPPA } },
    { id: 's4', a: 'n4', b: 'n1', ah: { x: 0, y: -KAPPA }, bh: { x: -KAPPA, y: 0 } },
  ],
}

/** A flat nib held at 45°: a thin bar across the diagonal. */
const CALLIGRAPHIC: VectorNetwork = {
  nodes: [{ id: 'n1', x: 0.06, y: 0.94 }, { id: 'n2', x: 0.94, y: 0.06 }, { id: 'n3', x: 1, y: 0.24 }, { id: 'n4', x: 0.24, y: 1 }],
  segments: [
    { id: 's1', a: 'n1', b: 'n2' }, { id: 's2', a: 'n2', b: 'n3' },
    { id: 's3', a: 'n3', b: 'n4' }, { id: 's4', a: 'n4', b: 'n1' },
  ],
}

/** A short bar across the path: with a wide spacing it reads as a dashed line. */
const DASH: VectorNetwork = {
  nodes: [{ id: 'n1', x: 0, y: 0.35 }, { id: 'n2', x: 1, y: 0.35 }, { id: 'n3', x: 1, y: 0.65 }, { id: 'n4', x: 0, y: 0.65 }],
  segments: [
    { id: 's1', a: 'n1', b: 'n2' }, { id: 's2', a: 'n2', b: 'n3' },
    { id: 's3', a: 'n3', b: 'n4' }, { id: 's4', a: 'n4', b: 'n1' },
  ],
}

export const BUILTIN_BRUSHES: VectorBrush[] = [
  { id: 'brush-round', name: 'Round', network: ROUND },
  { id: 'brush-calligraphic', name: 'Calligraphic', network: CALLIGRAPHIC },
  { id: 'brush-dash', name: 'Dashed', network: DASH },
]

export const DEFAULT_BRUSH_SETTINGS: VectorBrushSettings = { id: 'brush-round', spacing: 0.25, jitter: 0, taper: 0 }

/** The brushes a document offers: the three that ship, plus whatever it defines itself. */
export function brushesOf(document: { brushes?: VectorBrush[] }): VectorBrush[] {
  return [...BUILTIN_BRUSHES, ...(document.brushes ?? [])]
}

export function findBrush(document: { brushes?: VectorBrush[] }, id: string | undefined): VectorBrush | null {
  if (!id) return null
  return brushesOf(document).find((brush) => brush.id === id) ?? null
}

/** Turns the selected object into a stamp: its geometry, squashed into the brush's unit box. */
export function brushFromElement(element: VectorElement, name: string, id: string): VectorBrush | null {
  const network = element.network ?? null
  if (!network || network.segments.length === 0) return null
  return { id, name: name.trim().slice(0, 60) || 'Brush', network: structuredClone(network) }
}

export function sanitizeBrushes(value: unknown): VectorBrush[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  const brushes = value.slice(0, 40).flatMap((candidate): VectorBrush[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const source = candidate as Partial<VectorBrush>
    if (typeof source.id !== 'string' || !source.id || seen.has(source.id)) return []
    if (typeof source.name !== 'string' || !source.name.trim()) return []
    const network = sanitizeNetwork(source.network)
    if (!network) return []
    seen.add(source.id)
    return [{ id: source.id, name: source.name.trim().slice(0, 60), network }]
  })
  return brushes.length ? brushes : undefined
}

/** The shape an element's brush settings draw with: the copy it carries, or the one that ships. */
export function resolveBrush(settings: VectorBrushSettings | undefined): VectorBrush | null {
  if (!settings) return null
  if (settings.network) return { id: settings.id, name: settings.id, network: settings.network }
  return BUILTIN_BRUSHES.find((brush) => brush.id === settings.id) ?? null
}

export function sanitizeBrushSettings(value: unknown): VectorBrushSettings | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Partial<VectorBrushSettings>
  if (typeof source.id !== 'string' || !source.id) return undefined
  const number = (input: unknown, fallback: number, min: number, max: number) =>
    typeof input === 'number' && Number.isFinite(input) ? Math.min(max, Math.max(min, round(input))) : fallback
  const network = source.network ? sanitizeNetwork(source.network) : null
  return {
    id: source.id,
    spacing: number(source.spacing, DEFAULT_BRUSH_SETTINGS.spacing, 0.02, 4),
    jitter: number(source.jitter, 0, 0, 1),
    taper: number(source.taper, 0, 0, 0.5),
    ...(network ? { network } : {}),
  }
}

/**
 * The shape a brush leaves along a set of chains.
 *
 * The stamp is placed at even steps along each chain, scaled by the stroke width and whatever the
 * width profile says at that point, and turned to follow the tangent. The jitter is deterministic
 * — the same path always gives the same scatter — so a repaint never shuffles the stroke.
 */
export function brushOutline(runs: Run[], element: VectorElement, brush: VectorBrush, settings: VectorBrushSettings): string {
  const width = element.strokeWidth
  if (width <= 0) return ''
  const stamps: string[] = []
  runs.forEach((run, runIndex) => {
    const walk = walkRun(run)
    if (walk.length < 2) return
    const length = runLength(walk)
    const step = Math.max(0.02, settings.spacing) * width
    // A tiny spacing on a long path could ask for a hundred thousand stamps; the cap keeps the
    // stroke drawable, at the price of a wider spacing than asked for on a very long chain.
    const count = Math.max(1, Math.min(MAX_STAMPS, Math.round(length / step)))
    for (let index = 0; index <= count; index += 1) {
      const t = count === 0 ? 0 : index / count
      const entry = sampleAt(walk, t)
      const taper = taperFactor(t, settings.taper)
      const size = width * profileWidth(element.strokeProfile, entry.t) * taper
      if (size <= 0.01) continue
      const wobble = settings.jitter * width * 0.5
      const noise = wobble > 0 ? (hash(runIndex * 977 + index) - 0.5) * 2 * wobble : 0
      const center = { x: entry.point.x + entry.normal.x * noise, y: entry.point.y + entry.normal.y * noise }
      const angle = (Math.atan2(entry.normal.y, entry.normal.x) * 180) / Math.PI - 90
      stamps.push(stampPath(brush.network, center, size, angle))
    }
  })
  return stamps.filter(Boolean).join(' ')
}

/** One stamp: the unit shape placed on a point, at a size, turned to the path. */
export function stampPath(network: VectorNetwork, center: VectorPoint, size: number, angle: number): string {
  const box = { x: center.x - size / 2, y: center.y - size / 2, width: size, height: size }
  const world = localNetwork(box, network)
  const turned = {
    nodes: world.nodes.map((node) => ({ ...node, point: rotatePoint(node.point, center, angle) })),
    segments: world.segments.map((segment) => ({
      ...segment,
      ...(segment.ah ? { ah: rotatePoint(segment.ah, center, angle) } : {}),
      ...(segment.bh ? { bh: rotatePoint(segment.bh, center, angle) } : {}),
    })),
  }
  return chains(turned).map((chain) => runPathData(chainToRun(turned, chain))).join(' ')
}

/** A taper eats into both ends: 0 leaves the stroke alone, 0.5 tapers over each half. */
function taperFactor(t: number, taper: number): number {
  if (taper <= 0) return 1
  const reach = Math.min(0.5, taper)
  if (t < reach) return t / reach
  if (t > 1 - reach) return (1 - t) / reach
  return 1
}

function runLength(walk: ReturnType<typeof walkRun>): number {
  let total = 0
  for (let index = 1; index < walk.length; index += 1) {
    total += Math.hypot(walk[index]!.point.x - walk[index - 1]!.point.x, walk[index]!.point.y - walk[index - 1]!.point.y)
  }
  return total
}

function sampleAt(walk: ReturnType<typeof walkRun>, t: number) {
  let best = walk[0]!
  for (const entry of walk) {
    if (Math.abs(entry.t - t) < Math.abs(best.t - t)) best = entry
  }
  return best
}

/** A small deterministic scatter: the same index always gives the same number. */
function hash(index: number): number {
  const value = Math.sin(index * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
