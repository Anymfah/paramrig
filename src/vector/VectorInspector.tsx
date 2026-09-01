import type { ReactNode } from 'react'
import { Button, IconButton } from '@/ui/Button'
import { ColorField } from '@/ui/ColorField'
import { IconAlignBottom, IconAlignCenterH, IconAlignCenterV, IconAlignLeft, IconAlignRight, IconAlignTop, IconDistributeH, IconDistributeV } from '@/ui/icons'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { SwitchField } from '@/ui/SwitchField'
import { Tooltip } from '@/ui/Tooltip'
import { alignElements, distributeElements, type AlignMode, type DistributeAxis, type ElementPatch } from '@/vector/align'
import { isSmoothNode, placeNodeAt, toggleNodeType } from '@/vector/bezier'
import { MAX_DOCUMENT_SIZE } from '@/vector/document'
import { selectionBounds, type Bounds } from '@/vector/geometry'
import { scaleElementsToBounds } from '@/vector/transform'
import { leafElements } from '@/vector/tree'
import type { VectorDocument, VectorElement, VectorTool } from '@/vector/types'
import { defaultVectorNodes, isClosedPath, nodeWorldPosition } from '@/vector/vectorPath'
import type { DocumentPatch } from '@/vector/useVectorDocument'

type VectorInspectorProps = {
  document: VectorDocument
  tool: VectorTool
  selectedElements: VectorElement[]
  selectedNodeIndices: number[]
  onRenameDocument: (name: string) => void
  onUpdateDocument: (patch: DocumentPatch, record?: boolean) => void
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean) => void
  onUpdateElements: (updates: ElementPatch[], record?: boolean) => void
  onSelectNodes: (indices: number[]) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  onGestureCancel: () => void
}

