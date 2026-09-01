export type VectorTool = 'select' | 'transform' | 'rectangle' | 'ellipse'

export type VectorElementKind = 'rectangle' | 'ellipse'

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
  fill: string
  stroke: string
  strokeWidth: number
  opacity: number
  visible: boolean
  locked: boolean
  vectorNodes?: VectorNode[]
}

export type VectorDocument = {
  version: 1
  id: string
  name: string
  background: string
  width: number
  height: number
  elements: VectorElement[]
  createdAt: string
  updatedAt: string
}
