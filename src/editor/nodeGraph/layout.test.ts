import { describe, expect, it } from 'vitest'
import {
  autoLayout, boxesOverlap, cablePath, graphBounds, nodeBox, nodeHeight, portPoint, portRow, snapped,
} from '@/editor/nodeGraph/layout'
import { createsCycle, replaceNodeInputConnection } from '@/editor/nodeGraph/connections'
import { HEADER_HEIGHT, NODE_WIDTH, ROW_HEIGHT, type GraphNode, type NodeGraph, type NodeTypeInfo } from '@/editor/nodeGraph/types'

/**
 * The arithmetic a node editor is made of. It is worth testing on its own because it is what makes
 * the drawing right *before* the browser has laid anything out: a cable's ends are computed from a
 * port's index, and a wrong index is a wire that ends in the middle of a card.
 */

const info = (patch: Partial<NodeTypeInfo> = {}): NodeTypeInfo => ({
  type: 'test',
  label: 'Test',
  category: 'Input',
  inputs: [{ id: 'a', label: 'A', tone: 'scalar' }, { id: 'b', label: 'B', tone: 'color' }],
  outputs: [{ id: 'out', label: 'Out', tone: 'shader' }],
  widgets: 1,
  ...patch,
})

const node = (patch: Partial<GraphNode> = {}): GraphNode => ({ id: 'n', type: 'test', x: 100, y: 50, ...patch })

describe('a node’s size', () => {
  it('is its header plus a row for every output, field and input', () => {
    expect(nodeHeight(info())).toBe(HEADER_HEIGHT + 4 * ROW_HEIGHT + 8)
  })

  it('is its header alone when it is folded', () => {
    expect(nodeHeight(info(), node({ collapsed: true }))).toBe(HEADER_HEIGHT)
  })
})

describe('where a port is', () => {
  it('puts the outputs first, then the fields, then the inputs', () => {
    expect(portRow(info(), 'out', 'out')).toBe(0)
    expect(portRow(info(), 'in', 'a')).toBe(2)
    expect(portRow(info(), 'in', 'b')).toBe(3)
  })

  it('hangs an output off the right edge and an input off the left', () => {
    expect(portPoint(node(), info(), 'out', 'out').x).toBe(100 + NODE_WIDTH)
    expect(portPoint(node(), info(), 'in', 'a').x).toBe(100)
  })

  it('walks down the rows', () => {
    const first = portPoint(node(), info(), 'in', 'a').y
    const second = portPoint(node(), info(), 'in', 'b').y
    expect(second - first).toBe(ROW_HEIGHT)
  })

  it('gathers every port onto the title bar of a folded node', () => {
    const folded = node({ collapsed: true })
    expect(portPoint(folded, info(), 'in', 'a').y).toBe(portPoint(folded, info(), 'out', 'out').y)
  })

  it('says the header when the port is one the node has not got', () => {
    expect(portPoint(node(), info(), 'in', 'nope').y).toBe(50 + HEADER_HEIGHT / 2)
  })
})

describe('a cable', () => {
  it('leaves and arrives horizontally, however close the two ends are', () => {
    const path = cablePath({ x: 0, y: 0 }, { x: 4, y: 0 })
    expect(path).toContain('C 40 0, -36 0')
  })

  it('reaches further as the gap grows', () => {
    expect(cablePath({ x: 0, y: 0 }, { x: 400, y: 0 })).toContain('C 200 0, 200 0')
  })
})

describe('boxes', () => {
  it('knows a touch from a miss', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    expect(boxesOverlap(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true)
    expect(boxesOverlap(a, { x: 20, y: 0, width: 10, height: 10 })).toBe(false)
  })

  it('measures a node’s own', () => {
    expect(nodeBox(node(), info())).toEqual({ x: 100, y: 50, width: NODE_WIDTH, height: nodeHeight(info()) })
  })
})