export function VectorInspector({
  document,
  tool,
  selectedElements,
  selectedNodeIndices,
  onRenameDocument,
  onUpdateDocument,
  onUpdate,
  onUpdateElements,
  onSelectNodes,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: VectorInspectorProps) {
  const gesture = { onGestureStart, onGestureEnd, onGestureCancel }
  const single = selectedElements.length === 1 ? selectedElements[0]! : null
  const leaves = leafElements(document.elements, selectedElements.map((element) => element.id))
  const bounds = leaves.length ? selectionBounds(leaves) : null
  const page: Bounds = { x: 0, y: 0, width: document.width, height: document.height }

  /** Moves whole selections (groups move through their leaves). */
  const applyMoves = (patches: ElementPatch[]) => {
    const updates: ElementPatch[] = []
    for (const { id, patch } of patches) {
      const element = document.elements.find((item) => item.id === id)
      if (!element) continue
      const dx = typeof patch.x === 'number' ? patch.x - element.x : 0
      const dy = typeof patch.y === 'number' ? patch.y - element.y : 0
      if (element.kind === 'group') {
        for (const leaf of leafElements(document.elements, [id])) updates.push({ id: leaf.id, patch: { x: round(leaf.x + dx), y: round(leaf.y + dy) } })
      } else {
        updates.push({ id, patch })
      }
    }
    onUpdateElements(updates)
  }

  const align = (mode: AlignMode) => {
    const target = selectedElements.length > 1 && bounds ? bounds : page
    applyMoves(alignElements(selectedElements, mode, target))
  }
  const distribute = (axis: DistributeAxis) => applyMoves(distributeElements(selectedElements, axis))

  const moveSelection = (dx: number, dy: number) => {
    if (!leaves.length) return
    onUpdateElements(leaves.map((leaf) => ({ id: leaf.id, patch: { x: round(leaf.x + dx), y: round(leaf.y + dy) } })))
  }
  const resizeSelection = (width: number, height: number) => {
    if (!bounds || !leaves.length) return
    onUpdateElements(scaleElementsToBounds(leaves, bounds, { ...bounds, width: Math.max(1, width), height: Math.max(1, height) }))
  }

  return (
    <aside className="inspector vector-inspector" aria-label="Vector inspector">
      <div className="vector-inspector__head">
        <input
          className="vector-document-name"
          aria-label="Document name"
          defaultValue={document.name}
          key={document.name}
          spellCheck={false}
          onBlur={(event) => onRenameDocument(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.currentTarget.value = document.name
              event.currentTarget.blur()
            }
          }}
        />
      </div>
      <div className="vector-inspector__body scroll-area">
        {selectedElements.length === 0 ? (
          <>
            <section className="vector-panel vector-panel--document" aria-label="Page properties">
              <h2 className="vector-panel__title">Page</h2>
              <div className="vector-field-grid">
                <NumberField label="W" value={document.width} min={1} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(width) => onUpdateDocument({ width: Math.round(width) })} {...gesture} />
                <NumberField label="H" value={document.height} min={1} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(height) => onUpdateDocument({ height: Math.round(height) })} {...gesture} />
              </div>
              <ColorField label="Background" value={document.background} onChange={(background) => onUpdateDocument({ background })} {...gesture} />
            </section>
            <section className="vector-panel" aria-label="Guides">
              <div className="vector-panel__row">
                <h2 className="vector-panel__title">Guides</h2>
                <span className="vector-panel__meta">{document.guides.length === 0 ? 'None' : `${document.guides.length} ${document.guides.length === 1 ? 'guide' : 'guides'}`}</span>
              </div>
              <p className="vector-panel__hint">Drag from a ruler to add a guide. Drag a guide back onto its ruler to remove it.</p>
              {document.guides.length > 0 ? (
                <Button variant="quiet" size="sm" onClick={() => onUpdateDocument({ guides: [] })}>Clear guides</Button>
              ) : null}
            </section>
          </>
        ) : (
          <>
            <section className="vector-panel" aria-label="Geometry">
              <div className="vector-panel__row">
                <h2 className="vector-panel__title">{single ? kindLabel(single) : `${selectedElements.length} objects`}</h2>
                {single ? <span className="vector-panel__meta vector-panel__meta--name">{single.name}</span> : null}
              </div>
              {single && single.kind !== 'group' ? (
                <>
                  <div className="vector-field-grid">
                    <NumberField label="X" value={single.x} min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(x) => onUpdate(single.id, { x })} {...gesture} />
                    <NumberField label="Y" value={single.y} min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(y) => onUpdate(single.id, { y })} {...gesture} />
                    <NumberField label="W" value={single.width} min={1} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(width) => onUpdate(single.id, { width })} {...gesture} />
                    <NumberField label="H" value={single.height} min={1} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(height) => onUpdate(single.id, { height })} {...gesture} />
                  </div>
                  <NumberField label="Rotation" value={single.rotation} min={-360} max={360} step={1} unit="°" variant="field" onChange={(rotation) => onUpdate(single.id, { rotation })} {...gesture} />
                </>
              ) : bounds ? (
                <div className="vector-field-grid">
                  <NumberField label="X" value={round(bounds.x)} min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(x) => moveSelection(x - bounds.x, 0)} {...gesture} />
                  <NumberField label="Y" value={round(bounds.y)} min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(y) => moveSelection(0, y - bounds.y)} {...gesture} />
                  <NumberField label="W" value={round(bounds.width)} min={1} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(width) => resizeSelection(width, bounds.height)} {...gesture} />
                  <NumberField label="H" value={round(bounds.height)} min={1} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(height) => resizeSelection(bounds.width, height)} {...gesture} />
                </div>
              ) : null}
            </section>
            <section className="vector-panel" aria-label="Align">
              <h2 className="vector-panel__title">{selectedElements.length > 1 ? 'Align to selection' : 'Align to page'}</h2>
              <div className="vector-align" role="group" aria-label="Align">
                <AlignButton label="Align left" shortcut="⌥A" onClick={() => align('left')}><IconAlignLeft /></AlignButton>
                <AlignButton label="Align horizontal centres" shortcut="⌥H" onClick={() => align('centerX')}><IconAlignCenterH /></AlignButton>
                <AlignButton label="Align right" shortcut="⌥D" onClick={() => align('right')}><IconAlignRight /></AlignButton>
                <AlignButton label="Align top" shortcut="⌥W" onClick={() => align('top')}><IconAlignTop /></AlignButton>
                <AlignButton label="Align vertical centres" shortcut="⌥V" onClick={() => align('centerY')}><IconAlignCenterV /></AlignButton>
                <AlignButton label="Align bottom" shortcut="⌥S" onClick={() => align('bottom')}><IconAlignBottom /></AlignButton>
              </div>
              {selectedElements.length > 2 ? (
                <div className="vector-align" role="group" aria-label="Distribute">
                  <AlignButton label="Distribute horizontally" onClick={() => distribute('x')}><IconDistributeH /></AlignButton>
                  <AlignButton label="Distribute vertically" onClick={() => distribute('y')}><IconDistributeV /></AlignButton>
                </div>
              ) : null}
            </section>
            <AppearancePanel elements={selectedElements} leaves={leaves} onUpdate={onUpdate} onUpdateElements={onUpdateElements} gesture={gesture} />
            {single && single.kind !== 'group' ? (
              <PathPanel element={single} tool={tool} selectedNodeIndices={selectedNodeIndices} onUpdate={onUpdate} onSelectNodes={onSelectNodes} gesture={gesture} />
            ) : null}
            <section className="vector-panel" aria-label="State">
              <SwitchField label="Locked" checked={selectedElements.every((element) => element.locked)} onChange={(locked) => onUpdateElements(selectedElements.map((element) => ({ id: element.id, patch: { locked } })))} />
              <SwitchField label="Visible" checked={selectedElements.every((element) => element.visible)} onChange={(visible) => onUpdateElements(selectedElements.map((element) => ({ id: element.id, patch: { visible } })))} />
            </section>
          </>
        )}
      </div>
    </aside>
  )
}

