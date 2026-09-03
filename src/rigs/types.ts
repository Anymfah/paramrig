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

export type ParamValue = number | string | boolean | null | BezierCurve | GradientStop[] | ParamValue[] | { [key: string]: ParamValue }

export type NumberParam = {
  kind: 'number'
  id: string
  label: string
  group: string
  min: number
  max: number
  step: number
  unit?: string
  /** Display-only unit conversions. Stored values remain in the base unit. */
  units?: { value: string; label: string; factor: number; step?: number }[]
  defaultValue: number
  sliderMin?: number
  sliderMax?: number
  /** 'bar' is the default measured view: the field itself is the track, filled to the value. */
  view?: 'field' | 'stepper' | 'bar' | 'knob' | 'angle' | 'seed'
  scale?: 'linear' | 'log'
  stops?: number[]
  readOnly?: boolean
  role?: 'duration' | 'playhead'
  defaultSource?: import('./extended-types').ValueSource
  hidden?: boolean
}

export type ColorParam = {
  kind: 'color'
  id: string
  label: string
  group: string
  defaultValue: string
  alpha?: boolean
  channels?: boolean
  hidden?: boolean
}

export type SelectParam = {
  kind: 'select'
  id: string
  label: string
  group: string
  options: { value: string; label: string; preview?: string }[]
  defaultValue: string
  appliesToTracks?: boolean
  view?: 'search' | 'visual' | 'font'
  hidden?: boolean
}

export type CurveParam = {
  kind: 'curve'
  id: string
  label: string
  group: string
  defaultValue: BezierCurve
  hidden?: boolean
}

export type SwitchParam = {
  kind: 'switch'
  id: string
  label: string
  group: string
  defaultValue: boolean
  hidden?: boolean
}

export type GradientParam = {
  kind: 'gradient'
  id: string
  label: string
  group: string
  defaultValue: GradientStop[]
  hidden?: boolean
}

export type ParameterDef =
  | NumberParam
  | ColorParam
  | SelectParam
  | CurveParam
  | SwitchParam
  | GradientParam
  | import('./extended-types').ExtendedParameter

export type Keyframe = {
  id?: string
  time: number
  value: number
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step'
}

export type KeyframeRef = { paramId: string; id: string }
export type LoopRange = { start: number; end: number }

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
  /** Optional secondary inspector tab. Groups without one remain visible in every tab. */
  tab?: string
  defaultOpen?: boolean
}

export type InspectorCategory = {
  id: string
  label: string
}

export type RendererKind = 'svg' | 'three' | 'html' | 'vector' | 'scene'

export type RigManifest = {
  id: string
  name: string
  summary: string
  description: string
  renderer: RendererKind
  rendererLabel: string
  collection: 'examples' | 'project'
  /** Storybook-style path. Folders are `/` segments; the leaf is `name`. */
  title: string
  sourceFile: string
  tags: string[]
  /** Optional second-level navigation for rigs with several families of controls. */
  inspectorCategories?: InspectorCategory[]
  groups: ParamGroup[]
  parameters: ParameterDef[]
  animation?: AnimationDef
}

export type Snapshot = {
  id: string
  name: string
  createdAt: string
  values: Record<string, ParamValue>
  valueSources?: Record<string, import('./extended-types').ValueSource>
  tracks?: AnimTrack[]
  loop?: boolean
  loopRange?: LoopRange | null
  duration?: number
}

export type ExportDocument = {
  version: 1
  rigId: string
  name: string
  exportedAt: string
  values: Record<string, ParamValue>
  valueSources: Record<string, import('./extended-types').ValueSource>
  animation?: {
    duration: number
    fps: number
    loop: boolean
    playhead: number
    tracks: AnimTrack[]
    loopRange?: LoopRange | null
  }
}

export type StoredDraft = {
  version: 1
  rigId: string
  values: Record<string, ParamValue>
  valueSources?: Record<string, import('./extended-types').ValueSource>
  snapshots: Snapshot[]
  compare: 'original' | 'current'
  activeSnapshotId: string | null
  playhead: number
  loop: boolean
  tracks?: AnimTrack[]
  loopRange?: LoopRange | null
  duration?: number
}

export type PanelPrefs = {
  version: 1
  navWidth: number
  inspectorWidth: number
  timelineHeight: number
  navCollapsed: boolean
  navCompact: boolean
  inspectorCollapsed: boolean
  timelineCollapsed: boolean
}