describe('the graph’s bounds', () => {
  const graph: NodeGraph = {
    nodes: [node({ id: 'a', x: 0, y: 0 }), node({ id: 'b', x: 400, y: 200 })],
    edges: [],
    frames: [],
  }

  it('covers every node', () => {
    const bounds = graphBounds(graph, () => info())
    expect(bounds.x).toBe(0)
    expect(bounds.width).toBe(400 + NODE_WIDTH)
  })

  it('answers with something drawable for an empty graph', () => {
    expect(graphBounds({ nodes: [], edges: [], frames: [] }, () => info())).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})

describe('snapping', () => {
  it('rounds to the step, and does nothing at nought', () => {
    expect(snapped(23, 20)).toBe(20)
    expect(snapped(31, 20)).toBe(40)
    expect(snapped(23, 0)).toBe(23)
  })
})

describe('the automatic layout', () => {
  it('puts a node one column past whatever feeds it', () => {
    const graph: NodeGraph = {
      nodes: [node({ id: 'a', x: 900, y: 0 }), node({ id: 'b', x: 0, y: 0 }), node({ id: 'c', x: 300, y: 0 })],
      edges: [
        { id: '1', fromNode: 'a', fromPort: 'out', toNode: 'b', toPort: 'a', tone: 'scalar' },
        { id: '2', fromNode: 'b', fromPort: 'out', toNode: 'c', toPort: 'a', tone: 'scalar' },
      ],
      frames: [],
    }
    const laid = autoLayout(graph, () => info())
    const at = (id: string) => laid.find((entry) => entry.id === id)!
    expect(at('a').x).toBe(0)
    expect(at('b').x).toBe(NODE_WIDTH + 80)
    expect(at('c').x).toBe((NODE_WIDTH + 80) * 2)
  })

  it('stacks a column without overlapping it', () => {
    const graph: NodeGraph = {
      nodes: [node({ id: 'a', x: 0, y: 100 }), node({ id: 'b', x: 0, y: 0 })],
      edges: [],
      frames: [],
    }
    const laid = autoLayout(graph, () => info())
    const at = (id: string) => laid.find((entry) => entry.id === id)!
    // The one that was higher up stays higher up: a person's own order survives what it can.
    expect(at('b').y).toBe(0)
    expect(at('a').y).toBe(nodeHeight(info()) + 30)
  })

  it('does not hang on a graph that loops', () => {
    const graph: NodeGraph = {
      nodes: [node({ id: 'a' }), node({ id: 'b' })],
      edges: [
        { id: '1', fromNode: 'a', fromPort: 'out', toNode: 'b', toPort: 'a', tone: 'scalar' },
        { id: '2', fromNode: 'b', fromPort: 'out', toNode: 'a', toPort: 'a', tone: 'scalar' },
      ],
      frames: [],
    }
    expect(autoLayout(graph, () => info())).toHaveLength(2)
  })
})

describe('connecting', () => {
  const edges = [{ id: '1', fromNode: 'a', fromPort: 'out', toNode: 'b', toPort: 'in' }]

  it('replaces the cable already in an input rather than joining it', () => {
    const outcome = replaceNodeInputConnection(edges, { id: '2', fromNode: 'c', fromPort: 'out', toNode: 'b', toPort: 'in' })
    expect(outcome.ok).toBe(true)
    expect(outcome.edges).toHaveLength(1)
    expect(outcome.edges[0]!.fromNode).toBe('c')
  })

  it('leaves a second cable to another input alone', () => {
    const outcome = replaceNodeInputConnection(edges, { id: '2', fromNode: 'c', fromPort: 'out', toNode: 'b', toPort: 'other' })
    expect(outcome.edges).toHaveLength(2)
  })

  it('refuses a node feeding itself', () => {
    const outcome = replaceNodeInputConnection(edges, { id: '2', fromNode: 'b', fromPort: 'out', toNode: 'b', toPort: 'in' })
    expect(outcome).toMatchObject({ ok: false, reason: 'self' })
  })

  it('refuses a loop, and says so rather than making one', () => {
    const outcome = replaceNodeInputConnection(edges, { id: '2', fromNode: 'b', fromPort: 'out', toNode: 'a', toPort: 'in' })
    expect(outcome).toMatchObject({ ok: false, reason: 'cycle' })
    expect(outcome.edges).toEqual(edges)
  })

  it('says nothing changed when the same cable is made again', () => {
    const outcome = replaceNodeInputConnection(edges, { ...edges[0]! })
    expect(outcome).toMatchObject({ ok: true, changed: false })
  })

  it('finds a loop through a chain, not only a direct one', () => {
    const chain = [
      { id: '1', fromNode: 'a', fromPort: 'o', toNode: 'b', toPort: 'i' },
      { id: '2', fromNode: 'b', fromPort: 'o', toNode: 'c', toPort: 'i' },
    ]
    expect(createsCycle(chain, 'c', 'a')).toBe(true)
    expect(createsCycle(chain, 'a', 'c')).toBe(false)
  })
})
