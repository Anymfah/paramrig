import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { replaceNodeInputConnection } from '@/editor/nodeGraph/connections'
import {
  autoLayout, boxesOverlap, cablePath, graphBounds, nodeBox, nodeHeight, portPoint, snapped,
} from '@/editor/nodeGraph/layout'
import { NodeGraphPalette } from '@/editor/nodeGraph/NodeGraphPalette'
import {
  EMPTY_SELECTION, GRID_STEP, HEADER_HEIGHT, NODE_WIDTH, PORT_TARGET, ROW_HEIGHT,
  type GraphEdge, type GraphNode, type NodeGraph, type NodeGraphSelection, type NodeSocket,
  type NodeSocketTone, type NodeTypeInfo,
} from '@/editor/nodeGraph/types'
import { Tooltip } from '@/ui/Tooltip'

/**
 * A node graph, edited.
 *
 * It knows nodes, ports, cables and frames, and nothing at all about what they mean: the kinds come
 * from a registry the caller passes in, and the fields on a node are drawn by a `renderWidget` the
 * caller passes in. That is what makes it `src/editor/` rather than `src/scene/` — the shader
 * editor is its first caller, not its owner.
 *
 * The interaction is Prismorphic's, which is Blender's: drag from a port to connect, or press Enter
 * on one and Enter on another; one cable to an input, and the second replaces the first; a cycle is
 * refused; a cable dropped in the void opens the palette and connects what you choose. What is
 * different is underneath. Coordinates are world pixels rather than percentages, so a node keeps
 * its size when the view is zoomed. Cables are computed from a port's index rather than measured
 * out of the DOM, so a dragged node and its wires move in the same frame. And the graph is the
 * parent's: every gesture answers with a new one and a label, so the scene's own history records it.
 */

export type NodeGraphEditorProps = {
  graph: NodeGraph
  onChange: (graph: NodeGraph, label: string) => void
  registry: NodeTypeInfo[]
  selection: NodeGraphSelection
  onSelectionChange: (next: NodeGraphSelection) => void
  /** Draws one row of fields for a node; the editor reserves the rows and nothing more. */
  renderWidget?: (node: GraphNode, row: number) => ReactNode
  /** Said out loud when a gesture is refused — a cycle, a socket that does not fit. */
  onMessage?: (text: string) => void
  /** Nodes that cannot be deleted, however they are selected: the output, usually. */
  protectedNodes?: string[]
  /** Drawn on the node in the error tone, with the message as its tooltip. */
  errors?: Record<string, string>
}

type Drag =
  | { kind: 'pan'; from: [number, number]; pan: [number, number] }
  | { kind: 'nodes'; from: [number, number]; start: Map<string, [number, number]>; moved: boolean }
  | { kind: 'cable'; from: { node: string; port: string; side: 'in' | 'out'; tone: NodeSocketTone }; at: [number, number] }
  | { kind: 'box'; from: [number, number]; at: [number, number]; extend: boolean }

const MIN_ZOOM = 0.25
const MAX_ZOOM = 2.5

/** How far framing is allowed to zoom out before it stops and lets a person pan instead. */
const FRAME_FLOOR = 0.6

