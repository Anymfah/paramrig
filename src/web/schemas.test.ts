import { describe, expect, it } from 'vitest'
import manifestSchema from '../../packages/web-sdk/schemas/manifest.schema.json'
import batchSchema from '../../packages/web-sdk/schemas/batch.schema.json'
import responseSchema from '../../packages/web-sdk/schemas/response.schema.json'
import exampleManifest from '../../examples/web/manifest.json'
import sampleBatch from './samples/batch.json'
import sampleResponse from './samples/response.json'
import { isBatch, isResponse, parseManifest, type AgentResponse, type FeedbackBatch } from './contracts'
import { WebSession } from './session'

/*
 * A validator for the subset of JSON Schema these three files use, and no more.
 *
 * There is no validator in this repository and the SDK may not gain a runtime dependency, so this
 * is the alternative to a schema nobody checks. Its own correctness is not taken on trust: every
 * case below asserts that the schema and the hand-written guard reach the *same* verdict, so a
 * validator that waved everything through would fail on the invalid samples and one that refused
 * everything would fail on the valid ones. Leniency here shows up as a failing test, not a passing
 * one.
 */
type Schema = Record<string, unknown>
function validate(schema: Schema, value: unknown, root: Schema = schema, at = '$'): string[] {
  const fail = (why: string) => [`${at}: ${why}`]
  if (typeof schema.$ref === 'string') {
    const path = schema.$ref.replace(/^#\//, '').split('/')
    return validate(path.reduce<Schema>((node, key) => node[key] as Schema, root), value, root, at)
  }
  const errors: string[] = []
  const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) return fail(`is not ${JSON.stringify(schema.const)}`)
  if (Array.isArray(schema.enum) && !schema.enum.some(option => JSON.stringify(option) === JSON.stringify(value))) return fail(`is not one of ${schema.enum.join(', ')}`)
  if (typeof schema.type === 'string') {
    const wanted = schema.type === 'integer' ? 'number' : schema.type
    if (kind !== wanted || schema.type === 'integer' && !Number.isInteger(value)) return fail(`is ${kind}, not ${schema.type}`)
    if (schema.type === 'number' && !Number.isFinite(value)) return fail('is not a finite number')
  }
  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) errors.push(...fail(`does not match ${schema.pattern}`))
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(...fail('is too short'))
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(...fail('is too long'))
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(...fail('is below the minimum'))
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(...fail('is above the maximum'))
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) errors.push(...fail('is not above the exclusive minimum'))
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(...fail('has too few items'))
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(...fail('has too many items'))
    if (schema.items) value.forEach((item, i) => errors.push(...validate(schema.items as Schema, item, root, `${at}[${i}]`)))
  }
  if (kind === 'object') {
    const object = value as Record<string, unknown>
    for (const key of (schema.required as string[] | undefined) ?? []) if (!(key in object)) errors.push(...fail(`has no ${key}`))
    const properties = (schema.properties as Record<string, Schema> | undefined) ?? {}
    for (const [key, sub] of Object.entries(properties)) if (key in object && object[key] !== undefined) errors.push(...validate(sub, object[key], root, `${at}.${key}`))
  }
  for (const branch of (schema.allOf as Schema[] | undefined) ?? []) {
    if (branch.if && branch.then) { if (!validate(branch.if as Schema, value, root, at).length) errors.push(...validate(branch.then as Schema, value, root, at)) }
    else errors.push(...validate(branch, value, root, at))
  }
  return errors
}
const accepts = (schema: Schema, value: unknown) => validate(schema, value).length === 0
const guardAccepts = (guard: (v: unknown) => unknown, value: unknown) => { try { return guard(value) !== false } catch { return false } }

/** One case: what it is, and whether both the schema and the guard should take it. */
const agree = (label: string, schema: Schema, guard: (v: unknown) => unknown, value: unknown, expected: boolean) =>
  it(label, () => {
    const bySchema = accepts(schema, value)
    const byGuard = guardAccepts(guard, value)
    expect({ bySchema, byGuard }).toEqual({ bySchema: expected, byGuard: expected })
  })

const clone = <T>(v: T): T => structuredClone(v)
/** The samples come from JSON, so their types are wide. Narrowing through the guard is the proof. */
const asBatch = (value: unknown): FeedbackBatch => { if (!isBatch(value)) throw new Error('This sample is not a batch.'); return value }
const asResponse = (value: unknown): AgentResponse => { if (!isResponse(value)) throw new Error('This sample is not a response.'); return value }

