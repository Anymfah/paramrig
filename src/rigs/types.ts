export type Vec2 = [number, number]

export type BezierCurve = {
  type: 'cubic-bezier'
  p0: Vec2
  p1: Vec2
  p2: Vec2
  p3: Vec2
}

export type GradientStop = {
  t: number
  color: string
}

export type ParamValue = number | string | boolean | BezierCurve | GradientStop[]

export type NumberParam = {
  kind: 'number'
  id: string
  label: string
  group: string
  min: number
  max: number
  step: number
  unit?: string
  defaultValue: number
  sliderMin?: number
  sliderMax?: number
}

export type ColorParam = {
  kind: 'color'
  id: string
  label: string
  group: string
  defaultValue: string
}

export type SelectParam = {
  kind: 'select'
  id: string
  label: string
  group: string
  options: { value: string; label: string }[]
  defaultValue: string
  appliesToTracks?: boolean
}

export type CurveParam = {
  kind: 'curve'
  id: string
  label: string
  group: string
  defaultValue: BezierCurve
}

export type SwitchParam = {
  kind: 'switch'
  id: string
  label: string
  group: string
  defaultValue: boolean
}

export type GradientParam = {
  kind: 'gradient'
  id: string
  label: string
  group: string
  defaultValue: GradientStop[]
}

export type ParameterDef =
  | NumberParam
  | ColorParam
  | SelectParam
  | CurveParam
  | SwitchParam
  | GradientParam

export type Keyframe = {
  time: number
  value: number
}

export type AnimTrack = {
  paramId: string
  interpolation: 'linear' | 'step'
  keyframes: Keyframe[]
}

export type AnimationDef = {
  duration: number
  fps: number
  loop: boolean
  tracks: AnimTrack[]
}

export type ParamGroup = {
  id: string
  label: string
}

export type RendererKind = 'svg' | 'three' | 'html'

export type RigManifest = {
  id: string
  name: string
  summary: string
  description: string
  renderer: RendererKind
  rendererLabel: string
  collection: 'examples' | 'project'
  sourceFile: string
  tags: string[]
  groups: ParamGroup[]
  parameters: ParameterDef[]
  animation?: AnimationDef
}

export type Snapshot = {
  id: string
  name: string
  createdAt: string
  values: Record<string, ParamValue>
  tracks?: AnimTrack[]
}

export type ExportDocument = {
  version: 1
  rigId: string
  name: string
  exportedAt: string
  values: Record<string, ParamValue>
  animation?: {
    duration: number
    fps: number
    loop: boolean
    playhead: number
    tracks: AnimTrack[]
  }
}

export type StoredDraft = {
  version: 1
  rigId: string
  values: Record<string, ParamValue>
  snapshots: Snapshot[]
  compare: 'original' | 'current'
  activeSnapshotId: string | null
  playhead: number
  loop: boolean
  tracks?: AnimTrack[]
}

export type PanelPrefs = {
  version: 1
  navWidth: number
  inspectorWidth: number
  timelineHeight: number
  navCollapsed: boolean
  inspectorCollapsed: boolean
  timelineCollapsed: boolean
}
