export type VectorTool = 'select' | 'transform' | 'node' | 'pen' | 'rectangle' | 'ellipse'

export type VectorElementKind = 'rectangle' | 'ellipse' | 'path' | 'group'

export type VectorPoint = { x: number; y: number }

export type VectorNode = VectorPoint & {
  in?: VectorPoint
  out?: VectorPoint
}

export type VectorElement = {
  id: string
  kind: VectorElementKind
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  /** Hex colour or `'none'`. */
  fill: string
  /** Hex colour or `'none'`. */
  stroke: string
  strokeWidth: number
  opacity: number
  visible: boolean
  locked: boolean
  vectorNodes?: VectorNode[]
  /** Paths only. `false` leaves the last segment open; defaults to `true`. */
  closed?: boolean
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
