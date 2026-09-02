export type VectorTool = 'select' | 'transform' | 'node' | 'pen' | 'pencil' | 'lasso' | 'bucket' | 'rectangle' | 'ellipse' | 'text' | 'frame' | 'line' | 'polygon'

export type VectorElementKind = 'rectangle' | 'ellipse' | 'path' | 'group' | 'text' | 'frame' | 'image' | 'polygon'

export type VectorImageRendering = 'smooth' | 'pixelated'
/** The part of a picture an image element shows, in normalised image coordinates. */
export type VectorCrop = { x: number; y: number; width: number; height: number }

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
  /** Linear gradient ends in normalised box coordinates; `angle` is the fallback. */
  from?: VectorPoint
  to?: VectorPoint
  /** Radial gradient centre and radius in normalised box coordinates. */
  center?: VectorPoint
  radius?: number
  image?: string
  imageMode?: 'fill' | 'fit' | 'tile'
  /** Where the picture sits inside the box, in fractions of the box, and how big it is drawn. */
  imageOffset?: VectorPoint
  imageScale?: number
}

export type VectorTextAlign = 'left' | 'center' | 'right'
/** `auto` grows the box with the content; `fixed` wraps the content into the box width. */
export type VectorTextSizing = 'auto' | 'fixed'

export type VectorStyleKind = 'fill' | 'stroke'

/** A named paint, stored in the document and applied to elements by reference. */
export type VectorStyle = {
  id: string
  name: string
  kind: VectorStyleKind
  paints: VectorPaint[]
  /** Stroke styles also carry the contour properties. */
  strokeWidth?: number
  strokeAlign?: VectorStrokeAlign
  strokeCap?: VectorStrokeCap
  strokeJoin?: VectorStrokeJoin
  strokeDash?: [number, number]
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
  /** Polygons and stars: how many sides, and how far in the inner points sit (0 = plain polygon). */
  sides?: number
  innerRatio?: number
  /** Ellipses: the slice that is drawn, in degrees, and the hole in the middle (0 to 1). */
  arcStart?: number
  arcSweep?: number
  arcRatio?: number
  /** Rectangles: uniform radius, or top-left, top-right, bottom-right, bottom-left. */
  cornerRadius?: number | [number, number, number, number]
  /** 0 = circular arcs, 1 = fully smoothed (iOS-style) corners. */
  cornerSmoothing?: number
  opacity: number
  visible: boolean
  locked: boolean
  /** Text content, `\n` between lines. Text elements only. */
  text?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  /** Line advance as a multiple of the font size. */
  lineHeight?: number
  /** Extra advance between characters, in pixels at the current font size. */
  letterSpacing?: number
  textAlign?: VectorTextAlign
  textSizing?: VectorTextSizing
  /** Frames only: whether children are cut off at the frame's edge. */
  clipContent?: boolean
  /** Image elements: the picture as a data URL, plus how it is shown. */
  image?: string
  imageRendering?: VectorImageRendering
  crop?: VectorCrop
  /** Natural pixel size of the picture, so its shape is known without decoding it. */
  imageWidth?: number
  imageHeight?: number
  /** Named style this element's fill follows; its paints are kept in step with the style. */
  fillStyleId?: string
  strokeStyleId?: string
  /** Editable geometry as a graph; primitives without one use their implicit outline. */
  network?: VectorNetwork
  /** Face keys whose fill is switched off with the paint bucket. */
  regionsOff?: string[]
  /** Group membership. Descendants sit immediately before their group in `elements`. */
  parentId?: string
}

/** A saved export setting, applied from the export menu. */
export type VectorExportPreset = {
  id: string
  name: string
  target: 'document' | 'selection' | 'frame'
  format: 'svg' | 'png'
  scale: 1 | 2 | 3
  transparent: boolean
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
  /** Export settings the user saved with this document. */
  exportPresets?: VectorExportPreset[]
  /** Named fill and stroke styles. */
  styles?: VectorStyle[]
  /** Colours pinned to this document, and the last ones used. */
  swatches?: string[]
  recentColors?: string[]
  createdAt: string
  updatedAt: string
}
