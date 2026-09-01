import { useState, type ReactNode } from 'react'
import { IconTrash } from '@/ui/icons'
import { Button, IconButton } from '@/ui/Button'
import { ColorField } from '@/ui/ColorField'
import { IconAlignBottom, IconAlignCenterH, IconAlignCenterV, IconAlignLeft, IconAlignRight, IconAlignTop, IconDistributeH, IconDistributeV } from '@/ui/icons'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { SwitchField } from '@/ui/SwitchField'
import { SliderField } from '@/ui/SliderField'
import { PaintList } from '@/vector/VectorPaintPanel'
import { fillsOf, fillsPatch, strokesOf, strokesPatch } from '@/vector/paints'
import { cornerRadii } from '@/vector/corners'
import { booleanOperation, flattenElement, outlineStroke, type BooleanOperation } from '@/vector/booleans'
import { Tooltip } from '@/ui/Tooltip'
import { alignElements, distributeElements, type AlignMode, type DistributeAxis, type ElementPatch } from '@/vector/align'
import { createVectorElement } from '@/vector/document'
import { components, connectNodes, mergeNetworks, moveNodes, normalizeWorld, setHandleMode, toggleNodeSmooth, worldNetwork, type AbsNetwork } from '@/vector/network'
import { computeFaces } from '@/vector/planar'
import { MAX_DOCUMENT_SIZE } from '@/vector/document'
import { selectionBounds, type Bounds } from '@/vector/geometry'
import { scaleElementsToBounds } from '@/vector/transform'
import { leafElements } from '@/vector/tree'
import type { VectorDocument, VectorElement, VectorTool } from '@/vector/types'

import type { DocumentPatch } from '@/vector/useVectorDocument'

type VectorInspectorProps = {
  document: VectorDocument
  tool: VectorTool
  selectedElements: VectorElement[]
  selectedNodeIds: string[]
  onRenameDocument: (name: string) => void
  onUpdateDocument: (patch: DocumentPatch, record?: boolean) => void
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean) => void
  onUpdateElements: (updates: ElementPatch[], record?: boolean) => void
  onEditElements: (edit: (elements: VectorElement[]) => VectorElement[], record?: boolean) => void
  onSelectIds: (ids: string[]) => void
  onSelectNodes: (ids: string[]) => void
  historyDepth: number
  onSaveVersion: (name: string) => void
  onRestoreVersion: (id: string) => void
  onDeleteVersion: (id: string) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  onGestureCancel: () => void
}