describe('the schemas and the guards say the same thing about a manifest', () => {
  agree('the example manifest', manifestSchema, parseManifest, exampleManifest, true)
  agree('the reference consumer manifest is a second valid shape', manifestSchema, parseManifest, {
    version: 1, id: 'reference-consumer', name: 'Reference consumer', revision: 'r1', origin: 'http://localhost:3000',
    pages: [{ id: 'home', name: 'Home', path: '/' }], groups: [{ id: 'brand', label: 'Brand' }],
    parameters: [{ id: 'accent', kind: 'color', label: 'Accent', group: 'brand', defaultValue: '#df7757' }],
    bindings: [{ paramId: 'accent', scope: 'global', kind: 'css-variable', property: '--accent' }],
  }, true)

  agree('an identifier outside the format', manifestSchema, parseManifest, { ...clone(exampleManifest), id: '-not an id' }, false)
  agree('a control of an unknown kind', manifestSchema, parseManifest, (() => {
    const m = clone(exampleManifest); m.parameters[0]!.kind = 'hologram'; return m
  })(), false)
  agree('a number control with no range', manifestSchema, parseManifest, (() => {
    const m = clone(exampleManifest) as { parameters: Record<string, unknown>[] }
    m.parameters[0] = { id: 'size', kind: 'number', label: 'Size', group: 'layout', defaultValue: 4 }
    return m
  })(), false)
  agree('a manifest with no pages', manifestSchema, parseManifest, { ...clone(exampleManifest), pages: [] }, false)
  agree('a page path that leaves the origin', manifestSchema, parseManifest, {
    ...clone(exampleManifest), pages: [{ id: 'home', name: 'Home', path: '//evil.example/' }],
  }, false)
  agree('an origin carrying a path', manifestSchema, parseManifest, { ...clone(exampleManifest), origin: 'http://127.0.0.1:5174/app' }, false)
  agree('an element binding with no target', manifestSchema, parseManifest, (() => {
    const m = clone(exampleManifest) as { bindings: Record<string, unknown>[] }
    m.bindings[0] = { paramId: m.bindings[0]!.paramId, scope: 'element', kind: 'style', property: 'color' }
    return m
  })(), false)

  it('names the two rules it cannot express, so the guard is never assumed to be the same check', () => {
    const duplicated = clone(exampleManifest)
    duplicated.parameters.push(clone(duplicated.parameters[0]!))
    expect(accepts(manifestSchema, duplicated)).toBe(true)
    expect(guardAccepts(parseManifest, duplicated)).toBe(false)
    expect(manifestSchema.description).toContain('unique')
    expect(manifestSchema.description).toContain('paramId')
  })
})

describe('the schemas and the guards say the same thing about a batch', () => {
  agree('a batch the workspace actually wrote', batchSchema, isBatch, sampleBatch, true)
  agree('a batch whose ticket has an unknown status', batchSchema, isBatch, (() => {
    const b = clone(sampleBatch); b.tickets[0]!.status = 'nearly'; return b
  })(), false)
  agree('a batch whose mark has no viewport', batchSchema, isBatch, (() => {
    const b = clone(sampleBatch) as { tickets: { marks: Record<string, unknown>[] }[] }
    delete b.tickets[0]!.marks[0]!.viewport
    return b
  })(), false)
  agree('a batch whose ticket lost its context', batchSchema, isBatch, (() => {
    const b = clone(sampleBatch) as { tickets: Record<string, unknown>[] }
    delete b.tickets[0]!.context
    return b
  })(), false)
  agree('a batch of another version', batchSchema, isBatch, { ...clone(sampleBatch), version: 2 }, false)
})

describe('the schemas and the guards say the same thing about a response', () => {
  agree('the response the guide gives', responseSchema, isResponse, sampleResponse, true)
  agree('a response with an unknown ticket status', responseSchema, isResponse, (() => {
    const r = clone(sampleResponse); r.tickets[0]!.status = 'done'; return r
  })(), false)
  agree('a response naming no batch', responseSchema, isResponse, (() => {
    const r = clone(sampleResponse) as Record<string, unknown>; delete r.batchId; return r
  })(), false)
  agree('a response with no result revision', responseSchema, isResponse, { ...clone(sampleResponse), resultRevision: '' }, false)

  it('a ticket outside its batch is well formed, and refused where the batch is beside it', () => {
    const stray = clone(sampleResponse)
    stray.tickets[0]!.id = 'a-ticket-from-somewhere-else'
    // Both the schema and the guard take it: neither has the batch to compare it against.
    expect(accepts(responseSchema, stray)).toBe(true)
    expect(guardAccepts(isResponse, stray)).toBe(true)
    expect(responseSchema.description).toContain('belong to it')
    // The workspace as it stands once the agent has applied the batch and moved the revision on,
    // which is the only state in which the answer is read at all.
    const applied = parseManifest({ ...exampleManifest, revision: stray.resultRevision })
    const session = new WebSession(parseManifest(exampleManifest))
    session.replaceSource(applied, sampleBatch.values)
    expect(session.response(asResponse(stray), asBatch(sampleBatch))).toBe('This response names a ticket outside its feedback batch.')
    // And the same answer, with a ticket that does belong to the batch, is applied.
    expect(session.response(asResponse(sampleResponse), asBatch(sampleBatch))).toBeNull()
  })
})
