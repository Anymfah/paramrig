import type { ParameterDef, ParamValue } from './types'

export type ParameterBase = { id: string; label: string; group: string; description?: string; hidden?: boolean }
export type Option = { value: string; label: string; preview?: string }
export type Point = { x: number; y: number }
export type RadialZone = { label: string; start: number; end: number }
export type RadialLayer = { name: string; color: string; enabled: boolean; points: Point[] }
export type ResourceValue = { id: string; name: string; mime: string; size: number }
export type Gizmo2DValue = { position: [number, number]; size: [number, number]; rotation: number }
export type Gizmo3DValue = { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number]; mode: 'translate' | 'rotate' | 'scale' }
export type TextureFrameValue = { rect: [number, number, number, number]; rotation: number }
export type CameraValue = { azimuth: number; elevation: number; distance: number; fov: number }
export type ModulationValue = {
  enabled: boolean; mode: string; rate: number; phase: number; amplitude: number; offset: number
  attack: number; hold: number; release: number; seed: number
}
export type ValueSource =
  | { mode: 'local' }
  | { mode: 'parameter'; source?: string }
  | { mode: 'expression'; expression?: string }
  | { mode: 'animation' }
  | { mode: 'macro'; source?: string; min: number; max: number }
  | { mode: 'modulation'; shape: ModulationValue['mode']; rate: number; phase: number; amplitude: number; offset: number; attack: number; hold: number; release: number; seed: number }
  | { mode: 'blend'; source?: string; amount?: number; from: number; to: number }
export type ExtendedParameter = ParameterBase & (
  | { kind: 'vector'; defaultValue: number[]; axes: string[]; min: number; max: number; step: number; unit?: string; view?: 'fields' | 'xy' | 'dimensions' | 'direction' | 'rotation' | 'anchor'; proportional?: boolean; linkLabel?: string }
  | { kind: 'range'; defaultValue: number[]; min: number; max: number; step: number; unit?: string }
  | { kind: 'text'; defaultValue: string; multiline?: boolean; maxLength?: number }
  | { kind: 'multiselect'; defaultValue: string[]; options: Option[] }
  | { kind: 'palette'; defaultValue: string[]; maxItems?: number }
  | { kind: 'points'; defaultValue: Point[]; view?: 'curve' | 'ramp' | 'path'; min?: number; max?: number }
  | { kind: 'radial'; defaultValue: RadialLayer[]; zones?: RadialZone[]; maxLayers?: number }
  | { kind: 'resource'; defaultValue: ResourceValue | null; accept: string; view?: 'image' | 'texture' | 'svg' | 'font' | 'model' | 'environment'; maxMB?: number }
  | { kind: 'gizmo2d'; defaultValue: Gizmo2DValue }
  | { kind: 'gizmo3d'; defaultValue: Gizmo3DValue }
  | { kind: 'textureFrame'; defaultValue: TextureFrameValue }
  | { kind: 'camera'; defaultValue: CameraValue }
  | { kind: 'group'; defaultValue: Record<string, ParamValue>; fields: ParameterDef[] }
  | { kind: 'list'; defaultValue: ParamValue[]; item: ParameterDef; maxItems?: number }
  | { kind: 'action'; defaultValue: number; action: 'set' | 'randomize' | 'reset' | 'trigger'; targets?: string[]; values?: Record<string, ParamValue> }
  | { kind: 'preset'; defaultValue: string; options: { value: string; label: string; values: Record<string, ParamValue> }[] }
)