export function NodeGraphEditor({
  graph,
  onChange,
  registry,
  selection,
  onSelectionChange,
  renderWidget,
  onMessage,
  protectedNodes = [],
  errors = {},
}: NodeGraphEditorProps) {
  const surface = useRef<HTMLDivElement>(null)
  /*
   * The world is moved by writing its transform rather than by re-rendering.
   *
   * A pan changes nothing about the graph — not a node, not a cable, not a selection — so putting
   * it through React state would re-render five hundred cards and recompute five hundred paths to
   * move a single `translate`. On five hundred nodes that is a hundred and fifty milliseconds a
   * frame; written straight to the element it is none. The state catches up when the hand lets go,
   * so everything that reads the view still reads the truth.
   */
  const world = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<{ pan: [number, number]; zoom: number }>({ pan: [40, 40], zoom: 1 })
  const [drag, setDrag] = useState<Drag | null>(null)
  /** Where a pan has got to, while it is happening: state would be a re-render a frame. */
  const panned = useRef<[number, number] | null>(null)
  /** The port waiting for a second one, which is how a connection is made from the keyboard. */
  const [pending, setPending] = useState<{ node: string; port: string; side: 'in' | 'out'; tone: NodeSocketTone } | null>(null)
  const [palette, setPalette] = useState<{ at: [number, number]; world: [number, number]; from: Drag & { kind: 'cable' } | null } | null>(null)

  const infoOf = useCallback(
    (type: string) => registry.find((entry) => entry.type === type) ?? null,
    [registry],
  )

  /** Screen pixels to the graph's own, which is where every gesture is measured. */
  const toWorld = useCallback((clientX: number, clientY: number): [number, number] => {
    const box = surface.current?.getBoundingClientRect()
    if (!box) return [0, 0]
    return [(clientX - box.left - view.pan[0]) / view.zoom, (clientY - box.top - view.pan[1]) / view.zoom]
  }, [view])

  const selected = useMemo(() => new Set(selection.nodes), [selection.nodes])

  /* ------------------------------------------------------------ the gestures */

  const connect = useCallback((
    from: { node: string; port: string; tone: NodeSocketTone },
    to: { node: string; port: string },
  ) => {
    const edge: GraphEdge = {
      id: `${from.node}:${from.port}>${to.node}:${to.port}`,
      fromNode: from.node,
      fromPort: from.port,
      toNode: to.node,
      toPort: to.port,
      tone: from.tone,
    }
    const outcome = replaceNodeInputConnection(graph.edges, edge)
    if (!outcome.ok) {
      onMessage?.(outcome.reason === 'self'
        ? 'A node cannot feed itself.'
        : 'That would make a loop, and a loop has no answer.')
      return
    }
    if (!outcome.changed) return
    onChange({ ...graph, edges: outcome.edges }, 'Connect')
  }, [graph, onChange, onMessage])

  const addNode = useCallback((type: string, at: [number, number], from: Drag & { kind: 'cable' } | null) => {
    const info = infoOf(type)
    if (!info) return
    const id = `${type}-${Math.random().toString(36).slice(2, 8)}`
    const node: GraphNode = { id, type, x: snapped(at[0], GRID_STEP), y: snapped(at[1], GRID_STEP) }
    let edges = graph.edges
    if (from) {
      // A cable dragged into the void and answered with a node: the two are joined at once, which
      // is the whole point of the gesture — it is one movement, not "add" and then "connect".
      const socket = from.from.side === 'out'
        ? info.inputs.find((port) => port.tone === from.from.tone) ?? info.inputs[0]
        : info.outputs.find((port) => port.tone === from.from.tone) ?? info.outputs[0]
      if (socket) {
        const edge: GraphEdge = from.from.side === 'out'
          ? { id: `${from.from.node}:${from.from.port}>${id}:${socket.id}`, fromNode: from.from.node, fromPort: from.from.port, toNode: id, toPort: socket.id, tone: from.from.tone }
          : { id: `${id}:${socket.id}>${from.from.node}:${from.from.port}`, fromNode: id, fromPort: socket.id, toNode: from.from.node, toPort: from.from.port, tone: socket.tone }
        const outcome = replaceNodeInputConnection([...edges], edge)
        if (outcome.ok) edges = outcome.edges
      }
    }
    onChange({ ...graph, nodes: [...graph.nodes, node], edges }, 'Add node')
    onSelectionChange({ ...EMPTY_SELECTION, nodes: [id] })
  }, [graph, infoOf, onChange, onSelectionChange])

  const removeSelected = useCallback(() => {
    const keep = new Set(protectedNodes)
    const going = selection.nodes.filter((id) => !keep.has(id))
    if (going.length === 0 && selection.edges.length === 0) return
    if (going.length < selection.nodes.length) onMessage?.('The output stays: a graph with no output has nothing to draw.')
    const gone = new Set(going)
    onChange({
      ...graph,
      nodes: graph.nodes.filter((node) => !gone.has(node.id)),
      edges: graph.edges.filter((edge) => (
        !gone.has(edge.fromNode) && !gone.has(edge.toNode) && !selection.edges.includes(edge.id)
      )),
    }, 'Delete nodes')
    onSelectionChange(EMPTY_SELECTION)
  }, [graph, onChange, onMessage, onSelectionChange, protectedNodes, selection])

  const duplicateSelected = useCallback(() => {
    if (selection.nodes.length === 0) return
    const made = new Map<string, string>()
    const copies = graph.nodes
      .filter((node) => selected.has(node.id))
      .map((node) => {
        const id = `${node.type}-${Math.random().toString(36).slice(2, 8)}`
        made.set(node.id, id)
        return { ...node, id, x: node.x + GRID_STEP * 2, y: node.y + GRID_STEP * 2 }
      })
    // Only the cables *between* the copied nodes come along: a copy that kept its inputs would
    // steal them, because an input takes one cable.
    const inside = graph.edges
      .filter((edge) => made.has(edge.fromNode) && made.has(edge.toNode))
      .map((edge) => ({
        ...edge,
        id: `${made.get(edge.fromNode)}:${edge.fromPort}>${made.get(edge.toNode)}:${edge.toPort}`,
        fromNode: made.get(edge.fromNode)!,
        toNode: made.get(edge.toNode)!,
      }))
    onChange({ ...graph, nodes: [...graph.nodes, ...copies], edges: [...graph.edges, ...inside] }, 'Duplicate nodes')
    onSelectionChange({ ...EMPTY_SELECTION, nodes: [...made.values()] })
  }, [graph, onChange, onSelectionChange, selected, selection.nodes.length])

  /* -------------------------------------------------------------- the pointer */

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      setDrag({ kind: 'pan', from: [event.clientX, event.clientY], pan: view.pan })
      return
    }
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    /*
     * A press inside a node or inside the palette belongs to them. Without this the canvas would
     * capture the pointer and the button under the finger would never see its own click — which is
     * exactly what happened, and why the palette used to stay open when something was chosen.
     */
    if (target.closest('.graph-node') || target.closest('.graph-palette')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const at = toWorld(event.clientX, event.clientY)
    setDrag({ kind: 'box', from: at, at, extend: event.shiftKey })
    if (!event.shiftKey) onSelectionChange(EMPTY_SELECTION)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return
    if (drag.kind === 'pan') {
      const pan: [number, number] = [
        drag.pan[0] + (event.clientX - drag.from[0]),
        drag.pan[1] + (event.clientY - drag.from[1]),
      ]
      panned.current = pan
      if (world.current) world.current.style.transform = `translate(${pan[0]}px, ${pan[1]}px) scale(${view.zoom})`
      return
    }
    const at = toWorld(event.clientX, event.clientY)
    if (drag.kind === 'cable') {
      setDrag({ ...drag, at })
      return
    }
    if (drag.kind === 'box') {
      setDrag({ ...drag, at })
      return
    }
    const delta: [number, number] = [at[0] - drag.from[0], at[1] - drag.from[1]]
    const snapping = !event.ctrlKey
    let moved = false
    const nodes = graph.nodes.map((node) => {
      const start = drag.start.get(node.id)
      if (!start) return node
      const wanted = [start[0] + delta[0], start[1] + delta[1]]
      const x = snapping ? snapped(wanted[0]!, GRID_STEP) : wanted[0]!
      const y = snapping ? snapped(wanted[1]!, GRID_STEP) : wanted[1]!
      if (x === node.x && y === node.y) return node
      moved = true
      return { ...node, x, y }
    })
    /*
     * A press that has not moved anything writes nothing. Without this, a click on a node's header
     * is a step of history that undoes nothing — the pointer sends a move before it sends an up,
     * the nodes come back in a new array, and the document compares them by identity.
     */
    if (!moved) return
    onChange({ ...graph, nodes }, 'Move nodes')
    setDrag({ ...drag, moved: true })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!drag) return
    if (drag.kind === 'pan') {
      // The state catches up here, once, with wherever the hand left the world.
      const pan = panned.current
      panned.current = null
      if (pan) setView((current) => ({ ...current, pan }))
      setDrag(null)
      return
    }
    if (drag.kind === 'box') {
      const box = {
        x: Math.min(drag.from[0], drag.at[0]),
        y: Math.min(drag.from[1], drag.at[1]),
        width: Math.abs(drag.at[0] - drag.from[0]),
        height: Math.abs(drag.at[1] - drag.from[1]),
      }
      if (box.width > 4 || box.height > 4) {
        const covered = graph.nodes.filter((node) => {
          const info = infoOf(node.type)
          return info ? boxesOverlap(box, nodeBox(node, info)) : false
        }).map((node) => node.id)
        const next = drag.extend ? [...new Set([...selection.nodes, ...covered])] : covered
        onSelectionChange({ ...EMPTY_SELECTION, nodes: next })
      }
    }
    if (drag.kind === 'cable') {
      // Dropped on nothing: the palette opens where the cable ended, and what is chosen is joined.
      const box = surface.current?.getBoundingClientRect()
      if (box) setPalette({ at: [event.clientX - box.left, event.clientY - box.top], world: drag.at, from: drag })
    }
    setDrag(null)
  }

  /* ------------------------------------------------------------- the keyboard */

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      if (pending) {
        setPending(null)
        event.preventDefault()
      }
      if (palette) {
        setPalette(null)
        event.preventDefault()
      }
      return
    }
    if ((event.key === 'a' || event.key === 'A') && event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      openPalette()
      return
    }
    if (event.key === '/') {
      event.preventDefault()
      openPalette()
      return
    }
    if ((event.metaKey || event.ctrlKey) && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault()
      onSelectionChange({ ...EMPTY_SELECTION, nodes: graph.nodes.map((node) => node.id) })
      return
    }
    if ((event.metaKey || event.ctrlKey) && (event.key === 'd' || event.key === 'D')) {
      event.preventDefault()
      duplicateSelected()
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace' || event.key === 'x' || event.key === 'X') {
      event.preventDefault()
      removeSelected()
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      frameGraph()
      return
    }
    if ((event.key === 'l' || event.key === 'L') && event.shiftKey) {
      event.preventDefault()
      onChange({ ...graph, nodes: autoLayout(graph, infoOf) }, 'Lay out nodes')
    }
  }

  const openPalette = () => {
    const box = surface.current?.getBoundingClientRect()
    if (!box) return
    const at: [number, number] = [box.width / 2, box.height / 3]
    setPalette({ at, world: [(at[0] - view.pan[0]) / view.zoom, (at[1] - view.pan[1]) / view.zoom], from: null })
  }

  /* --------------------------------------------------------------- framing */

  /**
   * The whole graph brought into view.
   *
   * A graph laid out around the origin is mostly off to the left of a pane that starts at its own
   * top corner, so the first thing a person would otherwise see is an empty canvas with a cable
   * coming in from nowhere. It runs once when the editor opens, and again on Home.
   */
  const frameGraph = useCallback(() => {
    const box = surface.current?.getBoundingClientRect()
    if (!box || box.width < 1 || box.height < 1) return
    const bounds = graphBounds(graph, infoOf)
    const margin = 40
    /*
     * Never smaller than legible. A graph that does not fit is one to pan around, not one to shrink
     * until its labels are grey dust — which is what a plain fit does in a narrow pane.
     */
    const zoom = Math.max(FRAME_FLOOR, Math.min(1, Math.min(
      (box.width - margin * 2) / bounds.width,
      (box.height - margin * 2) / bounds.height,
    )))
    setView({
      zoom,
      pan: [
        box.width / 2 - (bounds.x + bounds.width / 2) * zoom,
        box.height / 2 - (bounds.y + bounds.height / 2) * zoom,
      ],
    })
  }, [graph, infoOf])

  const framed = useRef(false)
  useEffect(() => {
    if (framed.current || graph.nodes.length === 0) return
    framed.current = true
    frameGraph()
  }, [frameGraph, graph.nodes.length])

  /* --------------------------------------------------------------- the wheel */

  useEffect(() => {
    const element = surface.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const box = element.getBoundingClientRect()
      const at: [number, number] = [event.clientX - box.left, event.clientY - box.top]
      setView((current) => {
        if (!event.ctrlKey && !event.metaKey && (Math.abs(event.deltaX) > 0 || !event.shiftKey)) {
          // A trackpad's two fingers pan, as they do everywhere else in this editor.
          return { ...current, pan: [current.pan[0] - event.deltaX, current.pan[1] - event.deltaY] }
        }
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom * (event.deltaY > 0 ? 0.9 : 1.1)))
        // Zoom about the pointer: what was under it stays under it, which is the only zoom that
        // does not feel like the graph running away.
        const scale = zoom / current.zoom
        return {
          zoom,
          pan: [at[0] - (at[0] - current.pan[0]) * scale, at[1] - (at[1] - current.pan[1]) * scale],
        }
      })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  /* ---------------------------------------------------------------- the ports */

  const startCable = (event: ReactPointerEvent<HTMLButtonElement>, node: string, port: NodeSocket, side: 'in' | 'out') => {
    event.preventDefault()
    event.stopPropagation()
    surface.current?.setPointerCapture(event.pointerId)
    setDrag({ kind: 'cable', from: { node, port: port.id, side, tone: port.tone }, at: toWorld(event.clientX, event.clientY) })
  }

  const activatePort = (node: string, port: NodeSocket, side: 'in' | 'out') => {
    if (!pending) {
      setPending({ node, port: port.id, side, tone: port.tone })
      return
    }
    if (pending.side === side) {
      setPending({ node, port: port.id, side, tone: port.tone })
      return
    }
    if (pending.tone !== port.tone) {
      onMessage?.('Those two sockets do not carry the same thing.')
      return
    }
    if (side === 'in') connect({ node: pending.node, port: pending.port, tone: pending.tone }, { node, port: port.id })
    else connect({ node, port: port.id, tone: port.tone }, { node: pending.node, port: pending.port })
    setPending(null)
  }

  const dropOnPort = (node: string, port: NodeSocket, side: 'in' | 'out') => {
    if (!drag || drag.kind !== 'cable') return
    if (drag.from.side === side || drag.from.tone !== port.tone) {
      onMessage?.('Those two sockets do not carry the same thing.')
      setDrag(null)
      return
    }
    if (side === 'in') connect({ node: drag.from.node, port: drag.from.port, tone: drag.from.tone }, { node, port: port.id })
    else connect({ node, port: port.id, tone: port.tone }, { node: drag.from.node, port: drag.from.port })
    setDrag(null)
  }

  /** Whether a socket would take the cable being dragged or the port waiting for a partner. */
  const compatible = (side: 'in' | 'out', tone: NodeSocketTone): boolean => {
    const open = drag?.kind === 'cable' ? drag.from : pending
    if (!open) return false
    return open.side !== side && open.tone === tone
  }

  /* ---------------------------------------------------------------- the cables */

  const cables = graph.edges.flatMap((edge) => {
    const fromNode = graph.nodes.find((node) => node.id === edge.fromNode)
    const toNode = graph.nodes.find((node) => node.id === edge.toNode)
    const fromInfo = fromNode ? infoOf(fromNode.type) : null
    const toInfo = toNode ? infoOf(toNode.type) : null
    if (!fromNode || !toNode || !fromInfo || !toInfo) return []
    const from = portPoint(fromNode, fromInfo, 'out', edge.fromPort)
    const to = portPoint(toNode, toInfo, 'in', edge.toPort)
    return [{ edge, path: cablePath(from, to) }]
  })

  const bounds = graphBounds(graph, infoOf)

  return (
    <div className="graph" ref={surface} tabIndex={0} onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div
        className="graph__world"
        ref={world}
        style={{ transform: `translate(${view.pan[0]}px, ${view.pan[1]}px) scale(${view.zoom})` }}
      >
        <svg className="graph__cables" style={{ left: bounds.x - 200, top: bounds.y - 200, width: bounds.width + 400, height: bounds.height + 400 }} viewBox={`${bounds.x - 200} ${bounds.y - 200} ${bounds.width + 400} ${bounds.height + 400}`}>
          {cables.map(({ edge, path }) => (
            <path
              key={edge.id}
              className="graph__cable"
              data-tone={edge.tone}
              data-selected={selection.edges.includes(edge.id) ? '' : undefined}
              d={path}
            />
          ))}
          {drag?.kind === 'cable' ? (
            <path className="graph__cable graph__cable--drawing" data-tone={drag.from.tone} d={drawingPath(drag, graph, infoOf)} />
          ) : null}
        </svg>
        {graph.nodes.map((node) => {
          const info = infoOf(node.type)
          if (!info) return null
          return (
            <NodeCard
              key={node.id}
              node={node}
              info={info}
              selected={selected.has(node.id)}
              error={errors[node.id]}
              pending={pending}
              compatible={compatible}
              renderWidget={renderWidget}
              onSelect={(extend) => {
                if (!extend) onSelectionChange({ ...EMPTY_SELECTION, nodes: [node.id] })
                else onSelectionChange({ ...selection, nodes: [...new Set([...selection.nodes, node.id])] })
              }}
              onDragStart={(event) => {
                const ids = selected.has(node.id) ? selection.nodes : [node.id]
                if (!selected.has(node.id)) onSelectionChange({ ...EMPTY_SELECTION, nodes: [node.id] })
                const start = new Map<string, [number, number]>()
                for (const id of ids) {
                  const found = graph.nodes.find((entry) => entry.id === id)
                  if (found) start.set(id, [found.x, found.y])
                }
                surface.current?.setPointerCapture(event.pointerId)
                setDrag({ kind: 'nodes', from: toWorld(event.clientX, event.clientY), start, moved: false })
              }}
              onFold={() => onChange({
                ...graph,
                nodes: graph.nodes.map((entry) => (entry.id === node.id ? { ...entry, collapsed: !entry.collapsed } : entry)),
              }, node.collapsed ? 'Unfold node' : 'Fold node')}
              onPortDown={startCable}
              onPortUp={dropOnPort}
              onPortActivate={activatePort}
            />
          )
        })}
        {drag?.kind === 'box' ? (
          <div
            className="graph__marquee"
            style={{
              left: Math.min(drag.from[0], drag.at[0]),
              top: Math.min(drag.from[1], drag.at[1]),
              width: Math.abs(drag.at[0] - drag.from[0]),
              height: Math.abs(drag.at[1] - drag.from[1]),
            }}
          />
        ) : null}
      </div>
      {palette ? (
        <NodeGraphPalette
          at={palette.at}
          registry={registry}
          onPick={(type) => {
            addNode(type, palette.world, palette.from)
            setPalette(null)
          }}
          onClose={() => setPalette(null)}
        />
      ) : null}
      <div className="graph__hint" aria-hidden="true">⇧A to add · drag a socket to connect · ⇧L to lay out · Home to frame</div>
    </div>
  )
}

