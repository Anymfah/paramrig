import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { NodeGraphEditor } from '@/editor/nodeGraph/NodeGraphEditor'
import { EMPTY_SELECTION, type NodeGraph, type NodeGraphSelection, type NodeTypeInfo } from '@/editor/nodeGraph/types'

/**
 * The editor is controlled: every gesture answers with a new graph and a label, and the parent
 * decides what to do with it. So the tests drive it through a parent that keeps the graph, which is
 * also how the shader editor uses it — and what is asserted is the behaviour a person sees, not the
 * shape of the callbacks.
 */

const REGISTRY: NodeTypeInfo[] = [
  {
    type: 'value',
    label: 'Value',
    category: 'Input',
    inputs: [],
    outputs: [{ id: 'value', label: 'Value', tone: 'scalar' }],
    widgets: 0,
    description: 'One number.',
  },
  {
    type: 'math',
    label: 'Math',
    category: 'Converter',
    inputs: [{ id: 'a', label: 'A', tone: 'scalar' }, { id: 'b', label: 'B', tone: 'scalar' }],
    outputs: [{ id: 'value', label: 'Value', tone: 'scalar' }],
    widgets: 1,
  },
  {
    type: 'output',
    label: 'Material Output',
    category: 'Output',
    inputs: [{ id: 'surface', label: 'Surface', tone: 'shader' }],
    outputs: [],
    widgets: 0,
  },
]

function Harness({ start, onGraph }: { start: NodeGraph; onGraph?: (graph: NodeGraph, label: string) => void }) {
  const [graph, setGraph] = useState(start)
  const [selection, setSelection] = useState<NodeGraphSelection>(EMPTY_SELECTION)
  return (
    <NodeGraphEditor
      graph={graph}
      onChange={(next, label) => {
        setGraph(next)
        onGraph?.(next, label)
      }}
      registry={REGISTRY}
      selection={selection}
      onSelectionChange={setSelection}
      protectedNodes={['out']}
      renderWidget={() => <span>field</span>}
    />
  )
}

const graph = (): NodeGraph => ({
  nodes: [
    { id: 'a', type: 'value', x: 0, y: 0 },
    { id: 'm', type: 'math', x: 300, y: 0 },
    { id: 'out', type: 'output', x: 600, y: 0 },
  ],
  edges: [],
  frames: [],
})

describe('connecting with the keyboard', () => {
  it('joins two sockets with Enter and Enter', async () => {
    const onGraph = vi.fn()
    render(<Harness start={graph()} onGraph={onGraph} />)
    fireEvent.keyDown(screen.getAllByLabelText('Value, output')[0]!, { key: 'Enter' })
    fireEvent.keyDown(screen.getByLabelText('A, input'), { key: 'Enter' })
    expect(onGraph).toHaveBeenCalledWith(
      expect.objectContaining({ edges: [expect.objectContaining({ fromNode: 'a', toNode: 'm', toPort: 'a' })] }),
      'Connect',
    )
  })

  it('refuses two sockets that do not carry the same thing, and says so', async () => {
    const onMessage = vi.fn()
    render(
      <NodeGraphEditor
        graph={graph()}
        onChange={() => {}}
        registry={REGISTRY}
        selection={EMPTY_SELECTION}
        onSelectionChange={() => {}}
        onMessage={onMessage}
      />,
    )
    fireEvent.keyDown(screen.getAllByLabelText('Value, output')[0]!, { key: 'Enter' })
    fireEvent.keyDown(screen.getByLabelText('Surface, input'), { key: 'Enter' })
    expect(onMessage).toHaveBeenCalledWith('Those two sockets do not carry the same thing.')
  })

  it('refuses a loop rather than making one', async () => {
    const onMessage = vi.fn()
    const looping: NodeGraph = {
      nodes: [{ id: 'a', type: 'math', x: 0, y: 0 }, { id: 'b', type: 'math', x: 300, y: 0 }],
      edges: [{ id: '1', fromNode: 'a', fromPort: 'value', toNode: 'b', toPort: 'a', tone: 'scalar' }],
      frames: [],
    }
    render(
      <NodeGraphEditor
        graph={looping}
        onChange={() => {}}
        registry={REGISTRY}
        selection={EMPTY_SELECTION}
        onSelectionChange={() => {}}
        onMessage={onMessage}
      />,
    )
    const outputs = screen.getAllByLabelText('Value, output')
    fireEvent.keyDown(outputs[1]!, { key: 'Enter' })
    fireEvent.keyDown(screen.getAllByLabelText('A, input')[0]!, { key: 'Enter' })
    expect(onMessage).toHaveBeenCalledWith('That would make a loop, and a loop has no answer.')
  })

  it('lights the sockets a waiting one would fit', async () => {
    render(<Harness start={graph()} />)
    fireEvent.keyDown(screen.getAllByLabelText('Value, output')[0]!, { key: 'Enter' })
    expect(screen.getByLabelText('A, input')).toHaveAttribute('data-compatible')
    expect(screen.getByLabelText('Surface, input')).not.toHaveAttribute('data-compatible')
  })
})

