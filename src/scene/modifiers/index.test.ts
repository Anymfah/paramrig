import { describe, expect, it } from 'vitest'
import { initializeBuiltinModifiers, listModifiers, modifierCount } from '@/scene/modifiers'
import { MODIFIER_KINDS } from '@/scene/types'

/**
 * The registry is what the Add menu, the panel and the stack all read, so what matters is that
 * explicit, repeated initialization puts every kind the document can hold into it: a modifier that exists in the
 * source and not in this list is one a saved file can name and the editor cannot draw.
 */
describe('the modifier registry', () => {
  initializeBuiltinModifiers()
  initializeBuiltinModifiers()
  it('has a module for every kind a document can name', () => {
    const registered = new Set(listModifiers().map((module) => module.kind))
    expect([...MODIFIER_KINDS].filter((kind) => !registered.has(kind))).toEqual([])
    expect(modifierCount()).toBe(MODIFIER_KINDS.length)
  })

  it('gives each one a label, a category, a sentence and defaults its schema covers', () => {
    for (const module of listModifiers()) {
      expect(module.label, module.kind).not.toBe('')
      expect(['modify', 'generate', 'deform']).toContain(module.category)
      expect(module.description.endsWith('.'), `${module.kind}: ${module.description}`).toBe(true)
      for (const param of module.schema) {
        expect(Object.keys(module.defaults), `${module.kind}.${param.id}`).toContain(param.id)
      }
    }
  })

  it('names each object input as a parameter of its own schema', () => {
    for (const module of listModifiers()) {
      for (const name of module.objectInputs ?? []) {
        expect(module.schema.map((param) => param.id), module.kind).toContain(name)
      }
    }
  })
})