function AppearancePanel({ elements, leaves, onUpdate, onUpdateElements, gesture }: {
  elements: VectorElement[]
  leaves: VectorElement[]
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean) => void
  onUpdateElements: (updates: ElementPatch[], record?: boolean) => void
  gesture: { onGestureStart: () => void; onGestureEnd: () => void; onGestureCancel: () => void }
}) {
  const single = elements.length === 1 && elements[0]!.kind !== 'group' ? elements[0]! : null
  const targets = single ? [single] : leaves
  if (targets.length === 0) return null
  const first = targets[0]!
  const same = (key: 'fill' | 'stroke' | 'strokeWidth' | 'opacity') => targets.every((element) => element[key] === first[key])
  const apply = (patch: Partial<VectorElement>, record?: boolean) => {
    if (single) onUpdate(single.id, patch, record)
    else onUpdateElements(targets.map((element) => ({ id: element.id, patch })), record)
  }
  const groupOpacity = !single && elements.length === 1 && elements[0]!.kind === 'group' ? elements[0]! : null
  return (
    <section className="vector-panel" aria-label="Appearance">
      <h2 className="vector-panel__title">Appearance</h2>
      <ColorField label="Fill" value={first.fill} mixed={!same('fill')} allowNone restoreValue={first.stroke !== 'none' ? first.stroke : undefined} onChange={(fill) => apply({ fill })} {...gesture} />
      <ColorField label="Stroke" value={first.stroke} mixed={!same('stroke')} allowNone restoreValue={first.fill !== 'none' ? first.fill : undefined} onChange={(stroke) => apply({ stroke })} {...gesture} />
      <NumberField label="Stroke" value={first.strokeWidth} min={0} max={100} step={0.5} unit="px" variant="field" onChange={(strokeWidth) => apply({ strokeWidth })} {...gesture} />
      {groupOpacity ? (
        <NumberField label="Opacity" value={Math.round(groupOpacity.opacity * 100)} min={0} max={100} step={1} unit="%" variant="field" onChange={(opacity) => onUpdate(groupOpacity.id, { opacity: opacity / 100 })} {...gesture} />
      ) : (
        <NumberField label="Opacity" value={Math.round(first.opacity * 100)} min={0} max={100} step={1} unit="%" variant="field" onChange={(opacity) => apply({ opacity: opacity / 100 })} {...gesture} />
      )}
      {!single && (!same('strokeWidth') || !same('opacity')) ? <p className="vector-panel__hint">Mixed values show the first object. Editing applies to all.</p> : null}
    </section>
  )
}