export function VectorInspector({
  document,
  tool,
  selectedElements,
  selectedNodeIds,
  onRenameDocument,
  onUpdateDocument,
  onUpdate,
  onUpdateElements,
  onEditElements,
  onSelectIds,
  onSelectNodes,
  historyDepth,
  onSaveVersion,
  onRestoreVersion,
  onDeleteVersion,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: VectorInspectorProps) {
  const gesture = { onGestureStart, onGestureEnd, onGestureCancel }
  const [versionName, setVersionName] = useState('')
  const combinable = selectedElements.filter((element) => element.kind !== 'group')
  const replaceWithPath = (sources: VectorElement[], geometry: ReturnType<typeof booleanOperation>, name: string) => {
    if (!geometry) return
    const first = sources[0]!
    const result: VectorElement = {
      ...createVectorElement('path', geometry, { name, fill: first.fill, stroke: first.stroke, strokeWidth: first.strokeWidth, network: geometry.network }),
      opacity: first.opacity,
      ...(first.fills ? { fills: first.fills } : {}),
      ...(first.strokes ? { strokes: first.strokes } : {}),
      ...(first.strokeAlign ? { strokeAlign: first.strokeAlign } : {}),
      ...(first.strokeCap ? { strokeCap: first.strokeCap } : {}),
      ...(first.strokeJoin ? { strokeJoin: first.strokeJoin } : {}),
      ...(first.strokeDash ? { strokeDash: first.strokeDash } : {}),
      ...(first.parentId ? { parentId: first.parentId } : {}),
    }
    const ids = new Set(sources.map((element) => element.id))
    onEditElements((elements) => {
      const anchor = Math.max(...sources.map((element) => elements.findIndex((item) => item.id === element.id)))
      const rest = elements.filter((element) => !ids.has(element.id))
      const at = rest.findIndex((element) => elements.indexOf(element) > anchor)
      const index = at < 0 ? rest.length : at
      return [...rest.slice(0, index), result, ...rest.slice(index)]
    })
    onSelectIds([result.id])
  }
  const runBoolean = (operation: BooleanOperation) => {
    if (combinable.length < 2) return
    const ordered = [...combinable].sort((a, b) => document.elements.indexOf(a) - document.elements.indexOf(b))
    replaceWithPath(ordered, booleanOperation(operation, ordered), operation === 'unite' ? 'Union' : operation === 'subtract' ? 'Subtract' : operation === 'intersect' ? 'Intersect' : 'Exclude')
  }
  const flatten = () => {
    const target = combinable[0]
    if (!target) return
    if (combinable.length > 1) {
      const ordered = [...combinable].sort((a, b) => document.elements.indexOf(a) - document.elements.indexOf(b))
      replaceWithPath(ordered, booleanOperation('unite', ordered), 'Flattened')
      return
    }
    const geometry = flattenElement(target)
    if (!geometry) return
    onUpdate(target.id, { ...geometry, kind: 'path', rotation: 0, regionsOff: undefined })
  }
  const outline = () => {
    const target = single
    if (!target || target.kind === 'group' || target.strokeWidth <= 0) return
    const geometry = outlineStroke(target)
    if (!geometry) return
    const strokePaint = target.strokes ?? undefined
    onUpdate(target.id, {
      ...geometry,
      kind: 'path',
      rotation: 0,
      fill: target.stroke,
      fills: strokePaint,
      stroke: 'none',
      strokes: undefined,
      strokeWidth: 0,
      strokeAlign: undefined,
      strokeDash: undefined,
      strokeArrowStart: undefined,
      strokeArrowEnd: undefined,
      strokeSides: undefined,
      cornerRadius: undefined,
      regionsOff: undefined,
    })
  }
  const combine = () => {
    if (combinable.length < 2) return
    const merged = normalizeWorld(mergeNetworks(combinable.map((element) => worldNetwork(element))))
    const first = combinable[0]!
    const result: VectorElement = { ...createVectorElement('path', merged, { name: 'Path', fill: first.fill, stroke: first.stroke, strokeWidth: first.strokeWidth, network: merged.network }), opacity: first.opacity, ...(first.parentId ? { parentId: first.parentId } : {}) }
    const ids = new Set(combinable.map((element) => element.id))
    onEditElements((elements) => {
      const anchor = Math.max(...combinable.map((element) => elements.findIndex((item) => item.id === element.id)))
      const rest = elements.filter((element) => !ids.has(element.id))
      const at = rest.findIndex((element) => elements.indexOf(element) > anchor)
      const index = at < 0 ? rest.length : at
      return [...rest.slice(0, index), result, ...rest.slice(index)]
    })
    onSelectIds([result.id])
  }

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
            <section className="vector-panel" aria-label="History">
              <div className="vector-panel__row">
                <h2 className="vector-panel__title">History</h2>
                <span className="vector-panel__meta">{historyDepth === 0 ? 'Nothing to undo' : `${historyDepth} ${historyDepth === 1 ? 'step' : 'steps'} to undo`}</span>
              </div>
              <form className="vector-version-form" onSubmit={(event) => { event.preventDefault(); onSaveVersion(versionName); setVersionName('') }}>
                <input className="vector-version-form__input" aria-label="Version name" placeholder="Version name" value={versionName} maxLength={80} onChange={(event) => setVersionName(event.currentTarget.value)} />
                <Button variant="quiet" size="sm" type="submit">Save version</Button>
              </form>
              {(document.versions ?? []).length ? (
                <ul className="vector-versions" aria-label="Saved versions">
                  {[...(document.versions ?? [])].reverse().map((version) => (
                    <li key={version.id} className="vector-version">
                      <div className="vector-version__text">
                        <span className="vector-version__name">{version.name}</span>
                        <span className="vector-panel__meta">{new Date(version.createdAt).toLocaleString()} · {version.elements.filter((element) => element.kind !== 'group').length} objects</span>
                      </div>
                      <Button variant="quiet" size="sm" onClick={() => onRestoreVersion(version.id)}>Restore</Button>
                      <Tooltip content="Delete version">
                        <IconButton label={`Delete version ${version.name}`} onClick={() => onDeleteVersion(version.id)}><IconTrash /></IconButton>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              ) : <p className="vector-panel__hint">Saved versions keep a copy of every object and guide. Restoring is one undo step.</p>}
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
              <PathPanel element={single} tool={tool} selectedNodeIds={selectedNodeIds} onUpdate={onUpdate} onEditElements={onEditElements} onSelectIds={onSelectIds} onSelectNodes={onSelectNodes} gesture={gesture} />
            ) : null}
            {combinable.length > 1 ? (
              <section className="vector-panel" aria-label="Paths">
                <div className="vector-panel__row">
                  <h2 className="vector-panel__title">Paths</h2>
                  <span className="vector-panel__meta">{combinable.length} shapes</span>
                </div>
                <div className="vector-panel__actions">
                  <Button variant="quiet" size="sm" onClick={() => runBoolean('unite')}>Union</Button>
                  <Button variant="quiet" size="sm" onClick={() => runBoolean('subtract')}>Subtract</Button>
                  <Button variant="quiet" size="sm" onClick={() => runBoolean('intersect')}>Intersect</Button>
                  <Button variant="quiet" size="sm" onClick={() => runBoolean('exclude')}>Exclude</Button>
                </div>
                <div className="vector-panel__actions">
                  <Button variant="quiet" size="sm" data-action="combine" onClick={combine}>Combine · ⌘E</Button>
                  <Button variant="quiet" size="sm" onClick={flatten}>Flatten</Button>
                </div>
                <p className="vector-panel__hint">Booleans use the bottom object as the base. Combine keeps every sub-path; Flatten unites them.</p>
              </section>
            ) : single && single.kind !== 'group' && (single.strokeWidth > 0 || single.network) ? (
              <section className="vector-panel" aria-label="Geometry operations">
                <div className="vector-panel__actions">
                  {single.strokeWidth > 0 && single.stroke !== 'none' ? <Button variant="quiet" size="sm" onClick={outline}>Outline stroke</Button> : null}
                  {single.network ? <Button variant="quiet" size="sm" onClick={flatten}>Flatten</Button> : null}
                </div>
              </section>
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
  const fills = fillsOf(first)
  const strokes = strokesOf(first)
  const fillsMixed = !same('fill') || targets.some((element) => JSON.stringify(element.fills) !== JSON.stringify(first.fills))
  const strokesMixed = !same('stroke') || targets.some((element) => JSON.stringify(element.strokes) !== JSON.stringify(first.strokes))
  const isRectangle = single?.kind === 'rectangle' && !single.network
  const isPath = !!single?.network
  const radii: [number, number, number, number] = single ? cornerRadii(single) : [0, 0, 0, 0]
  const uniformRadius = typeof single?.cornerRadius !== 'object'
  const sides = single?.strokeSides ?? { top: true, right: true, bottom: true, left: true }
  const setSide = (side: keyof typeof sides, value: boolean) => {
    if (!single) return
    const next = { ...sides, [side]: value }
    onUpdate(single.id, { strokeSides: next.top && next.right && next.bottom && next.left ? undefined : next })
  }
  return (
    <>
      <section className="vector-panel" aria-label="Appearance">
        <h2 className="vector-panel__title">Appearance</h2>
        <PaintList label="Fill" paints={fills} mixed={fillsMixed} onChange={(paints, record) => apply(fillsPatch(paints), record)} gesture={gesture} />
        <PaintList label="Stroke" paints={strokes} mixed={strokesMixed} onChange={(paints, record) => apply(strokesPatch(paints), record)} gesture={gesture} />
        {groupOpacity ? (
          <NumberField label="Opacity" value={Math.round(groupOpacity.opacity * 100)} min={0} max={100} step={1} unit="%" variant="field" onChange={(opacity) => onUpdate(groupOpacity.id, { opacity: opacity / 100 })} {...gesture} />
        ) : (
          <NumberField label="Opacity" value={Math.round(first.opacity * 100)} min={0} max={100} step={1} unit="%" variant="field" onChange={(opacity) => apply({ opacity: opacity / 100 })} {...gesture} />
        )}
        {!single && (!same('strokeWidth') || !same('opacity')) ? <p className="vector-panel__hint">Mixed values show the first object. Editing applies to all.</p> : null}
      </section>
      {strokes.length > 0 ? (
        <section className="vector-panel" aria-label="Stroke properties">
          <h2 className="vector-panel__title">Stroke</h2>
          <NumberField label="Width" value={first.strokeWidth} min={0} max={100} step={0.5} unit="px" variant="field" onChange={(strokeWidth) => apply({ strokeWidth })} {...gesture} />
          <SelectField label="Align" value={first.strokeAlign ?? 'center'} options={[{ value: 'inside', label: 'Inside' }, { value: 'center', label: 'Center' }, { value: 'outside', label: 'Outside' }]} onChange={(value) => apply({ strokeAlign: value === 'center' ? undefined : value as VectorElement['strokeAlign'] })} />
          <SelectField label="Cap" value={first.strokeCap ?? 'butt'} options={[{ value: 'butt', label: 'Butt' }, { value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }]} onChange={(value) => apply({ strokeCap: value === 'butt' ? undefined : value as VectorElement['strokeCap'] })} />
          <SelectField label="Join" value={first.strokeJoin ?? 'miter'} options={[{ value: 'miter', label: 'Miter' }, { value: 'round', label: 'Round' }, { value: 'bevel', label: 'Bevel' }]} onChange={(value) => apply({ strokeJoin: value === 'miter' ? undefined : value as VectorElement['strokeJoin'] })} />
          <div className="vector-field-grid">
            <NumberField label="Dash" value={first.strokeDash?.[0] ?? 0} min={0} max={1000} step={1} unit="px" variant="field" onChange={(dash) => apply({ strokeDash: dash > 0 ? [dash, first.strokeDash?.[1] ?? dash] : undefined })} {...gesture} />
            <NumberField label="Gap" value={first.strokeDash?.[1] ?? 0} min={0} max={1000} step={1} unit="px" variant="field" disabled={!first.strokeDash} onChange={(gap) => apply({ strokeDash: first.strokeDash ? [first.strokeDash[0], gap] : undefined })} {...gesture} />
          </div>
          {isPath ? (
            <div className="vector-field-grid">
              <SelectField label="Start" value={first.strokeArrowStart ?? 'none'} options={ARROW_OPTIONS} onChange={(value) => apply({ strokeArrowStart: value === 'none' ? undefined : value as VectorElement['strokeArrowStart'] })} />
              <SelectField label="End" value={first.strokeArrowEnd ?? 'none'} options={ARROW_OPTIONS} onChange={(value) => apply({ strokeArrowEnd: value === 'none' ? undefined : value as VectorElement['strokeArrowEnd'] })} />
            </div>
          ) : null}
          {isRectangle && !radii.some(Boolean) ? (
            <div className="vector-sides" role="group" aria-label="Stroke sides">
              <SwitchField label="Top" checked={sides.top} onChange={(value) => setSide('top', value)} />
              <SwitchField label="Right" checked={sides.right} onChange={(value) => setSide('right', value)} />
              <SwitchField label="Bottom" checked={sides.bottom} onChange={(value) => setSide('bottom', value)} />
              <SwitchField label="Left" checked={sides.left} onChange={(value) => setSide('left', value)} />
            </div>
          ) : null}
        </section>
      ) : null}
      {isRectangle && single ? (
        <section className="vector-panel" aria-label="Corners">
          <div className="vector-panel__row">
            <h2 className="vector-panel__title">Corners</h2>
            <SwitchField label="Per corner" checked={!uniformRadius} onChange={(separate) => onUpdate(single.id, { cornerRadius: separate ? [radii[0], radii[1], radii[2], radii[3]] : radii[0] || undefined })} />
          </div>
          {uniformRadius ? (
            <SliderField label="Radius" value={radii[0]} min={0} max={Math.floor(Math.min(single.width, single.height) / 2)} step={1} unit="px" onChange={(radius) => onUpdate(single.id, { cornerRadius: radius > 0 ? radius : undefined })} {...gesture} />
          ) : (
            <div className="vector-field-grid">
              {(['Top left', 'Top right', 'Bottom right', 'Bottom left'] as const).map((label, index) => (
                <NumberField key={label} label={label} value={radii[index]!} min={0} max={Math.floor(Math.min(single.width, single.height) / 2)} step={1} unit="px" variant="field" onChange={(value) => {
                  const next = [...radii] as [number, number, number, number]
                  next[index] = value
                  onUpdate(single.id, { cornerRadius: next })
                }} {...gesture} />
              ))}
            </div>
          )}
          <SliderField label="Smoothing" value={Math.round((single.cornerSmoothing ?? 0) * 100)} min={0} max={100} step={1} unit="%" disabled={!radii.some(Boolean)} onChange={(value) => onUpdate(single.id, { cornerSmoothing: value > 0 ? value / 100 : undefined })} {...gesture} />
        </section>
      ) : null}
    </>
  )
}

const ARROW_OPTIONS = [{ value: 'none', label: 'None' }, { value: 'arrow', label: 'Arrow' }, { value: 'triangle', label: 'Triangle' }, { value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }, { value: 'bar', label: 'Bar' }]

function PathPanel({ element, tool, selectedNodeIds, onUpdate, onEditElements, onSelectIds, onSelectNodes, gesture }: {
  element: VectorElement
  tool: VectorTool
  selectedNodeIds: string[]
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean) => void
  onEditElements: (edit: (elements: VectorElement[]) => VectorElement[], record?: boolean) => void
  onSelectIds: (ids: string[]) => void
  onSelectNodes: (ids: string[]) => void
  gesture: { onGestureStart: () => void; onGestureEnd: () => void; onGestureCancel: () => void }
}) {
  const world = worldNetwork(element)
  const edited = !!element.network
  const faces = computeFaces(world)
  const off = new Set(element.regionsOff ?? [])
  const filled = faces.filter((face) => !off.has(face.key)).length
  const activeId = tool === 'node' && selectedNodeIds.length === 1 ? selectedNodeIds[0]! : null
  const active = activeId ? world.nodes.find((node) => node.id === activeId) ?? null : null
  const incident = active ? world.segments.filter((segment) => segment.a === active.id || segment.b === active.id) : []
  const smooth = active ? incident.some((segment) => (segment.a === active.id && segment.ah) || (segment.b === active.id && segment.bh)) : false
  const pair = selectedNodeIds.length === 2 ? selectedNodeIds : null
  const canConnect = tool === 'node' && !!pair && !world.segments.some((segment) => (segment.a === pair[0] && segment.b === pair[1]) || (segment.a === pair[1] && segment.b === pair[0]))
  const groups = components(world)
  const applyEdit = (edit: ReturnType<typeof toggleNodeSmooth> | null, selection?: string[]) => {
    if (!edit) return
    onUpdate(element.id, { ...edit, kind: 'path' })
    if (selection) onSelectNodes(selection)
  }
  const separate = () => {
    if (groups.length < 2) return
    const created = groups.map((ids, index) => {
      const subset: AbsNetwork = { nodes: world.nodes.filter((node) => ids.includes(node.id)), segments: world.segments.filter((segment) => ids.includes(segment.a)) }
      const built = normalizeWorld(subset)
      return { ...createVectorElement('path', built, { name: `${element.name} ${index + 1}`, fill: element.fill, stroke: element.stroke, strokeWidth: element.strokeWidth, network: built.network }), opacity: element.opacity, ...(element.parentId ? { parentId: element.parentId } : {}) }
    })
    onEditElements((elements) => {
      const at = elements.findIndex((item) => item.id === element.id)
      if (at < 0) return elements
      return [...elements.slice(0, at), ...created, ...elements.slice(at + 1)]
    })
    onSelectIds(created.map((item) => item.id))
  }
  return (
    <section className="vector-panel" aria-label="Path">
      <div className="vector-panel__row">
        <h2 className="vector-panel__title">Network</h2>
        <span className="vector-panel__meta">{world.nodes.length} nodes · {world.segments.length} segments{edited ? '' : ' · primitive'}</span>
      </div>
      <div className="vector-panel__row">
        <span className="vector-panel__meta">{faces.length === 0 ? 'No closed region' : `${filled} of ${faces.length} ${faces.length === 1 ? 'region' : 'regions'} filled`}</span>
        <span className="vector-panel__meta">{groups.length > 1 ? `${groups.length} parts` : ''}</span>
      </div>
      {faces.length > 0 ? <p className="vector-panel__hint">Use the paint bucket (B) to switch regions on or off.</p> : null}
      {active && activeId ? (
        <>
          <div className="vector-panel__row">
            <span className="vector-panel__meta">Node · {incident.length} {incident.length === 1 ? 'segment' : 'segments'}</span>
          </div>
          <div className="vector-field-grid">
            <NumberField label="X" value={round(active.point.x)} min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(x) => applyEdit(moveNodes(element, world, [activeId], { x: x - active.point.x, y: 0 }))} {...gesture} />
            <NumberField label="Y" value={round(active.point.y)} min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(y) => applyEdit(moveNodes(element, world, [activeId], { x: 0, y: y - active.point.y }))} {...gesture} />
          </div>
          <SelectField
            label="Handles"
            value={smooth ? (active.handles ?? 'mirrored') : 'corner'}
            options={[{ value: 'corner', label: 'Corner' }, { value: 'mirrored', label: 'Mirror' }, { value: 'asymmetric', label: 'Angle' }, { value: 'independent', label: 'Free' }]}
            onChange={(value) => {
              if (value === 'corner') {
                if (smooth) applyEdit(toggleNodeSmooth(element, world, activeId), [activeId])
                return
              }
              const mode = value as 'mirrored' | 'asymmetric' | 'independent'
              if (!smooth) {
                const smoothed = toggleNodeSmooth(element, world, activeId)
                const next = { ...element, ...smoothed, kind: 'path' as const }
                applyEdit(setHandleMode(next, worldNetwork(next), activeId, mode), [activeId])
              } else {
                applyEdit(setHandleMode(element, world, activeId, mode), [activeId])
              }
            }}
          />
          {!smooth && incident.length === 2 ? (
            <NumberField label="Corner radius" value={active.radius ?? 0} min={0} max={1000} step={1} unit="px" variant="field" onChange={(radius) => onUpdate(element.id, { kind: 'path', network: { ...(element.network ?? normalizeWorld(world).network), nodes: (element.network ?? normalizeWorld(world).network).nodes.map((node) => node.id === activeId ? { ...node, radius: radius > 0 ? radius : undefined } : node) } })} {...gesture} />
          ) : null}
        </>
      ) : tool === 'node' ? (
        <p className="vector-panel__hint">{selectedNodeIds.length > 1 ? `${selectedNodeIds.length} nodes selected` : 'Select a node to edit it. Double-click a node to toggle corner and smooth; double-click a segment to add a node; ⌘-drag a segment to bend it.'}</p>
      ) : (
        <p className="vector-panel__hint">Press Enter or double-click the shape to edit nodes.</p>
      )}
      {tool === 'node' && canConnect ? (
        <div className="vector-panel__actions">
          <Button variant="quiet" size="sm" data-action="join" onClick={() => applyEdit(connectNodes(element, world, pair![0]!, pair![1]!), [])}>Connect · ⌘J</Button>
        </div>
      ) : null}
      {groups.length > 1 && tool !== 'node' ? (
        <div className="vector-panel__actions">
          <Button variant="quiet" size="sm" onClick={separate}>Separate parts</Button>
        </div>
      ) : null}
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
  if (element.network && element.kind !== 'path') return `${element.kind === 'ellipse' ? 'Ellipse' : 'Rectangle'} · edited`
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
