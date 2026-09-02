/**
 * Which overlay wins a click when several sit under the pointer.
 *
 * The canvas stacks a lot of transparent hit layers, and at high zoom they overlap for real. The
 * order below is the contract; on the canvas it is enforced by paint order (the last painted
 * layer receives the pointer), and `pickHit` states the same order for anything that has to
 * resolve a list of candidates itself — a test, a QA run, a keyboard equivalent.
 */
export const HIT_LAYERS = [
  'rotate',
  'handle',
  'pivot',
  'node',
  'control',
  'segment',
  'element',
  'guide',
  'canvas',
] as const

export type HitLayer = (typeof HIT_LAYERS)[number]

/** How specific a layer is: a lower number takes the click. */
export function layerRank(layer: HitLayer): number {
  return HIT_LAYERS.indexOf(layer)
}

type AttributeSource = { getAttribute: (name: string) => string | null }

/** The layer a DOM node belongs to, read from the data attributes the canvas puts on it. */
export function hitLayerOf(node: AttributeSource | null | undefined): HitLayer | null {
  if (!node) return null
  if (node.getAttribute('data-vector-rotate') !== null) return 'rotate'
  const handle = node.getAttribute('data-vector-handle')
  if (handle !== null) return handle === 'pivot' ? 'pivot' : 'handle'
  if (node.getAttribute('data-vector-node') !== null) return 'node'
  if (node.getAttribute('data-vector-control') !== null) return 'control'
  if (node.getAttribute('data-vector-segment') !== null) return 'segment'
  if (node.getAttribute('data-vector-element') !== null) return 'element'
  if (node.getAttribute('data-vector-guide') !== null) return 'guide'
  return null
}

/** The one of several candidates under the pointer that should take the click. */
export function pickHit<Node extends AttributeSource>(candidates: Node[]): Node | null {
  let best: { node: Node; rank: number } | null = null
  for (const candidate of candidates) {
    const layer = hitLayerOf(candidate)
    if (!layer) continue
    const rank = layerRank(layer)
    if (!best || rank < best.rank) best = { node: candidate, rank }
  }
  return best?.node ?? null
}

/**
 * Pointer target and glyph radii in document units, so a handle keeps the same size on screen
 * whatever the zoom. Targets are diameters in CSS pixels: 32 with a mouse, 44 with a finger.
 */
export const HANDLE_TARGET_PX = 32
export const HANDLE_TARGET_COARSE_PX = 44
export const HANDLE_GLYPH_PX = 8

export function handleRadii(zoom: number, coarse: boolean): { hit: number; glyph: number } {
  return {
    hit: (coarse ? HANDLE_TARGET_COARSE_PX : HANDLE_TARGET_PX) / 2 / zoom,
    glyph: HANDLE_GLYPH_PX / 2 / zoom,
  }
}