describe('the palette', () => {
  it('opens on ⇧A, filters as you type, and adds what you choose', async () => {
    const onGraph = vi.fn()
    const { container } = render(<Harness start={graph()} onGraph={onGraph} />)
    const surface = container.querySelector('.graph') as HTMLElement
    surface.focus()
    fireEvent.keyDown(surface, { key: 'A', shiftKey: true })
    const palette = await screen.findByRole('dialog', { name: 'Add node' })
    await userEvent.type(within(palette).getByLabelText('Filter nodes'), 'output')
    const entries = within(palette).getAllByRole('button')
    expect(entries).toHaveLength(1)
    await userEvent.click(entries[0]!)
    expect(onGraph).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: expect.arrayContaining([expect.objectContaining({ type: 'output' })]) }),
      'Add node',
    )
  })

  it('says so rather than showing nothing when the filter matches nothing', async () => {
    const { container } = render(<Harness start={graph()} />)
    const surface = container.querySelector('.graph') as HTMLElement
    surface.focus()
    fireEvent.keyDown(surface, { key: '/' })
    const palette = await screen.findByRole('dialog', { name: 'Add node' })
    await userEvent.type(within(palette).getByLabelText('Filter nodes'), 'zzz')
    expect(within(palette).getByText('Nothing by that name.')).toBeInTheDocument()
  })
})

describe('the selection', () => {
  it('takes a node on a click and the lot on ⌘A', async () => {
    const { container } = render(<Harness start={graph()} />)
    const surface = container.querySelector('.graph') as HTMLElement
    const card = container.querySelector('[data-node="a"] .graph-node__header') as HTMLElement
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(surface, { button: 0 })
    expect(container.querySelector('[data-node="a"]')).toHaveAttribute('data-selected')
    surface.focus()
    fireEvent.keyDown(surface, { key: 'a', metaKey: true })
    expect(container.querySelectorAll('[data-selected]')).toHaveLength(3)
  })

  it('deletes what is selected, and keeps what is protected', async () => {
    const onGraph = vi.fn()
    const { container } = render(<Harness start={graph()} onGraph={onGraph} />)
    const surface = container.querySelector('.graph') as HTMLElement
    surface.focus()
    fireEvent.keyDown(surface, { key: 'a', metaKey: true })
    fireEvent.keyDown(surface, { key: 'Delete' })
    const [next] = onGraph.mock.calls.at(-1) ?? []
    expect((next as NodeGraph).nodes.map((node) => node.id)).toEqual(['out'])
  })

  it('duplicates on ⌘D, and the copy is not on top of the original', async () => {
    const onGraph = vi.fn()
    const { container } = render(<Harness start={graph()} onGraph={onGraph} />)
    const surface = container.querySelector('.graph') as HTMLElement
    const card = container.querySelector('[data-node="a"] .graph-node__header') as HTMLElement
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(surface, { button: 0 })
    surface.focus()
    fireEvent.keyDown(surface, { key: 'd', metaKey: true })
    const [next] = onGraph.mock.calls.at(-1) ?? []
    const nodes = (next as NodeGraph).nodes
    expect(nodes).toHaveLength(4)
    expect(nodes[3]!.x).not.toBe(nodes[0]!.x)
  })
})

describe('folding', () => {
  it('hides a node’s rows on a double click of its header, and shows them again', async () => {
    const { container } = render(<Harness start={graph()} />)
    const header = container.querySelector('[data-node="m"] .graph-node__header') as HTMLElement
    expect(container.querySelector('[data-node="m"] .graph-node__body')).not.toBeNull()
    fireEvent.doubleClick(header)
    expect(container.querySelector('[data-node="m"] .graph-node__body')).toBeNull()
    fireEvent.doubleClick(container.querySelector('[data-node="m"] .graph-node__header') as HTMLElement)
    expect(container.querySelector('[data-node="m"] .graph-node__body')).not.toBeNull()
  })
})

describe('laying out', () => {
  it('puts the graph in columns on ⇧L', () => {
    const onGraph = vi.fn()
    const start: NodeGraph = {
      nodes: [{ id: 'a', type: 'value', x: 900, y: 0 }, { id: 'm', type: 'math', x: 0, y: 0 }],
      edges: [{ id: '1', fromNode: 'a', fromPort: 'value', toNode: 'm', toPort: 'a', tone: 'scalar' }],
      frames: [],
    }
    const { container } = render(<Harness start={start} onGraph={onGraph} />)
    const surface = container.querySelector('.graph') as HTMLElement
    surface.focus()
    fireEvent.keyDown(surface, { key: 'L', shiftKey: true })
    const [next] = onGraph.mock.calls.at(-1) ?? []
    const nodes = (next as NodeGraph).nodes
    expect(nodes.find((node) => node.id === 'a')!.x).toBeLessThan(nodes.find((node) => node.id === 'm')!.x)
  })
})

describe('the cables', () => {
  it('draws one path a cable, in the socket’s own colour', () => {
    const start: NodeGraph = {
      nodes: [{ id: 'a', type: 'value', x: 0, y: 0 }, { id: 'm', type: 'math', x: 300, y: 0 }],
      edges: [{ id: '1', fromNode: 'a', fromPort: 'value', toNode: 'm', toPort: 'a', tone: 'scalar' }],
      frames: [],
    }
    const { container } = render(<Harness start={start} />)
    const cables = container.querySelectorAll('.graph__cable')
    expect(cables).toHaveLength(1)
    expect(cables[0]).toHaveAttribute('data-tone', 'scalar')
    // Computed rather than measured: the path is there in the first render, before any layout.
    expect(cables[0]?.getAttribute('d')).toMatch(/^M 220 /)
  })

  it('draws nothing for a cable whose node is gone', () => {
    const start: NodeGraph = {
      nodes: [{ id: 'a', type: 'value', x: 0, y: 0 }],
      edges: [{ id: '1', fromNode: 'a', fromPort: 'value', toNode: 'ghost', toPort: 'a', tone: 'scalar' }],
      frames: [],
    }
    const { container } = render(<Harness start={start} />)
    expect(container.querySelectorAll('.graph__cable')).toHaveLength(0)
  })
})
