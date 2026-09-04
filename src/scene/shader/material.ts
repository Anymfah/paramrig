import {
  MATERIAL_GRAPH_PORTS_BY_TYPE,
  MATERIAL_GRAPH_VERSION,
  sanitizeMaterialGraph,
  type MaterialGraphDocument,
  type MaterialGraphEdge,
  type MaterialGraphNode,
  type MaterialGraphNodeSettings,
  type MaterialGraphNodeType,
} from '@/scene/shader/prismorphic/material-graph'
import { defaultShaderSettings } from '@/scene/shader/registry'
import type { Material } from '@/scene/types'

/**
 * Where the scene's material and the graph meet.
 *
 * A material here is a Principled: a handful of numbers and colours. Turning nodes on has to give
 * back exactly what those numbers said, or the switch would be a change of appearance dressed up as
 * a change of representation — so the conversion is a real one both ways, and the graph it makes is
 * the graph a person would have drawn by hand.
 *
 * Turning nodes off keeps the graph. Blender does the same, and it is the only kind way to treat
 * somebody who wants to see what the surface looked like before.
 */

/** The scene's materials are read as `procedural`, which is the kind that allows every node type. */
const KIND = 'procedural' as const

export function shaderNode(
  id: string,
  type: MaterialGraphNodeType,
  x: number,
  y: number,
  settings?: Partial<MaterialGraphNodeSettings>,
): MaterialGraphNode {
  const ports = MATERIAL_GRAPH_PORTS_BY_TYPE[type]
  return {
    id,
    type,
    x,
    y,
    inputs: ports.inputs.map((port) => ({ ...port })),
    outputs: ports.outputs.map((port) => ({ ...port })),
    settings: { ...defaultShaderSettings(type), ...settings } as MaterialGraphNodeSettings,
  }
}

export function shaderEdge(fromNode: string, fromPort: string, toNode: string, toPort: string): MaterialGraphEdge {
  const from = MATERIAL_GRAPH_PORTS_BY_TYPE[nodeTypeOf(fromNode)]
  const tone = from?.outputs.find((port) => port.id === fromPort)?.tone ?? 'scalar'
  return { id: `${fromNode}:${fromPort}>${toNode}:${toPort}`, fromNode, fromPort, toNode, toPort, tone }
}

/*
 * The edges of a graph this module builds name nodes it has just made, so the tone can be read from
 * the type the id carries. Anything else builds its edges through the editor, which knows both.
 */
function nodeTypeOf(id: string): MaterialGraphNodeType {
  const found = ['base-color', 'metallic', 'roughness', 'emission', 'opacity', 'pbr-surface'].find((type) => id === type)
  return (found ?? 'value') as MaterialGraphNodeType
}

/**
 * The Principled as a graph: one node per field, all of them into a surface, the surface out.
 *
 * The positions are Blender's own layout — inputs on the left in the order the panel lists them,
 * the shader in the middle, the output on the right — because a graph a person did not draw should
 * still look like one they might have.
 */
export function principledGraph(material: Material): MaterialGraphDocument {
  const nodes: MaterialGraphNode[] = [
    shaderNode('base-color', 'base-color', -520, -160, { rgbColor: material.baseColor }),
    shaderNode('metallic', 'metallic', -520, -40, { scalarValue: material.metallic }),
    shaderNode('roughness', 'roughness', -520, 60, { scalarValue: material.roughness }),
    shaderNode('emission', 'emission', -520, 160, { rgbColor: material.emission }),
    shaderNode('opacity', 'opacity', -520, 260, { scalarValue: material.alpha }),
    shaderNode('pbr-surface', 'pbr-surface', -120, 0),
    shaderNode('material-output', 'material-output', 200, 40, {
      outputEnabled: true,
      // The copy's own three: a clipped material has no separate mode there, and reads as opaque.
      outputBlend: material.blendMode === 'blend' ? 'Alpha blend' : 'Opaque',
    }),
  ]
  const edges: MaterialGraphEdge[] = [
    shaderEdge('base-color', 'color', 'pbr-surface', 'baseColor'),
    shaderEdge('metallic', 'value', 'pbr-surface', 'metallic'),
    shaderEdge('roughness', 'value', 'pbr-surface', 'roughness'),
    shaderEdge('emission', 'color', 'pbr-surface', 'emission'),
    shaderEdge('opacity', 'value', 'pbr-surface', 'opacity'),
    shaderEdge('pbr-surface', 'shader', 'material-output', 'surface'),
  ]
  return { version: MATERIAL_GRAPH_VERSION, nodes, edges, frames: [] }
}

/**
 * The graph read back into the Principled's fields, as far as it goes.
 *
 * Only the simple case answers: a graph whose surface is fed by constants is exactly a Principled,
 * and one whose base colour comes out of a noise texture is not — there is no number to put in the
 * field. So it answers with what it can read and leaves the rest, which is what turning nodes off
 * has to do: the fields a person sees afterwards are the ones the graph really said.
 */
export function principledFromGraph(graph: MaterialGraphDocument): Partial<Material> {
  const surface = graph.nodes.find((node) => node.type === 'pbr-surface' || node.type === 'unlit-surface')
  if (!surface) return {}
  const feeding = (port: string): MaterialGraphNode | null => {
    const edge = graph.edges.find((entry) => entry.toNode === surface.id && entry.toPort === port)
    return edge ? graph.nodes.find((node) => node.id === edge.fromNode) ?? null : null
  }
  const colourOf = (port: string): string | null => {
    const node = feeding(port)
    if (!node || (node.type !== 'rgb' && node.type !== 'base-color' && node.type !== 'emission')) return null
    return typeof node.settings?.rgbColor === 'string' ? node.settings.rgbColor : null
  }
  const numberOf = (port: string): number | null => {
    const node = feeding(port)
    if (!node || (node.type !== 'value' && node.type !== 'metallic' && node.type !== 'roughness' && node.type !== 'opacity')) return null
    return typeof node.settings?.scalarValue === 'number' ? node.settings.scalarValue : null
  }
  const baseColor = colourOf('baseColor')
  const emission = colourOf('emission')
  const metallic = numberOf('metallic')
  const roughness = numberOf('roughness')
  const alpha = numberOf('opacity')
  return {
    ...(baseColor === null ? {} : { baseColor }),
    ...(emission === null ? {} : { emission }),
    ...(metallic === null ? {} : { metallic }),
    ...(roughness === null ? {} : { roughness }),
    ...(alpha === null ? {} : { alpha }),
  }
}

/** A graph read from a file, through the copy's own reader, or nothing when it is not one. */
export function sanitizeSceneGraph(value: unknown): MaterialGraphDocument | undefined {
  const graph = sanitizeMaterialGraph(value, KIND)
  return graph ?? undefined
}
