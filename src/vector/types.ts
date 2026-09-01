export type VectorTool = 'select' | 'transform' | 'node' | 'pen' | 'pencil' | 'lasso' | 'bucket' | 'rectangle' | 'ellipse'

export type VectorElementKind = 'rectangle' | 'ellipse' | 'path' | 'group'

export type VectorPoint = { x: number; y: number }

export type VectorHandleMode = 'mirrored' | 'asymmetric' | 'independent'

/** A vector network node in normalised element-box coordinates. */
export type VectorNetworkNode = {
  id: string
  x: number
  y: number
  /** Corner radius, applied when the node joins exactly two segments without handles. */
  radius?: number
  /** Handle mirroring between the two handles of a two-segment node. */
  handles?: VectorHandleMode
}

/** A cubic segment between two nodes; `ah`/`bh` are handle offsets from node a / node b. */
export type VectorNetworkSegment = {
  id: string
  a: string
  b: string
  ah?: VectorPoint
  bh?: VectorPoint
}

export type VectorNetwork = {
  nodes: VectorNetworkNode[]
  segments: VectorNetworkSegment[]
}

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
  /** Editable geometry as a graph; primitives without one use their implicit outline. */
  network?: VectorNetwork
  /** Face keys whose fill is switched off with the paint bucket. */
  regionsOff?: string[]
  /** Group membership. Descendants sit immediately before their group in `elements`. */
  parentId?: string
}

export type VectorGuide = {
  id: string
  axis: 'x' | 'y'
  position: number
}

export type VectorVersion = {
  id: string
  name: string
  createdAt: string
  elements: VectorElement[]
  guides: VectorGuide[]
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
  /** Named snapshots, oldest first. */
  versions?: VectorVersion[]
  createdAt: string
  updatedAt: string
}
