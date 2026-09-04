import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeGraphEditor } from '@/editor/nodeGraph/NodeGraphEditor'
import { EMPTY_SELECTION, type GraphNode, type NodeGraph, type NodeGraphSelection, type NodeTypeInfo } from '@/editor/nodeGraph/types'
import { principledGraph, sanitizeSceneGraph } from '@/scene/shader/material'
import { compileMaterialGraphGlsl } from '@/scene/shader/prismorphic/material-graph-glsl'
import { MATERIAL_GRAPH_GLSL_BUDGETS } from '@/scene/shader/prismorphic/material-graph-glsl'
import { diagnoseMaterialGraph } from '@/scene/shader/prismorphic/material-graph-diagnostics'
import type { MaterialGraphDocument, MaterialGraphNodeSettings } from '@/scene/shader/prismorphic/material-graph'
import { shaderNodeType, shaderNodeTypes, type ShaderWidget } from '@/scene/shader/registry'
import { Exposable } from '@/scene/SceneExpose'
import { SceneSection } from '@/scene/SceneProperties'
import type { SceneDocument, SceneObject, ShaderEditorState } from '@/scene/types'
import { ColorField } from '@/ui/ColorField'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { SwitchField } from '@/ui/SwitchField'
import { Tooltip } from '@/ui/Tooltip'

/**
 * The shader editor: the second space, on a material rather than on a map.
 *
 * It is the generic node editor with a shader's registry poured into it, and everything particular
 * to shading lives here: which material is being edited, what a node's fields look like, what the
 * compiler said about the graph, and the debounce that keeps a scrubbed slider from recompiling
 * sixty times a second.
 *
 * The graph belongs to the material, so every change goes through the document and is one step of
 * history — the same contract the UV editor has, and the reason undo works here without the editor
 * knowing what undo is.
 */

const COMPILE_DEBOUNCE_MS = 150