/** The cable being drawn: from the socket it left to wherever the pointer is. */
function drawingPath(
  drag: Drag & { kind: 'cable' },
  graph: NodeGraph,
  infoOf: (type: string) => NodeTypeInfo | null,
): string {
  const node = graph.nodes.find((entry) => entry.id === drag.from.node)
  const info = node ? infoOf(node.type) : null
  if (!node || !info) return ''
  const anchor = portPoint(node, info, drag.from.side, drag.from.port)
  const to = { x: drag.at[0], y: drag.at[1] }
  return drag.from.side === 'out' ? cablePath(anchor, to) : cablePath(to, anchor)
}

const NodeCard = memo(function NodeCard({
  node, info, selected, error, pending, compatible, renderWidget,
  onSelect, onDragStart, onFold, onPortDown, onPortUp, onPortActivate,
}: {
  node: GraphNode
  info: NodeTypeInfo
  selected: boolean
  error?: string
  pending: { node: string; port: string; side: 'in' | 'out' } | null
  compatible: (side: 'in' | 'out', tone: NodeSocketTone) => boolean
  renderWidget?: (node: GraphNode, row: number) => ReactNode
  onSelect: (extend: boolean) => void
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void
  onFold: () => void
  onPortDown: (event: ReactPointerEvent<HTMLButtonElement>, node: string, port: NodeSocket, side: 'in' | 'out') => void
  onPortUp: (node: string, port: NodeSocket, side: 'in' | 'out') => void
  onPortActivate: (node: string, port: NodeSocket, side: 'in' | 'out') => void
}) {
  const rows: ReactNode[] = []
  info.outputs.forEach((port) => {
    rows.push(
      <div className="graph-node__row graph-node__row--out" key={`out-${port.id}`}>
        <span className="graph-node__label">{port.label}</span>
        <Port node={node.id} port={port} side="out" pending={pending} compatible={compatible} onDown={onPortDown} onUp={onPortUp} onActivate={onPortActivate} />
      </div>,
    )
  })
  for (let row = 0; row < info.widgets; row += 1) {
    rows.push(<div className="graph-node__row graph-node__row--widget" key={`widget-${row}`}>{renderWidget?.(node, row)}</div>)
  }
  info.inputs.forEach((port) => {
    rows.push(
      <div className="graph-node__row graph-node__row--in" key={`in-${port.id}`}>
        <Port node={node.id} port={port} side="in" pending={pending} compatible={compatible} onDown={onPortDown} onUp={onPortUp} onActivate={onPortActivate} />
        <span className="graph-node__label">{port.label}</span>
      </div>,
    )
  })
  return (
    <div
      className="graph-node"
      data-selected={selected ? '' : undefined}
      data-error={error ? '' : undefined}
      data-node={node.id}
      style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: nodeHeight(info, node) }}
    >
      <div
        className="graph-node__header"
        role="button"
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          onSelect(event.shiftKey)
          onDragStart(event)
        }}
        onDoubleClick={onFold}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(event.shiftKey)
          }
        }}
      >
        <span className="graph-node__title">{info.label}</span>
        {error ? <Tooltip content={error}><span className="graph-node__error" aria-label={`Error: ${error}`}>!</span></Tooltip> : null}
      </div>
      {node.collapsed ? null : <div className="graph-node__body">{rows}</div>}
    </div>
  )
})

