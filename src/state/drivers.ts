import type { ParameterDef, ParamValue } from '@/rigs/types'
import type { ModulationValue, ValueSource } from '@/rigs/extended-types'
import { evaluateExpression } from './expression'
import { normalizeValue } from './parameter-values'

export function sampleModulation(v: ModulationValue, time: number): number {
  const p = ((time * v.rate + v.phase) % 1 + 1) % 1
  let wave = Math.sin(p * Math.PI * 2)
  if (v.mode === 'triangle') wave = 1 - 4 * Math.abs(p - 0.5)
  if (v.mode === 'square') wave = p < 0.5 ? 1 : -1
  if (v.mode === 'noise') {
    const hash = (i: number) => { const n = Math.sin(i * 127.1 + v.seed * 311.7) * 43758.5453; return (n - Math.floor(n)) * 2 - 1 }
    const x = time * v.rate + v.phase, i = Math.floor(x), t = x-i, u = t*t*(3-2*t)
    wave = hash(i) + (hash(i+1)-hash(i))*u
  }
  if (v.mode === 'envelope') {
    const t = Math.max(0,time + v.phase)
    wave = t < v.attack ? t/v.attack : t < v.attack+v.hold ? 1 : Math.max(0,1-(t-v.attack-v.hold)/v.release)
  }
  return v.offset + wave * v.amplitude
}

export function mixValues(a: ParamValue, b: ParamValue, amount: number): ParamValue {
  if (typeof a === 'number' && typeof b === 'number') return a+(b-a)*amount
  if (typeof a === 'string' && typeof b === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(a) && /^#[\da-f]{6}([\da-f]{2})?$/i.test(b)) {
    const aa=a.slice(1).padEnd(8,'f'), bb=b.slice(1).padEnd(8,'f')
    return '#'+[0,2,4,6].map(i=>Math.round(parseInt(aa.slice(i,i+2),16)*(1-amount)+parseInt(bb.slice(i,i+2),16)*amount).toString(16).padStart(2,'0')).join('')
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((v,i)=>mixValues(v,b[i]!,amount))
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const aa=a as Record<string,ParamValue>, bb=b as Record<string,ParamValue>
    return Object.fromEntries(Object.keys(aa).map(k=>[k, Object.hasOwn(bb,k) ? mixValues(aa[k]!,bb[k]!,amount) : aa[k]!]))
  }
  return structuredClone(amount < 0.5 ? a : b)
}

export function drivenValues(parameters: ParameterDef[], input: Record<string,ParamValue>, sources: Record<string, ValueSource>, time: number) {
  const output = {...input}
  const errors: Record<string,string> = {}
  const drivers = new Map<string, {owner:string; read:(resolve:(id:string)=>number)=>ParamValue}>()
  const add = (target:string, owner:string, read:(resolve:(id:string)=>number)=>ParamValue) => {
    if (!parameters.some(p=>p.id===target)) { errors[owner]=`Unknown target: ${target}`; return }
    if (drivers.has(target)) { errors[owner]=`Multiple drivers target ${target}`; return }
    drivers.set(target,{owner,read})
  }
  for (const p of parameters) {
    if (p.kind !== 'number') continue
    const source = sources[p.id] ?? p.defaultSource ?? { mode: 'local' }
    const validNumericSource = (id: string | undefined) => id && parameters.some(item => item.id === id && item.kind === 'number' && !item.readOnly)
    if (source.mode === 'parameter') {
      if (!validNumericSource(source.source)) errors[p.id] = 'Choose a numeric source parameter'
      else add(p.id, p.id, resolve => resolve(source.source!))
    }
    if (source.mode === 'expression') {
      const expression = source.expression?.trim()
      if (!expression) errors[p.id] = 'Enter an expression'
      else add(p.id, p.id, resolve => evaluateExpression(expression, id => id === 't' ? time : resolve(id)))
    }
    if (source.mode === 'macro') {
      if (!validNumericSource(source.source)) errors[p.id] = 'Choose a macro source parameter'
      else add(p.id, p.id, resolve => source.min + (source.max - source.min) * (resolve(source.source!) - (parameters.find(item => item.id === source.source) as Extract<ParameterDef, { kind: 'number' }>).min) / ((parameters.find(item => item.id === source.source) as Extract<ParameterDef, { kind: 'number' }>).max - (parameters.find(item => item.id === source.source) as Extract<ParameterDef, { kind: 'number' }>).min || 1))
    }
    if (source.mode === 'modulation') add(p.id, p.id, () => sampleModulation({ ...source, enabled: true, mode: source.shape }, time))
    if (source.mode === 'blend') {
      if (source.source && !validNumericSource(source.source)) errors[p.id] = 'Choose a blend source parameter'
      else add(p.id, p.id, resolve => source.from + (source.to - source.from) * (source.source ? resolve(source.source) : source.amount ?? 0))
    }
  }
  const resolved = new Set<string>(), visiting = new Set<string>()
  const resolve = (id:string): number => {
    if (visiting.has(id)) throw new Error('Circular parameter link')
    const driver = drivers.get(id)
    if (driver && !resolved.has(id)) {
      visiting.add(id)
      try { output[id] = normalizeValue(parameters.find(p=>p.id===id)!,driver.read(resolve)); resolved.add(id) }
      catch (error) { errors[driver.owner] = error instanceof Error ? error.message : 'Invalid driver'; throw error }
      finally { visiting.delete(id) }
    }
    const value=output[id]
    if (typeof value!=='number') throw new Error(`Not a numeric parameter: ${id}`)
    return value
  }
  for (const id of drivers.keys()) {
    try { resolve(id) } catch { /* Keep the stored value and expose the error alongside the controller. */ }
  }
  return {values:output,errors}
}
