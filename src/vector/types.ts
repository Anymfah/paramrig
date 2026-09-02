export type VectorTool = 'select' | 'transform' | 'node' | 'pen' | 'pencil' | 'lasso' | 'bucket' | 'rectangle' | 'ellipse' | 'text' | 'frame' | 'line' | 'polygon' | 'scissors' | 'scale' | 'hand' | 'zoom' | 'measure' | 'width'

export type VectorElementKind = 'rectangle' | 'ellipse' | 'path' | 'group' | 'text' | 'frame' | 'image' | 'polygon' | 'boolean'

export type VectorBooleanOperation = 'unite' | 'subtract' | 'intersect' | 'exclude'

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

/**
 * The OpenType features a text asks for. Kerning is on unless it is turned off, which is what a
 * reader expects; the other three are off unless asked for.
 */
export type VectorFontFeatures = { liga?: boolean; kern?: boolean; smcp?: boolean; tnum?: boolean }

/**
 * A text riding on another object's outline. `d` is a copy of the path the text follows, kept in
 * step with the object it names, so the text draws itself wherever it is opened.
 */
export type VectorTextPath = {
  elementId: string
  /** How far along the path the text starts, as a fraction of its length. */
  offset: number
  side: 'above' | 'below'
  align: VectorTextAlign
  d?: string
}
/** `auto` grows the box with the content; `fixed` wraps the content into the box width. */
export type VectorTextSizing = 'auto' | 'fixed'

export type VectorEffectKind = 'dropShadow' | 'innerShadow' | 'layerBlur' | 'backgroundBlur'

/**
 * One effect layer, applied bottom of the list first. Shadows use offset, blur, spread and a
 * colour; the blurs only use `blur`. `backgroundBlur` frosts what shows through the element, so
 * it only says anything on a frame or under a see-through fill.
 */
export type VectorEffect = {
  id: string
  kind: VectorEffectKind
  visible: boolean
  /** Shadows: how far the shadow is pushed, in pixels. */
  dx?: number
  dy?: number
  /** Blur radius in pixels, for both the shadows and the two blurs. */
  blur: number
  /** Shadows: how much the shape is fattened before it is blurred. */
  spread?: number
  color?: string
  /** Shadow colour opacity, 0 to 1. */
  opacity?: number
}

export type VectorBlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'colorDodge' | 'colorBurn' | 'hardLight' | 'softLight'
  | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity'

/** Picture corrections, each from −1 to 1 with 0 leaving the picture alone. */
export type VectorImageAdjustments = {
  exposure?: number
  contrast?: number
  saturation?: number
  temperature?: number
  highlights?: number
  shadows?: number
}

export type VectorStyleKind = 'fill' | 'stroke' | 'effect'

/** A named paint, stored in the document and applied to elements by reference. */
export type VectorStyle = {
  id: string
  name: string
  kind: VectorStyleKind
  paints: VectorPaint[]
  /** Effect styles carry effects instead of paints. */
  effects?: VectorEffect[]
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
/** Width along a stroke: `t` runs 0 to 1 over the whole chain, `width` multiplies `strokeWidth`. */
export type VectorStrokeProfile = Array<{ t: number; width: number }>

/** A stamp shape in a unit box, used by a brushed stroke. */
export type VectorBrush = { id: string; name: string; network: VectorNetwork }

/**
 * How an element uses a brush: which one, how densely, how scattered, how tapered. The shape is
 * copied onto the element the way a linked style copies its paints, so an object still draws
 * itself when it is exported, pasted elsewhere or opened without the document that defined it.
 */
export type VectorBrushSettings = { id: string; spacing: number; jitter: number; taper: number; network?: VectorNetwork }

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
  /** Width along the stroke, at least two points. Absent means an even width. */
  strokeProfile?: VectorStrokeProfile
  /** Stamps the stroke with a brush from the document instead of drawing a line. */
  brush?: VectorBrushSettings
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
  /** Text elements: the outline this text runs along, instead of its own box. */
  textPath?: VectorTextPath
  /** Ligatures, kerning, small capitals and tabular figures. */
  fontFeatures?: VectorFontFeatures
  /** Frames only: whether children are cut off at the frame's edge. */
  clipContent?: boolean
  /** Boolean groups: how the shapes under it are combined. */
  operation?: VectorBooleanOperation
  /** The bottom child of a group can cut the ones above it to its own shape. */
  mask?: boolean
  /** Image elements: the picture as a data URL, plus how it is shown. */
  image?: string
  imageRendering?: VectorImageRendering
  crop?: VectorCrop
  /** Natural pixel size of the picture, so its shape is known without decoding it. */
  imageWidth?: number
  imageHeight?: number
  /** Effects, applied in order: shadows, then blurs. */
  effects?: VectorEffect[]
  /** How this element mixes with what is under it. Absent means `normal`. */
  blendMode?: VectorBlendMode
  /** Image elements and image fills: the corrections applied to the picture. */
  adjustments?: VectorImageAdjustments
  /** Named style this element's fill follows; its paints are kept in step with the style. */
  fillStyleId?: string
  strokeStyleId?: string
  effectStyleId?: string
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
  /** Brushes this document defines, on top of the ones that ship. */
  brushes?: VectorBrush[]
  /** Colours pinned to this document, and the last ones used. */
  swatches?: string[]
  recentColors?: string[]
  createdAt: string
  updatedAt: string
}