export function SceneShaderEditor({
  document,
  activeObject,
  activeSlot,
  onShader,
  onClose,
  onEditDocument,
  onMessage,
  onGestureStart,
  onGestureEnd,
}: {
  document: SceneDocument
  activeObject: SceneObject | null
  activeSlot: number
  onShader: (patch: Partial<ShaderEditorState>) => void
  onClose: () => void
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string) => void
  onMessage?: (text: string) => void
  /**
   * A gesture on a node's field, so that typing a number is one step of history rather than two.
   *
   * A field that is filled reports the empty value on its way to the new one, and each report is a
   * change of the document. Wrapping the two in a gesture is how every other panel in the editor
   * makes a scrub one step, and it is the same answer here.
   */
  onGestureStart?: (label: string) => void
  onGestureEnd?: (label: string) => void
}) {
  const [selection, setSelection] = useState<NodeGraphSelection>(EMPTY_SELECTION)

  /** The material being edited: the active object's slot, or the document's first. */
  const material = useMemo(() => {
    const id = activeObject?.materialSlots[activeSlot] ?? activeObject?.materialSlots[0]
    return document.materials.find((entry) => entry.id === id) ?? document.materials[0] ?? null
  }, [activeObject, activeSlot, document.materials])

  const graph = useMemo<NodeGraph>(() => {
    if (!material) return { nodes: [], edges: [], frames: [] }
    const read = sanitizeSceneGraph(material.graph)
    const source = read ?? principledGraph(material)
    return {
      nodes: source.nodes.map((node) => ({ id: node.id, type: node.type, x: node.x, y: node.y })),
      edges: source.edges.map((edge) => ({ ...edge })),
      frames: source.frames.map((frame) => ({ ...frame })),
    }
  }, [material])

  /** The settings live on the material's own graph rather than on the editor's copy of it. */
  const settingsOf = useCallback((nodeId: string): Partial<MaterialGraphNodeSettings> => {
    const read = material ? sanitizeSceneGraph(material.graph) : null
    return read?.nodes.find((node) => node.id === nodeId)?.settings ?? {}
  }, [material])

  const writeGraph = useCallback((next: NodeGraph, label: string) => {
    if (!material) return
    const read = sanitizeSceneGraph(material.graph) ?? principledGraph(material)
    const settings = new Map(read.nodes.map((node) => [node.id, node.settings]))
    const document: MaterialGraphDocument = {
      version: read.version,
      nodes: next.nodes.map((node) => {
        const info = shaderNodeType(node.type)
        return {
          id: node.id,
          type: node.type as MaterialGraphDocument['nodes'][number]['type'],
          x: node.x,
          y: node.y,
          inputs: (info?.inputs ?? []).map((port) => ({ ...port })),
          outputs: (info?.outputs ?? []).map((port) => ({ ...port })),
          settings: (settings.get(node.id) ?? info?.defaults ?? {}) as MaterialGraphNodeSettings,
        }
      }),
      edges: next.edges.map((edge) => ({ ...edge })),
      // The frames come back as the engine holds them; the editor never invents one of its own tone.
      frames: read.frames,
    }
    onEditDocument((current) => ({
      ...current,
      materials: current.materials.map((entry) => (entry.id === material.id ? { ...entry, graph: document } : entry)),
    }), label)
  }, [material, onEditDocument])

  const writeSettings = useCallback((nodeId: string, patch: Partial<MaterialGraphNodeSettings>, label: string) => {
    const materialId = material?.id
    if (!materialId) return
    /*
     * The graph is read inside the update rather than outside it, because a field reports the same
     * value twice — once as it is typed and once as it is committed — and the second report reaches
     * a handler still holding the document as it was before the first. Read from `current` and the
     * second write sees the value already there, answers with the document it was given, and the
     * history keeps one step instead of two.
     */
    onEditDocument((current) => {
      const entry = current.materials.find((candidate) => candidate.id === materialId)
      if (!entry) return current
      const read = sanitizeSceneGraph(entry.graph) ?? principledGraph(entry)
      const before = read.nodes.find((node) => node.id === nodeId)?.settings as Record<string, unknown> | undefined
      if (before && Object.entries(patch).every(([key, value]) => before[key] === value)) return current
      const next: MaterialGraphDocument = {
        ...read,
        nodes: read.nodes.map((node) => (
          node.id === nodeId ? { ...node, settings: { ...node.settings, ...patch } as MaterialGraphNodeSettings } : node
        )),
      }
      return {
        ...current,
        materials: current.materials.map((candidate) => (candidate.id === materialId ? { ...candidate, graph: next } : candidate)),
      }
    }, label)
  }, [material?.id, onEditDocument])

  /* ------------------------------------------------------------ compiling */

  const [report, setReport] = useState<{ nodes: number; uniforms: number; error: string | null }>({ nodes: 0, uniforms: 0, error: null })
  /** What the compiler said about each node, so the fault can be read where it is. */
  const [errors, setErrors] = useState<Record<string, string>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    /*
     * Debounced, because a scrubbed slider changes the graph on every frame and compiling it on
     * every frame would put the pointer behind the hand. The uniforms in the viewport are live
     * either way: the compiled programme does not change when a number does, only its uniforms do,
     * which is what the engine's cache is for.
     */
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      const read = material ? sanitizeSceneGraph(material.graph) : null
      if (!read) {
        setReport({ nodes: 0, uniforms: 0, error: null })
        setErrors({})
        return
      }
      /*
       * The diagnostics come first and are per node: a socket wired to the wrong kind of thing, a
       * surface with nothing in it. They are what puts the mark on the faulty card, and they say
       * more than a compiler's refusal does — a compiler stops at the first thing it cannot do.
       */
      const found: Record<string, string> = {}
      for (const message of diagnoseMaterialGraph(read).messages) {
        if (message.severity === 'error' && message.nodeId) found[message.nodeId] = message.message
      }
      setErrors(found)
      try {
        const compiled = compileMaterialGraphGlsl(read)
        setReport({ nodes: compiled.reachableNodeIds.length, uniforms: compiled.uniforms.length, error: null })
      } catch (error) {
        setReport({ nodes: 0, uniforms: 0, error: error instanceof Error ? error.message : 'The graph would not compile.' })
      }
    }, COMPILE_DEBOUNCE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [material])

  const registry = useMemo<NodeTypeInfo[]>(
    () => shaderNodeTypes().map((entry) => ({
      type: entry.type,
      label: entry.label,
      category: entry.category,
      inputs: entry.inputs,
      outputs: entry.outputs,
      widgets: entry.widgets.length,
      ...(entry.description ? { description: entry.description } : {}),
    })),
    [],
  )

  const outputs = useMemo(() => graph.nodes.filter((node) => node.type === 'material-output').map((node) => node.id), [graph.nodes])
  const activeNode = graph.nodes.find((node) => node.id === selection.nodes[0]) ?? null

  const gesture = useMemo(() => ({
    onGestureStart: () => onGestureStart?.('Node setting'),
    onGestureEnd: () => onGestureEnd?.('Node setting'),
  }), [onGestureEnd, onGestureStart])

  const renderWidget = useCallback((node: GraphNode, row: number) => {
    const info = shaderNodeType(node.type)
    const widget = info?.widgets[row]
    if (!widget) return null
    return (
      <ShaderWidgetField
        widget={widget}
        value={settingsOf(node.id)[widget.kind === 'vector' ? widget.settings[0] : widget.setting]}
        settings={settingsOf(node.id)}
        onChange={(patch) => writeSettings(node.id, patch, 'Node setting')}
      />
    )
  }, [settingsOf, writeSettings])

  if (!material) {
    return (
      <section className="scene-shader" aria-label="Shader editor">
        <p className="scene-shader__empty">This scene has no material to edit.</p>
      </section>
    )
  }

  return (
    <section className="scene-shader" aria-label="Shader editor">
      <header className="scene-shader__header">
        <SelectField
          label="Material"
          value={material.id}
          options={document.materials.map((entry) => ({ value: entry.id, label: entry.name }))}
          onChange={() => onMessage?.('Choose a material on the object first: the editor follows the active slot.')}
        />
        <SwitchField
          label="Use nodes"
          checked={material.useNodes === true}
          onChange={(useNodes) => onEditDocument((current) => ({
            ...current,
            materials: current.materials.map((entry) => (entry.id === material.id
              ? { ...entry, useNodes, graph: entry.graph ?? principledGraph(entry) }
              : entry)),
          }), useNodes ? 'Use nodes' : 'Plain material')}
        />
        <p className="scene-shader__report">
          {report.error
            ? report.error
            : Object.keys(errors).length > 0
              ? `${Object.keys(errors).length} node${Object.keys(errors).length === 1 ? '' : 's'} to look at`
              : `${report.nodes} of ${MATERIAL_GRAPH_GLSL_BUDGETS.maxReachableNodes} nodes · ${report.uniforms} of ${MATERIAL_GRAPH_GLSL_BUDGETS.maxUniformBindings} uniforms`}
        </p>
        <Tooltip content="Close the shader editor">
          <button type="button" className="scene-shader__close" aria-label="Close the shader editor" onClick={onClose}>×</button>
        </Tooltip>
      </header>
      <div className="scene-shader__body">
        <NodeGraphEditor
          graph={graph}
          onChange={writeGraph}
          registry={registry}
          selection={selection}
          onSelectionChange={(next) => {
            setSelection(next)
            onShader({ activeNode: next.nodes[0] })
          }}
          renderWidget={renderWidget}
          protectedNodes={outputs}
          errors={errors}
          {...(onMessage ? { onMessage } : {})}
        />
        <aside className="scene-shader__sidebar scroll-area" aria-label="Node">
          <SceneSection id="shader-node" title="Node" isOpen={() => true} onSection={() => {}}>
            {activeNode ? (
              <>
                <p className="scene-shader__name">{shaderNodeType(activeNode.type)?.label ?? activeNode.type}</p>
                {(shaderNodeType(activeNode.type)?.widgets ?? []).map((widget) => {
                  const field = (
                    <ShaderWidgetField
                      widget={widget}
                      value={settingsOf(activeNode.id)[widget.kind === 'vector' ? widget.settings[0] : widget.setting]}
                      settings={settingsOf(activeNode.id)}
                      onChange={(patch) => writeSettings(activeNode.id, patch, 'Node setting')}
                      {...gesture}
                    />
                  )
                  const key = widget.kind === 'vector' ? widget.settings.join('-') : String(widget.setting)
                  /*
                   * A ◇ on the numbers, and only on the numbers: a control drives a value, and a
                   * choice or a switch is not one. It is the sidebar rather than the node that
                   * carries it, because a diamond on a node's own row would leave no room for the
                   * field itself.
                   */
                  return widget.kind === 'number' ? (
                    <Exposable
                      key={key}
                      property={`materials[${material.id}].nodes[${activeNode.id}].${String(widget.setting)}`}
                      min={widget.min}
                      max={widget.max}
                      step={widget.step}
                    >
                      {field}
                    </Exposable>
                  ) : <div key={key}>{field}</div>
                })}
              </>
            ) : (
              <p className="scene-shader__empty">Choose a node to see what it is set to.</p>
            )}
          </SceneSection>
        </aside>
      </div>
    </section>
  )
}