function Port({ node, port, side, pending, compatible, onDown, onUp, onActivate }: {
  node: string
  port: NodeSocket
  side: 'in' | 'out'
  pending: { node: string; port: string; side: 'in' | 'out' } | null
  compatible: (side: 'in' | 'out', tone: NodeSocketTone) => boolean
  onDown: (event: ReactPointerEvent<HTMLButtonElement>, node: string, port: NodeSocket, side: 'in' | 'out') => void
  onUp: (node: string, port: NodeSocket, side: 'in' | 'out') => void
  onActivate: (node: string, port: NodeSocket, side: 'in' | 'out') => void
}) {
  const waiting = pending?.node === node && pending.port === port.id && pending.side === side
  return (
    <button
      type="button"
      className="graph-node__port"
      data-tone={port.tone}
      data-side={side}
      data-pending={waiting ? '' : undefined}
      data-compatible={compatible(side, port.tone) ? '' : undefined}
      style={{ width: PORT_TARGET, height: ROW_HEIGHT }}
      aria-label={`${port.label}, ${side === 'in' ? 'input' : 'output'}`}
      onPointerDown={(event) => onDown(event, node, port, side)}
      onPointerUp={() => onUp(node, port, side)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onActivate(node, port, side)
      }}
    >
      <span className="graph-node__socket" aria-hidden="true" />
    </button>
  )
}

export { HEADER_HEIGHT, NODE_WIDTH, ROW_HEIGHT }
