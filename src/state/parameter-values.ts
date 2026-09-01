import type { ParameterDef, ParamValue } from '@/rigs/types'
import type { ModulationValue, ValueSource } from '@/rigs/extended-types'

export function objectValue(value: ParamValue | undefined): Record<string, ParamValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, ParamValue> : {}
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function normalizeValueSource(param: Extract<ParameterDef, { kind: 'number' }>, value: unknown): ValueSource {
  const fallback = param.defaultSource ?? { mode: 'local' as const }
  const v = objectValue(value as ParamValue)
  const mode = String(v.mode)
  if (mode === 'local' || mode === 'animation') return { mode }
  if (mode === 'parameter') return { mode, ...(typeof v.source === 'string' ? { source: v.source.slice(0, 128) } : {}) }
  if (mode === 'expression') return { mode, ...(typeof v.expression === 'string' ? { expression: v.expression.slice(0, 1000) } : {}) }
  if (mode === 'macro') {
    const min = finite(v.min) ? clamp(v.min, param.min, param.max) : param.min
    const max = finite(v.max) ? clamp(v.max, param.min, param.max) : param.max
    return { mode, min: Math.min(min, max), max: Math.max(min, max), ...(typeof v.source === 'string' ? { source: v.source.slice(0, 128) } : {}) }
  }
  if (mode === 'blend') {
    const from = finite(v.from) ? clamp(v.from, param.min, param.max) : param.min
    const to = finite(v.to) ? clamp(v.to, param.min, param.max) : param.max
    const amount = finite(v.amount) ? clamp(v.amount, 0, 1) : undefined
    return { mode, from, to, ...(amount === undefined ? {} : { amount }), ...(typeof v.source === 'string' ? { source: v.source.slice(0, 128) } : {}) }
  }
  if (mode === 'modulation') {
    const defaults: ModulationValue = { enabled: true, mode: 'sine', rate: 1, phase: 0, amplitude: 1, offset: 0, attack: 0.5, hold: 1, release: 0.5, seed: 0 }
    const number = (key: keyof ModulationValue, lo: number, hi: number) => finite(v[key]) ? clamp(v[key] as number, lo, hi) : defaults[key] as number
    return { mode, shape: ['sine', 'triangle', 'square', 'noise', 'envelope'].includes(String(v.shape)) ? String(v.shape) : defaults.mode,
      rate: number('rate', 0.01, 60), phase: number('phase', 0, 1), amplitude: number('amplitude', 0, 10000), offset: number('offset', -10000, 10000),
      attack: number('attack', 0.01, 60), hold: number('hold', 0, 60), release: number('release', 0.01, 60), seed: number('seed', 0, 1000000) }
  }
  return fallback
}