/** One field on a node, drawn with the kit's own controls: the editor knows rows, not widgets. */
function ShaderWidgetField({ widget, value, settings, onChange, onGestureStart, onGestureEnd }: {
  widget: ShaderWidget
  value: unknown
  settings: Partial<MaterialGraphNodeSettings>
  onChange: (patch: Partial<MaterialGraphNodeSettings>) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
}) {
  const gesture = { onGestureStart, onGestureEnd }
  if (widget.kind === 'colour') {
    return (
      <ColorField
        label={widget.label}
        value={typeof value === 'string' ? value : '#ffffff'}
        onChange={(next) => onChange({ [widget.setting]: next } as Partial<MaterialGraphNodeSettings>)}
      />
    )
  }
  if (widget.kind === 'switch') {
    return (
      <SwitchField
        label={widget.label}
        checked={value === true}
        onChange={(next) => onChange({ [widget.setting]: next } as Partial<MaterialGraphNodeSettings>)}
      />
    )
  }
  if (widget.kind === 'select') {
    return (
      <SelectField
        label={widget.label}
        value={typeof value === 'string' ? value : (widget.options[0]?.value ?? '')}
        options={[...widget.options]}
        onChange={(next) => onChange({ [widget.setting]: next } as Partial<MaterialGraphNodeSettings>)}
      />
    )
  }
  if (widget.kind === 'vector') {
    return (
      <div className="scene-shader__vector" role="group" aria-label={widget.label}>
        {widget.settings.map((setting, axis) => (
          <NumberField
            key={String(setting)}
            label={'XYZ'[axis] ?? ''}
            value={Number(settings[setting] ?? 0)}
            min={-100}
            max={100}
            step={0.01}
            variant="field"
            onChange={(next) => onChange({ [setting]: next } as Partial<MaterialGraphNodeSettings>)}
            {...gesture}
          />
        ))}
      </div>
    )
  }
  return (
    <NumberField
      label={widget.label}
      value={Number(value ?? 0)}
      min={widget.min}
      max={widget.max}
      step={widget.step}
      variant="field"
      onChange={(next) => onChange({ [widget.setting]: next } as Partial<MaterialGraphNodeSettings>)}
      {...gesture}
    />
  )
}
