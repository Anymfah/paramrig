import { describe, expect, it } from 'vitest'
import { DEFAULT_MATERIAL } from '@/scene/document'
import { compileMaterialGraphGlsl } from '@/scene/shader/prismorphic/material-graph-glsl'
import { principledFromGraph, principledGraph, sanitizeSceneGraph, shaderEdge, shaderNode } from '@/scene/shader/material'
import type { Material } from '@/scene/types'

/**
 * Turning nodes on must give back exactly the surface that was there, and turning them off must
 * give back exactly the numbers the graph really said. Both directions are asserted here, and so is
 * the one that matters most: that the graph a conversion makes actually compiles.
 */

function material(patch: Partial<Material> = {}): Material {
  return { ...DEFAULT_MATERIAL, id: 'material-1', ...patch }
}

describe('the Principled as a graph', () => {
  it('puts every field on a node and every node into the surface', () => {
    const graph = principledGraph(material({ baseColor: '#ff8800', metallic: 0.25, roughness: 0.8, alpha: 0.5 }))
    expect(graph.nodes.map((node) => node.type)).toEqual([
      'base-color', 'metallic', 'roughness', 'emission', 'opacity', 'pbr-surface', 'material-output',
    ])
    expect(graph.edges).toHaveLength(6)
    expect(graph.nodes[0]!.settings?.rgbColor).toBe('#ff8800')
    expect(graph.nodes[1]!.settings?.scalarValue).toBe(0.25)
  })

  it('comes back to the same numbers', () => {
    const source = material({ baseColor: '#123456', emission: '#00ff00', metallic: 0.4, roughness: 0.15, alpha: 0.75 })
    const read = principledFromGraph(principledGraph(source))
    expect(read).toEqual({
      baseColor: '#123456',
      emission: '#00ff00',
      metallic: 0.4,
      roughness: 0.15,
      alpha: 0.75,
    })
  })

  it('says nothing about a field the graph computes rather than states', () => {
    const graph = principledGraph(material())
    // A noise texture into the roughness: there is no number to put in the field, so none is given.
    graph.nodes.push(shaderNode('noise', 'noise-texture', -900, 60))
    graph.edges = graph.edges.filter((edge) => edge.toPort !== 'roughness')
    graph.edges.push(shaderEdge('noise', 'factor', 'pbr-surface', 'roughness'))
    const read = principledFromGraph(graph)
    expect(Object.hasOwn(read, 'roughness')).toBe(false)
    expect(read.baseColor).toBe(DEFAULT_MATERIAL.baseColor)
  })

  it('says nothing at all about a graph with no surface in it', () => {
    expect(principledFromGraph({ version: 2, nodes: [], edges: [], frames: [] })).toEqual({})
  })
})

describe('compiling what the conversion makes', () => {
  it('compiles the Principled graph into a programme', () => {
    const compiled = compileMaterialGraphGlsl(principledGraph(material()))
    expect(compiled.surfaceMode).toBe('physical')
    expect(compiled.evaluateFunctionSource).toContain('prismorphic_evaluate_graph')
    expect(compiled.reachableNodeIds).toContain('pbr-surface')
    expect(compiled.budgetReport.reachableNodeCount).toBeLessThanOrEqual(compiled.budgetReport.maxReachableNodesTotal)
  })

  it('binds the settings a person can scrub as uniforms, so a change needs no recompile', () => {
    const compiled = compileMaterialGraphGlsl(principledGraph(material({ metallic: 0.25 })))
    const bound = compiled.uniforms.find((entry) => entry.nodeId === 'metallic')
    expect(bound?.value).toBe(0.25)
  })

  it('compiles a graph with a texture in it', () => {
    const graph = principledGraph(material())
    graph.nodes.push(shaderNode('noise', 'noise-texture', -900, 60))
    graph.edges = graph.edges.filter((edge) => edge.toPort !== 'roughness')
    graph.edges.push(shaderEdge('noise', 'factor', 'pbr-surface', 'roughness'))
    const compiled = compileMaterialGraphGlsl(graph)
    expect(compiled.usedNodeTypes).toContain('noise-texture')
    expect(compiled.helpersSource.length).toBeGreaterThan(0)
  })
})

describe('reading a graph from a file', () => {
  it('takes one it wrote itself', () => {
    const graph = sanitizeSceneGraph(JSON.parse(JSON.stringify(principledGraph(material()))))
    expect(graph?.nodes).toHaveLength(7)
  })

  it('refuses what is not a graph', () => {
    expect(sanitizeSceneGraph(null)).toBeUndefined()
    expect(sanitizeSceneGraph({ nodes: 'no' })).toBeUndefined()
  })

  it('drops a node of a type nobody ships', () => {
    const graph = principledGraph(material()) as unknown as { nodes: unknown[] }
    graph.nodes.push({ id: 'x', type: 'not-a-node', x: 0, y: 0 })
    expect(sanitizeSceneGraph(graph)?.nodes).toHaveLength(7)
  })
})