/** All entry points (edits, restored drafts, composites) share this value contract. */
export function normalizeValue(param: ParameterDef, value: unknown): ParamValue {
  const fallback = () => structuredClone(param.defaultValue)
  switch (param.kind) {
    case 'number': return finite(value) ? clamp(value, param.min, param.max) : fallback()
    case 'text': return typeof value === 'string' ? value.slice(0, param.maxLength ?? 10000) : fallback()
    case 'color': return typeof value === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(value) ? value : fallback()
    case 'switch': return typeof value === 'boolean' ? value : fallback()
    case 'select': case 'preset': return typeof value === 'string' && param.options.some(o => o.value === value) ? value : fallback()
    case 'multiselect': return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && param.options.some(o => o.value === v)))] : fallback()
    case 'vector': return Array.isArray(value) && value.length === param.axes.length && value.every(finite) ? value.map(v => clamp(v, param.min, param.max)) : fallback()
    case 'range': return Array.isArray(value) && value.length === 2 && value.every(finite) ? value.map(v => clamp(v, param.min, param.max)).sort((a,b) => a-b) : fallback()
    case 'palette': return Array.isArray(value) && value.every(v => typeof v === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(v)) ? value.slice(0, param.maxItems ?? 16) : fallback()
    case 'points': {
      if (!Array.isArray(value) || value.length < 2 || value.length > 128) return fallback()
      if (!value.every(v => v && finite(v.x) && finite(v.y))) return fallback()
      const points = value.map(v => ({x: clamp(v.x, 0, 1), y: clamp(v.y, param.min ?? 0, param.max ?? 1)}))
      return param.view === 'path' ? points : points.sort((a,b) => a.x-b.x)
    }
    case 'radial': {
      if (!Array.isArray(value) || value.length < 1) return fallback()
      const hex = (v: unknown) => typeof v === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(v)
      const layers = value.slice(0, param.maxLayers ?? 8).flatMap(entry => {
        const v = objectValue(entry as ParamValue)
        if (typeof v.name !== 'string' || !hex(v.color) || !Array.isArray(v.points) || v.points.length < 2) return []
      const points = v.points.flatMap(point => {
        const item = objectValue(point)
        return finite(item.x) && finite(item.y) ? [{ x: clamp(item.x, 0, 1), y: clamp(item.y, 0, 1) }] : []
      }).slice(0, 32).sort((a,b) => a.x-b.x)
        if (points.length < 2) return []
        return [{ name: v.name.slice(0, 32), color: String(v.color), enabled: v.enabled !== false, points }]
      })
      return layers.length ? layers : fallback()
    }
    case 'group': {
      const source = objectValue(value as ParamValue)
      return Object.fromEntries(param.fields.map(field => [field.id, normalizeValue(field, source[field.id])]))
    }
    case 'list': return Array.isArray(value) ? value.slice(0, param.maxItems ?? 32).map(v => normalizeValue(param.item, v)) : fallback()
    case 'resource': {
      if (value === null) return null
      const v = objectValue(value as ParamValue)
      return typeof v.id === 'string' && typeof v.name === 'string' && typeof v.mime === 'string' && finite(v.size)
        ? {id:v.id, name:v.name, mime:v.mime, size:v.size} : fallback()
    }
    case 'gizmo2d': {
      const v=objectValue(value as ParamValue)
      return Array.isArray(v.position)&&v.position.length===2&&v.position.every(finite)&&Array.isArray(v.size)&&v.size.length===2&&v.size.every(finite)&&finite(v.rotation)
        ? {position:[clamp(v.position[0] as number,-1,1),clamp(v.position[1] as number,-1,1)],size:[clamp(v.size[0] as number,0.1,2),clamp(v.size[1] as number,0.1,2)],rotation:clamp(v.rotation,-180,180)} : fallback()
    }
    case 'gizmo3d': {
      const v=objectValue(value as ParamValue)
      const vector=(value:unknown,lo:number,hi:number):[number,number,number]|null=>Array.isArray(value)&&value.length===3&&value.every(finite)?[clamp(value[0] as number,lo,hi),clamp(value[1] as number,lo,hi),clamp(value[2] as number,lo,hi)]:null
      const position=vector(v.position,-1,1),rotation=vector(v.rotation,-180,180),scale=vector(v.scale,0.1,2)
      return position&&rotation&&scale&&['translate','rotate','scale'].includes(String(v.mode)) ? {position,rotation,scale,mode:String(v.mode) as 'translate'|'rotate'|'scale'} : fallback()
    }
    case 'textureFrame': {
      const v=objectValue(value as ParamValue)
      if(!Array.isArray(v.rect)||v.rect.length!==4||!v.rect.every(finite)||!finite(v.rotation))return fallback()
      const [left,top,right,bottom]=v.rect.map(n=>clamp(n as number,0,1)) as [number,number,number,number]
      return {rect:[Math.min(left,right-.05),Math.min(top,bottom-.05),Math.max(right,left+.05),Math.max(bottom,top+.05)],rotation:clamp(v.rotation,-180,180)}
    }
    case 'camera': {
      const v=objectValue(value as ParamValue)
      return finite(v.azimuth)&&finite(v.elevation)&&finite(v.distance)&&finite(v.fov)
        ? {azimuth:clamp(v.azimuth,-180,180),elevation:clamp(v.elevation,-80,80),distance:clamp(v.distance,1,20),fov:clamp(v.fov,20,100)} : fallback()
    }
    case 'action': return finite(value) ? Math.max(0, Math.floor(value)) : fallback()
    case 'curve': {
      const v = objectValue(value as ParamValue)
      return v.type === 'cubic-bezier' && ['p0','p1','p2','p3'].every(k => Array.isArray(v[k]) && (v[k] as unknown[]).length === 2 && (v[k] as unknown[]).every(finite)) ? structuredClone(value as ParamValue) : fallback()
    }
    case 'gradient': return Array.isArray(value) && value.length >= 2 && value.every(v => finite(v?.t) && typeof v?.color === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(v.color))
      ? value.slice(0,64).map(v => ({t:clamp(v.t,0,1),color:v.color})).sort((a,b)=>a.t-b.t) : fallback()
  }
}