function PathPanel({ element, tool, selectedNodeIndices, onUpdate, onSelectNodes, gesture }: {
  element: VectorElement
  tool: VectorTool
  selectedNodeIndices: number[]
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean) => void
  onSelectNodes: (indices: number[]) => void
  gesture: { onGestureStart: () => void; onGestureEnd: () => void; onGestureCancel: () => void }
}) {
  const nodes = element.vectorNodes ?? defaultVectorNodes(element)
  const edited = !!element.vectorNodes
  const closed = isClosedPath(element)
  const activeIndex = tool === 'node' && selectedNodeIndices.length === 1 ? selectedNodeIndices[0]! : null
  const active = activeIndex === null ? null : nodes[activeIndex] ?? null
  const activeWorld = active ? nodeWorldPosition(element, active) : null
  const canOpen = edited || element.kind === 'path'
  return (
    <section className="vector-panel" aria-label="Path">
      <div className="vector-panel__row">
        <h2 className="vector-panel__title">Path</h2>
        <span className="vector-panel__meta">{nodes.length} {nodes.length === 1 ? 'node' : 'nodes'}{edited ? '' : ' · primitive'}</span>
      </div>
      {canOpen || nodes.length >= 3 ? (
        <SwitchField label="Closed" checked={closed} disabled={!closed && nodes.length < 3} onChange={(next) => {
          if (next) onUpdate(element.id, { closed: true, vectorNodes: nodes })
          else onUpdate(element.id, { kind: 'path', closed: false, vectorNodes: nodes })
        }} />
      ) : null}
      {!closed && nodes.length < 3 ? <p className="vector-panel__hint">A path needs three nodes before it can close.</p> : null}
      {active && activeWorld && activeIndex !== null ? (
        <>
          <div className="vector-panel__row">
            <span className="vector-panel__meta">Node {activeIndex + 1}</span>
          </div>
          <div className="vector-field-grid">
            <NumberField label="X" value={round(activeWorld.x)} min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(x) => onUpdate(element.id, placeNodeAt(element, nodes, activeIndex, { x, y: activeWorld.y }))} {...gesture} />
            <NumberField label="Y" value={round(activeWorld.y)} min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(y) => onUpdate(element.id, placeNodeAt(element, nodes, activeIndex, { x: activeWorld.x, y }))} {...gesture} />
          </div>
          <SelectField
            label="Type"
            value={isSmoothNode(active) ? 'smooth' : 'corner'}
            options={[{ value: 'corner', label: 'Corner' }, { value: 'smooth', label: 'Smooth' }]}
            onChange={(value) => {
              if ((value === 'smooth') === isSmoothNode(active)) return
              onUpdate(element.id, toggleNodeType(element, nodes, activeIndex))
              onSelectNodes([activeIndex])
            }}
          />
        </>
      ) : tool === 'node' ? (
        <p className="vector-panel__hint">{selectedNodeIndices.length > 1 ? `${selectedNodeIndices.length} nodes selected` : 'Select a node to edit its position. Double-click a node to toggle corner and smooth; click a segment to add a node.'}</p>
      ) : (
        <p className="vector-panel__hint">Press Enter or double-click the shape to edit nodes.</p>
      )}
    </section>
  )
}

function AlignButton({ label, shortcut, onClick, children }: { label: string; shortcut?: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={shortcut ? `${label} · ${shortcut}` : label}>
      <IconButton label={label} className="vector-align__button" onClick={onClick}>{children}</IconButton>
    </Tooltip>
  )
}

function kindLabel(element: VectorElement): string {
  if (element.vectorNodes && element.kind !== 'path') return `${element.kind === 'ellipse' ? 'Ellipse' : 'Rectangle'} · edited`
  switch (element.kind) {
    case 'rectangle': return 'Rectangle'
    case 'ellipse': return 'Ellipse'
    case 'path': return 'Path'
    case 'group': return 'Group'
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
