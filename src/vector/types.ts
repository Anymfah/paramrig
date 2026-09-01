export type VectorTool = 'select' | 'transform' | 'node' | 'pen' | 'pencil' | 'rectangle' | 'ellipse'

export type VectorElementKind = 'rectangle' | 'ellipse' | 'path' | 'group'

export type VectorPoint = { x: number; y: number }

export type VectorHandleMode = 'mirrored' | 'asymmetric' | 'independent'

export type VectorNode = VectorPoint & {
  in?: VectorPoint
  out?: VectorPoint
  /** How dragging one handle affects the other. Defaults to `mirrored` when both handles exist. */
  handles?: VectorHandleMode
  /** Corner radius applied to this anchor when it is a corner, in document units. */
  radius?: number
}

/** A run of `vectorNodes` starting at `start` (inclusive) up to the next sub-path. */
export type VectorSubpath = { start: number; closed: boolean }

export type VectorFillRule = 'nonzero' | 'evenodd'

export type VectorGradientStop = { t: number; color: string }

/** One paint layer. Solid colours stay hex; gradients run along the element box; images are data URLs. */
export type VectorPaint = {
  id: string
  type: 'solid' | 'linear' | 'radial' | 'image'
  color?: string
  opacity: number
  visible: boolean
  stops?: VectorGradientStop[]
  /** Linear gradient direction in degrees, 0 = left to right, 90 = top to bottom. */
  angle?: number
  image?: string
  imageMode?: 'fill' | 'fit' | 'tile'
}

export type VectorStrokeAlign = 'center' | 'inside' | 'outside'
export type VectorStrokeCap = 'butt' | 'round' | 'square'
export type VectorStrokeJoin = 'miter' | 'round' | 'bevel'
export type VectorArrowhead = 'none' | 'arrow' | 'triangle' | 'circle' | 'square' | 'bar'
export type VectorStrokeSides = { top: boolean; right: boolean; bottom: boolean; left: boolean }

export type VectorElement = {
  id: string
  kind: VectorElementKind
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  /** Hex colour or `'none'`; summary of the first visible solid fill when `fills` is set. */
  fill: string
  /** Hex colour or `'none'`; summary of the first visible solid stroke when `strokes` is set. */
  stroke: string
  strokeWidth: number
  /** Stacked fill layers, bottom first. Absent means the single `fill`. */
  fills?: VectorPaint[]
  /** Stacked stroke layers, bottom first. Absent means the single `stroke`. */
  strokes?: VectorPaint[]
  strokeAlign?: VectorStrokeAlign
  strokeCap?: VectorStrokeCap
  strokeJoin?: VectorStrokeJoin
  /** Dash and gap lengths; absent means solid. */
  strokeDash?: [number, number]
  strokeArrowStart?: VectorArrowhead
  strokeArrowEnd?: VectorArrowhead
  /** Rectangles only: which sides carry the stroke. Absent means all. */
  strokeSides?: VectorStrokeSides
  /** Rectangles: uniform radius, or top-left, top-right, bottom-right, bottom-left. */
  cornerRadius?: number | [number, number, number, number]
  /** 0 = circular arcs, 1 = fully smoothed (iOS-style) corners. */
  cornerSmoothing?: number
  opacity: number
  visible: boolean
  locked: boolean
  vectorNodes?: VectorNode[]
  /** Paths only. `false` leaves the last segment open; defaults to `true`. Ignored when `subpaths` is set. */
  closed?: boolean
  /** Sub-path boundaries inside `vectorNodes`; absent means one sub-path. */
  subpaths?: VectorSubpath[]
  fillRule?: VectorFillRule
  /** Group membership. Descendants sit immediately before their group in `elements`. */
  parentId?: string
}

export type VectorGuide = {
  id: string
  axis: 'x' | 'y'
  position: number
}

export type VectorDocument = {
  version: 1
  id: string
  name: string
  background: string
  width: number
  height: number
  elements: VectorElement[]
  guides: VectorGuide[]
  createdAt: string
  updatedAt: string
}
