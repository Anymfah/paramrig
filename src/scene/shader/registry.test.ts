import { describe, expect, it } from 'vitest'
import {
  SHADER_CATEGORIES, compilerNodeTypes, defaultShaderSettings, registerShaderNodeType,
  shaderNodeType, shaderNodeTypes,
} from '@/scene/shader/registry'
import { MATERIAL_GRAPH_PORTS_BY_TYPE } from '@/scene/shader/prismorphic/material-graph'

/**
 * The registry is the one place the editor asks what a node is, so what is worth asserting is that
 * it agrees with the compiler: every type the compiler knows has an entry, every entry's sockets
 * are the compiler's own, and every widget writes a setting the node actually declares a default
 * for. A registry that disagreed would draw a socket that compiles to nothing.
 */

describe('the shader node registry', () => {
  it('has an entry for every type the compiler knows', () => {
    const known = new Set(shaderNodeTypes().map((entry) => entry.type))
    const missing = compilerNodeTypes().filter((type) => !known.has(type))
    expect(missing).toEqual([])
  })

  it('takes its sockets from the compiler rather than inventing them', () => {
    for (const entry of shaderNodeTypes()) {
      const ports = MATERIAL_GRAPH_PORTS_BY_TYPE[entry.type]
      expect(entry.inputs.map((port) => port.id), entry.type).toEqual(ports.inputs.map((port) => port.id))
      expect(entry.outputs.map((port) => port.id), entry.type).toEqual(ports.outputs.map((port) => port.id))
    }
  })

  it('puts every node in one of Blender’s menus', () => {
    for (const entry of shaderNodeTypes()) expect(SHADER_CATEGORIES, entry.type).toContain(entry.category)
  })

  it('gives a default for every setting a widget writes', () => {
    for (const entry of shaderNodeTypes()) {
      for (const widget of entry.widgets) {
        const settings = widget.kind === 'vector' ? widget.settings : [widget.setting]
        for (const setting of settings) {
          expect(Object.hasOwn(entry.defaults, setting), `${entry.type} · ${String(setting)}`).toBe(true)
        }
      }
    }
  })

  it('names the shaders the way Blender does, where they mean the same thing', () => {
    expect(shaderNodeType('pbr-surface')?.label).toBe('Principled BSDF')
    expect(shaderNodeType('color-ramp')?.label).toBe('Color Ramp')
    expect(shaderNodeType('mix')?.label).toBe('Mix Color')
    // And keeps Prismorphic's own where nothing in Blender is that node.
    expect(shaderNodeType('prism-dispersion')?.label).toBe('Prism Dispersion')
  })

  it('hands back a copy of the defaults, so a node cannot write into the table', () => {
    const first = defaultShaderSettings('value')
    first.scalarValue = 99
    expect(defaultShaderSettings('value').scalarValue).toBe(0.5)
  })

  it('takes a node it has never heard of', () => {
    registerShaderNodeType({
      type: 'value',
      label: 'Borrowed',
      category: 'Input',
      inputs: [],
      outputs: [{ id: 'value', label: 'Value', tone: 'scalar' }],
      defaults: { scalarValue: 1 },
      widgets: [],
    })
    expect(shaderNodeType('value')?.label).toBe('Borrowed')
    // Put back, or every test after this one would be looking at the borrowed entry.
    registerShaderNodeType({
      type: 'value',
      label: 'Value',
      category: 'Input',
      inputs: [],
      outputs: [{ id: 'value', label: 'Value', tone: 'scalar' }],
      defaults: { scalarValue: 0.5 },
      widgets: [{ kind: 'number', setting: 'scalarValue', label: 'Value', min: -100, max: 100, step: 0.01 }],
    })
  })

  it('says nothing about a type nobody registered', () => {
    expect(shaderNodeType('not-a-node')).toBeNull()
  })
})
