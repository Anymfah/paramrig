import { useState, type ReactNode } from 'react'
import { StatusMessage } from '@/ui/StatusMessage'
import { IconTrash } from '@/ui/icons'
import { Button, IconButton } from '@/ui/Button'
import { ColorField } from '@/ui/ColorField'
import { IconAlignBottom, IconAlignCenterH, IconAlignCenterV, IconAlignLeft, IconAlignRight, IconAlignTop, IconDistributeH, IconDistributeV } from '@/ui/icons'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { SwitchField } from '@/ui/SwitchField'
import { SliderField } from '@/ui/SliderField'
import { AdjustmentsPanel, BlendPanel, EffectsPanel } from '@/vector/VectorEffectsPanel'
import { PaintList, type PaintPalette } from '@/vector/VectorPaintPanel'
import { linkedStyle, styleUsage } from '@/vector/styles'
import { fillsOf, fillsPatch, strokesOf, strokesPatch, summaryColor } from '@/vector/paints'
import { cornerRadii } from '@/vector/corners'
import { booleanOperation, flattenElement, outlineStroke, type BooleanOperation } from '@/vector/booleans'
import { booleanLabel, BOOLEAN_OPERATIONS } from '@/vector/booleanGroups'
import { Tooltip } from '@/ui/Tooltip'
import { alignElements, distributeElements, type AlignMode, type DistributeAxis, type ElementPatch } from '@/vector/align'
import { createVectorElement } from '@/vector/document'
import { FRAME_CUSTOM, FRAME_PRESETS, framePresetBounds, matchFramePreset } from '@/vector/frames'
import { canOutline, canvasMeasure, resizeTextPatch, textProperties, TEXT_FACES, TEXT_WEIGHTS } from '@/vector/text'
import { outlineText } from '@/vector/textOutline'
import { commitWorld, components, connectNodes, mergeNetworks, moveHandle, moveNodes, normalizeWorld, setHandleMode, toggleNodeSmooth, worldNetwork, type AbsNetwork } from '@/vector/network'
import { alignPoints, distributePoints, handleFromPolar, handlePolar, moveNodesTo } from '@/vector/nodeEdit'
import { isFullCrop, resetCropBox } from '@/vector/crop'
import { arcProperties, isFullEllipse, MAX_SIDES, MIN_SIDES, polygonProperties } from '@/vector/shapes'
import { withShortcut } from '@/vector/commands'
import { countedLabel, historyRows, type HistoryStep } from '@/vector/history'
import { computeFaces } from '@/vector/planar'
import { MAX_DOCUMENT_SIZE } from '@/vector/document'
import { selectionBounds, type Bounds } from '@/vector/geometry'
import { scaleElementsToBounds } from '@/vector/transform'
import { leafElements } from '@/vector/tree'
import type { VectorDocument, VectorElement, VectorPaint, VectorStyle, VectorStyleKind, VectorTool } from '@/vector/types'

import type { DocumentPatch } from '@/vector/useVectorDocument'

type VectorInspectorProps = {
  document: VectorDocument
  tool: VectorTool
  selectedElements: VectorElement[]
  selectedNodeIds: string[]
  onRenameDocument: (name: string) => void
  onUpdateDocument: (patch: DocumentPatch, record?: boolean) => void
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  onUpdateElements: (updates: ElementPatch[], record?: boolean, label?: string) => void
  onEditElements: (edit: (elements: VectorElement[]) => VectorElement[], record?: boolean, label?: string) => void
  onSelectIds: (ids: string[]) => void
  onSelectNodes: (ids: string[]) => void
  historyDepth: number
  historySteps: HistoryStep[]
  historyIndex: number
  onGoToStep?: (index: number) => void
  onSaveVersion: (name: string) => void
  onRestoreVersion: (id: string) => void
  onDeleteVersion: (id: string) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  onGestureCancel: () => void
  /** Autosave state shown in the header, and the message when a write failed. */
  saveBadge?: ReactNode
  saveMessage?: string | null
  palette?: PaintPalette
  /** Creates a named style from what the selection currently paints. */
  onCreateStyle?: (kind: VectorStyleKind, source: VectorElement) => void
  /** Repaints the selection from a style, or cuts the link when the id is null. */
  onLinkStyle?: (kind: VectorStyleKind, styleId: string | null) => void
  /** Writes a paint edit back to the style the selection follows. */
  onUpdateStyle?: (styleId: string, paints: VectorPaint[], record?: boolean) => void
  onRenameStyle?: (styleId: string, name: string) => void
  onDeleteStyle?: (styleId: string) => void
  /** Opens crop editing on an image, the way a double-click does. */
  onCropImage?: (id: string) => void
  /** Wraps the given shapes in a boolean group. */
  onBooleanGroup?: (operation: BooleanOperation, ids: string[]) => void
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
  historySteps,
  historyIndex,
  onGoToStep,
  onSaveVersion,
  onRestoreVersion,
  onDeleteVersion,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
  saveBadge,
  saveMessage,
  palette,
  onCreateStyle,
  onLinkStyle,
  onUpdateStyle,
  onRenameStyle,
  onDeleteStyle,
  onCropImage,
  onBooleanGroup,
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
  /** Wraps the selection in a boolean group, which keeps every shape editable underneath. */
  const runBoolean = (operation: BooleanOperation) => {
    if (combinable.length < 2) return
    const ordered = [...combinable].sort((a, b) => document.elements.indexOf(a) - document.elements.indexOf(b))
    onBooleanGroup?.(operation, ordered.map((element) => element.id))
  }

  const flattenBoolean = (operation: BooleanOperation) => {
    if (combinable.length < 2) return
    const ordered = [...combinable].sort((a, b) => document.elements.indexOf(a) - document.elements.indexOf(b))
    replaceWithPath(ordered, booleanOperation(operation, ordered), booleanLabel(operation))
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
  const outlineTextElement = async () => {
    const target = single
    if (!target || target.kind !== 'text') return
    const geometry = await outlineText(target)
    if (!geometry) return
    onUpdate(target.id, {
      ...geometry,
      kind: 'path',
      rotation: 0,
      text: undefined,
      fontFamily: undefined,
      fontSize: undefined,
      fontWeight: undefined,
      lineHeight: undefined,
      letterSpacing: undefined,
      textAlign: undefined,
      textSizing: undefined,
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
        {saveBadge}
      </div>
      <div className="vector-inspector__body scroll-area">
        {saveMessage ? <div className="vector-inspector__notice"><StatusMessage tone="error">{saveMessage}</StatusMessage></div> : null}
        {selectedElements.length === 0 ? (
          <>
            <section className="vector-panel vector-panel--document" aria-label="Page properties">
              <h2 className="vector-panel__title">Page</h2>
              <div className="vector-field-grid">
                <NumberField label="W" value={document.width} min={1} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(width) => onUpdateDocument({ width: Math.round(width) })} {...gesture} />
                <NumberField label="H" value={document.height} min={1} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(height) => onUpdateDocument({ height: Math.round(height) })} {...gesture} />
              </div>
              <ColorField
                label="Background"
                value={document.background}
                recent={palette?.recent}
                swatches={palette?.swatches}
                onAddSwatch={palette?.onAddSwatch}
                onRemoveSwatch={palette?.onRemoveSwatch}
                onColorUsed={palette?.onColorUsed}
                onChange={(background) => onUpdateDocument({ background })}
                {...gesture}
              />
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
            <StylesPanel styles={document.styles ?? []} elements={document.elements} onRename={onRenameStyle} onDelete={onDeleteStyle} />
            <section className="vector-panel" aria-label="History">
              <div className="vector-panel__row">
                <h2 className="vector-panel__title">History</h2>
                <span className="vector-panel__meta">{historyDepth === 0 ? 'Nothing to undo' : `${historyDepth} ${historyDepth === 1 ? 'step' : 'steps'} to undo`}</span>
              </div>
              <form className="vector-version-form" onSubmit={(event) => { event.preventDefault(); onSaveVersion(versionName); setVersionName('') }}>
                <input className="vector-version-form__input" aria-label="Version name" placeholder="Version name" value={versionName} maxLength={80} onChange={(event) => setVersionName(event.currentTarget.value)} />
                <Tooltip content="Keep a named copy of every object and guide"><Button variant="quiet" size="sm" type="submit">Save version</Button></Tooltip>
              </form>
              <ol className="vector-history" aria-label="History steps">
                {historyRows(historySteps, historyIndex, document.versions ?? []).map((row) => (
                  row.kind === 'step' ? (
                    <li key={`step-${row.index}`}>
                      <button
                        type="button"
                        className="vector-history__step"
                        data-current={row.current || undefined}
                        data-undone={row.undone || undefined}
                        data-step={row.index}
                        aria-current={row.current || undefined}
                        onClick={() => onGoToStep?.(row.index)}
                      >
                        <span className="vector-history__dot" aria-hidden="true" />
                        <span className="vector-history__label">{row.label}</span>
                        <span className="vector-history__time">{formatStepTime(row.at)}</span>
                      </button>
                    </li>
                  ) : (
                    <li key={`version-${row.id}`} className="vector-history__version">
                      <span className="vector-history__dot vector-history__dot--version" aria-hidden="true" />
                      <span className="vector-history__label">{row.label}</span>
                      <Button variant="quiet" size="sm" onClick={() => onRestoreVersion(row.id)}>Restore</Button>
                      <Tooltip content="Delete version">
                        <IconButton label={`Delete version ${row.label}`} onClick={() => onDeleteVersion(row.id)}><IconTrash /></IconButton>
                      </Tooltip>
                    </li>
                  )
                ))}
              </ol>
              <p className="vector-panel__hint">Click a step to go back to it, or forward again. Saved versions sit in the same list and keep a copy of every object and guide.</p>
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
            <AppearancePanel
              elements={selectedElements}
              leaves={leaves}
              styles={document.styles ?? []}
              palette={palette}
              onUpdate={onUpdate}
              onUpdateElements={onUpdateElements}
              onCreateStyle={onCreateStyle}
              onLinkStyle={onLinkStyle}
              onUpdateStyle={onUpdateStyle}
              gesture={gesture}
            />
            {single && single.kind === 'boolean' ? (
              <section className="vector-panel" aria-label="Boolean">
                <div className="vector-panel__row">
                  <h2 className="vector-panel__title">Boolean</h2>
                  <span className="vector-panel__meta">{document.elements.filter((element) => element.parentId === single.id).length} shapes</span>
                </div>
                <SelectField
                  label="Operation"
                  value={single.operation ?? 'unite'}
                  options={BOOLEAN_OPERATIONS.map((operation) => ({ value: operation, label: booleanLabel(operation) }))}
                  onChange={(value) => onUpdate(single.id, { operation: value as BooleanOperation }, true, 'Change the boolean')}
                />
                <div className="vector-panel__actions">
                  <Tooltip content="Replace the group with the shape it makes">
                    <Button variant="quiet" size="sm" data-action="flatten-boolean" onClick={() => onUpdate(single.id, { kind: 'path', operation: undefined }, true, 'Flatten the boolean')}>Flatten</Button>
                  </Tooltip>
                </div>
                <p className="vector-panel__hint">The shapes underneath stay editable: double-click to go in.</p>
              </section>
            ) : null}
            {single && single.kind === 'polygon' && !single.network ? (
              <PolygonPanel element={single} onUpdate={onUpdate} gesture={gesture} />
            ) : null}
            {single && single.kind === 'ellipse' && !single.network ? (
              <ArcPanel element={single} onUpdate={onUpdate} gesture={gesture} />
            ) : null}
            {single && single.kind === 'image' ? (
              <ImagePanel element={single} onUpdate={onUpdate} onCrop={onCropImage} />
            ) : null}
            {single && single.kind === 'frame' ? (
              <FramePanel element={single} onUpdate={onUpdate} onUpdateElements={onUpdateElements} elements={document.elements} />
            ) : null}
            {single && single.kind === 'text' ? (
              <TextPanel element={single} onUpdate={onUpdate} onOutline={outlineTextElement} gesture={gesture} />
            ) : null}
            {single && single.kind !== 'group' && single.kind !== 'text' && single.kind !== 'frame' && single.kind !== 'image' ? (
              <PathPanel element={single} tool={tool} selectedNodeIds={selectedNodeIds} onUpdate={onUpdate} onEditElements={onEditElements} onSelectIds={onSelectIds} onSelectNodes={onSelectNodes} gesture={gesture} />
            ) : null}
            {combinable.length > 1 ? (
              <section className="vector-panel" aria-label="Paths">
                <div className="vector-panel__row">
                  <h2 className="vector-panel__title">Paths</h2>
                  <span className="vector-panel__meta">{combinable.length} shapes</span>
                </div>
                <div className="vector-panel__actions">
                  <Tooltip content="Merge the shapes into one"><Button variant="quiet" size="sm" onClick={() => runBoolean('unite')}>Union</Button></Tooltip>
                  <Tooltip content="Cut the shapes above out of the bottom one"><Button variant="quiet" size="sm" onClick={() => runBoolean('subtract')}>Subtract</Button></Tooltip>
                  <Tooltip content="Keep only what the shapes have in common"><Button variant="quiet" size="sm" onClick={() => runBoolean('intersect')}>Intersect</Button></Tooltip>
                  <Tooltip content="Keep everything but the overlap"><Button variant="quiet" size="sm" onClick={() => runBoolean('exclude')}>Exclude</Button></Tooltip>
                </div>
                <div className="vector-panel__actions">
                  <Tooltip content={withShortcut('Keep every sub-path in one object', 'combine')}><Button variant="quiet" size="sm" data-action="combine" onClick={combine}>Combine</Button></Tooltip>
                  <Tooltip content="Unite the shapes into one path, losing the originals"><Button variant="quiet" size="sm" data-action="flatten-union" onClick={() => flattenBoolean('unite')}>Union (flatten)</Button></Tooltip>
                  <Tooltip content="Unite the shapes into a single outline"><Button variant="quiet" size="sm" data-action="flatten" onClick={flatten}>Flatten</Button></Tooltip>
                </div>
                <p className="vector-panel__hint">Booleans use the bottom object as the base. Combine keeps every sub-path; Flatten unites them.</p>
              </section>
            ) : single && single.kind !== 'group' && single.kind !== 'text' && single.kind !== 'frame' && single.kind !== 'image' && (single.strokeWidth > 0 || single.network) ? (
              <section className="vector-panel" aria-label="Geometry operations">
                <div className="vector-panel__actions">
                  {single.strokeWidth > 0 && single.stroke !== 'none' ? <Tooltip content="Turn the stroke into a filled shape"><Button variant="quiet" size="sm" data-action="outline-stroke" onClick={outline}>Outline stroke</Button></Tooltip> : null}
                  {single.network ? <Button variant="quiet" size="sm" data-action="flatten" onClick={flatten}>Flatten</Button> : null}
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

function AppearancePanel({ elements, leaves, styles, palette, onUpdate, onUpdateElements, onCreateStyle, onLinkStyle, onUpdateStyle, gesture }: {
  elements: VectorElement[]
  leaves: VectorElement[]
  styles: VectorStyle[]
  palette?: PaintPalette
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  onUpdateElements: (updates: ElementPatch[], record?: boolean, label?: string) => void
  onCreateStyle?: (kind: VectorStyleKind, source: VectorElement) => void
  onLinkStyle?: (kind: VectorStyleKind, styleId: string | null) => void
  onUpdateStyle?: (styleId: string, paints: VectorPaint[], record?: boolean) => void
  gesture: { onGestureStart: () => void; onGestureEnd: () => void; onGestureCancel: () => void }
}) {
  const single = elements.length === 1 && elements[0]!.kind !== 'group' ? elements[0]! : null
  const targets = single ? [single] : leaves
  if (targets.length === 0) return null
  const first = targets[0]!
  const same = (key: 'fill' | 'stroke' | 'strokeWidth' | 'opacity') => targets.every((element) => element[key] === first[key])
  const apply = (patch: Partial<VectorElement>, record?: boolean, label = 'Change appearance') => {
    if (single) onUpdate(single.id, patch, record, label)
    else onUpdateElements(targets.map((element) => ({ id: element.id, patch })), record, label)
  }
  const groupOpacity = !single && elements.length === 1 && elements[0]!.kind === 'group' ? elements[0]! : null
  const fills = fillsOf(first)
  const strokes = strokesOf(first)
  const fillStyle = linkedStyle(styles, first, 'fill')
  const strokeStyle = linkedStyle(styles, first, 'stroke')
  const effectStyle = linkedStyle(styles, first, 'effect')
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
        <PaintList
          label="Fill"
          paints={fills}
          mixed={fillsMixed}
          palette={palette}
          header={<StyleLink kind="fill" styles={styles} linked={fillStyle} source={first} onCreateStyle={onCreateStyle} onLinkStyle={onLinkStyle} />}
          onChange={(paints, record) => {
            // A linked paint edits its style, which repaints every object that follows it.
            if (fillStyle && onUpdateStyle) onUpdateStyle(fillStyle.id, paints, record)
            else apply(fillsPatch(paints), record, 'Change fill')
          }}
          gesture={gesture}
        />
        <PaintList
          label="Stroke"
          paints={strokes}
          mixed={strokesMixed}
          palette={palette}
          header={<StyleLink kind="stroke" styles={styles} linked={strokeStyle} source={first} onCreateStyle={onCreateStyle} onLinkStyle={onLinkStyle} />}
          onChange={(paints, record) => {
            if (strokeStyle && onUpdateStyle) onUpdateStyle(strokeStyle.id, paints, record)
            else apply(strokesPatch(paints), record, 'Change stroke')
          }}
          gesture={gesture}
        />
        {groupOpacity ? (
          <NumberField label="Opacity" value={Math.round(groupOpacity.opacity * 100)} min={0} max={100} step={1} unit="%" variant="field" onChange={(opacity) => onUpdate(groupOpacity.id, { opacity: opacity / 100 })} {...gesture} />
        ) : (
          <NumberField label="Opacity" value={Math.round(first.opacity * 100)} min={0} max={100} step={1} unit="%" variant="field" onChange={(opacity) => apply({ opacity: opacity / 100 })} {...gesture} />
        )}
        {!single && (!same('strokeWidth') || !same('opacity')) ? <p className="vector-panel__hint">Mixed values show the first object. Editing applies to all.</p> : null}
      </section>
      <EffectsPanel
        effects={first.effects ?? []}
        mixed={targets.some((element) => JSON.stringify(element.effects ?? []) !== JSON.stringify(first.effects ?? []))}
        palette={palette}
        header={<StyleLink kind="effect" styles={styles} linked={effectStyle} source={first} onCreateStyle={onCreateStyle} onLinkStyle={onLinkStyle} />}
        onChange={(effects, record) => apply({ effects: effects.length ? effects : undefined }, record, 'Change effects')}
        gesture={gesture}
      />
      <BlendPanel
        mode={first.blendMode ?? 'normal'}
        opacity={groupOpacity ? groupOpacity.opacity : first.opacity}
        onChangeMode={(blendMode) => apply({ blendMode: blendMode === 'normal' ? undefined : blendMode }, true, 'Change blend mode')}
        onChangeOpacity={(opacity) => groupOpacity ? onUpdate(groupOpacity.id, { opacity }) : apply({ opacity })}
        gesture={gesture}
      />
      {single && single.kind === 'image' ? (
        <AdjustmentsPanel element={single} onChange={(adjustments, record) => onUpdate(single.id, { adjustments }, record, 'Adjust picture')} gesture={gesture} />
      ) : null}
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
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
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
  const applyWorld = (next: AbsNetwork, label = 'Edit nodes') => onUpdate(element.id, { ...commitWorld(element, next), kind: 'path' }, true, label)
  const picked = world.nodes.filter((node) => selectedNodeIds.includes(node.id))
  const alignNodes = (mode: AlignMode) => {
    if (picked.length < 2) return
    const moved = alignPoints(picked.map((node) => node.point), mode)
    applyWorld(moveNodesTo(world, new Map(picked.map((node, index) => [node.id, moved[index]!]))), countedLabel('Align', picked.length, 'node'))
  }
  const distributeNodes = (axis: DistributeAxis) => {
    if (picked.length < 3) return
    const moved = distributePoints(picked.map((node) => node.point), axis)
    applyWorld(moveNodesTo(world, new Map(picked.map((node, index) => [node.id, moved[index]!]))), countedLabel('Distribute', picked.length, 'node'))
  }
  const handles = active
    ? incident.flatMap((segment) => {
      const end = segment.a === active.id ? 'a' : 'b'
      const point = end === 'a' ? segment.ah : segment.bh
      return point ? [{ segmentId: segment.id, end: end as 'a' | 'b', point }] : []
    })
    : []
  const setHandle = (handle: { segmentId: string; end: 'a' | 'b' }, length: number, angle: number) => {
    if (!active) return
    onUpdate(element.id, { ...moveHandle(element, world, handle.segmentId, handle.end, handleFromPolar(active.point, Math.max(0, length), angle)), kind: 'path' }, true, 'Move handle')
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
      {tool === 'node' && picked.length > 1 ? (
        <div className="vector-nodes-align" aria-label="Align nodes">
          <div className="vector-panel__row">
            <span className="vector-panel__subtitle">Align {picked.length} nodes</span>
          </div>
          <div className="vector-align">
            <AlignButton label="Align left" onClick={() => alignNodes('left')}><IconAlignLeft /></AlignButton>
            <AlignButton label="Align centres horizontally" onClick={() => alignNodes('centerX')}><IconAlignCenterH /></AlignButton>
            <AlignButton label="Align right" onClick={() => alignNodes('right')}><IconAlignRight /></AlignButton>
            <AlignButton label="Align top" onClick={() => alignNodes('top')}><IconAlignTop /></AlignButton>
            <AlignButton label="Align centres vertically" onClick={() => alignNodes('centerY')}><IconAlignCenterV /></AlignButton>
            <AlignButton label="Align bottom" onClick={() => alignNodes('bottom')}><IconAlignBottom /></AlignButton>
          </div>
          {picked.length > 2 ? (
            <div className="vector-align">
              <AlignButton label="Distribute horizontally" onClick={() => distributeNodes('x')}><IconDistributeH /></AlignButton>
              <AlignButton label="Distribute vertically" onClick={() => distributeNodes('y')}><IconDistributeV /></AlignButton>
            </div>
          ) : null}
        </div>
      ) : null}
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
          {handles.map((handle, index) => {
            const polar = handlePolar(active.point, handle.point)
            return (
              <div key={`${handle.segmentId}-${handle.end}`} className="vector-handle-fields">
                <span className="vector-panel__subtitle">Handle {index + 1}</span>
                <div className="vector-field-grid">
                  <NumberField
                    label="Length"
                    value={round(polar.length)}
                    min={0}
                    max={MAX_DOCUMENT_SIZE}
                    step={1}
                    unit="px"
                    variant="field"
                    onChange={(length) => setHandle(handle, length, polar.angle)}
                    {...gesture}
                  />
                  <NumberField
                    label="Angle"
                    value={round(polar.angle)}
                    min={-360}
                    max={360}
                    step={1}
                    unit="°"
                    variant="field"
                    onChange={(angle) => setHandle(handle, polar.length, angle)}
                    {...gesture}
                  />
                </div>
              </div>
            )
          })}
          {!smooth && incident.length === 2 ? (
            <NumberField label="Corner radius" value={active.radius ?? 0} min={0} max={1000} step={1} unit="px" variant="field" onChange={(radius) => onUpdate(element.id, { kind: 'path', network: { ...(element.network ?? normalizeWorld(world).network), nodes: (element.network ?? normalizeWorld(world).network).nodes.map((node) => node.id === activeId ? { ...node, radius: radius > 0 ? radius : undefined } : node) } })} {...gesture} />
          ) : null}
        </>
      ) : tool === 'node' ? (
        <p className="vector-panel__hint">{selectedNodeIds.length > 1
          ? 'Shift a handle to hold it to 15°. ⌥-click a region to select the nodes around it.'
          : 'Select a node to edit it. Double-click a node to toggle corner and smooth; double-click a segment to add a node; ⌘-drag a segment to bend it; ⌥-click a region to select its nodes.'}</p>
      ) : (
        <p className="vector-panel__hint">Press Enter or double-click the shape to edit nodes.</p>
      )}
      {tool === 'node' && canConnect ? (
        <div className="vector-panel__actions">
          <Tooltip content={withShortcut('Join the two selected nodes', 'join')}><Button variant="quiet" size="sm" data-action="join" onClick={() => applyEdit(connectNodes(element, world, pair![0]!, pair![1]!), [])}>Connect</Button></Tooltip>
        </div>
      ) : null}
      {groups.length > 1 && tool !== 'node' ? (
        <div className="vector-panel__actions">
          <Tooltip content="Split each disconnected part into its own object"><Button variant="quiet" size="sm" onClick={separate}>Separate parts</Button></Tooltip>
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

function PolygonPanel({ element, onUpdate, gesture }: {
  element: VectorElement
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  gesture: { onGestureStart: () => void; onGestureEnd: () => void; onGestureCancel: () => void }
}) {
  const { sides, innerRatio } = polygonProperties(element)
  return (
    <section className="vector-panel" aria-label="Polygon">
      <div className="vector-panel__row">
        <h2 className="vector-panel__title">Polygon</h2>
        <span className="vector-panel__meta">{innerRatio > 0 ? 'Star' : 'Regular'}</span>
      </div>
      <NumberField label="Sides" value={sides} min={MIN_SIDES} max={MAX_SIDES} step={1} variant="field" onChange={(value) => onUpdate(element.id, { sides: Math.round(value) }, true, 'Change sides')} {...gesture} />
      <NumberField label="Star points" value={Math.round(innerRatio * 100)} min={0} max={100} step={1} unit="%" variant="field" onChange={(value) => onUpdate(element.id, { innerRatio: value / 100 }, true, 'Change star points')} {...gesture} />
      <p className="vector-panel__hint">Drag the point at the top to change the sides, the inner one to pull the star in. Editing a node freezes the shape.</p>
    </section>
  )
}

function ArcPanel({ element, onUpdate, gesture }: {
  element: VectorElement
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  gesture: { onGestureStart: () => void; onGestureEnd: () => void; onGestureCancel: () => void }
}) {
  const arc = arcProperties(element)
  const full = isFullEllipse(arc)
  const apply = (patch: Partial<VectorElement>, label: string) => onUpdate(element.id, { arcStart: arc.start, arcSweep: arc.sweep, arcRatio: arc.ratio, ...patch }, true, label)
  return (
    <section className="vector-panel" aria-label="Arc">
      <div className="vector-panel__row">
        <h2 className="vector-panel__title">Arc</h2>
        <span className="vector-panel__meta">{full ? 'Whole ellipse' : arc.ratio > 0 ? 'Ring' : 'Sector'}</span>
      </div>
      <div className="vector-field-grid">
        <NumberField label="Start" value={round(arc.start)} min={0} max={360} step={1} unit="°" variant="field" onChange={(value) => apply({ arcStart: value }, 'Change arc')} {...gesture} />
        <NumberField label="Sweep" value={round(arc.sweep)} min={-360} max={360} step={1} unit="°" variant="field" onChange={(value) => apply({ arcSweep: value }, 'Change arc')} {...gesture} />
      </div>
      <NumberField label="Inner radius" value={Math.round(arc.ratio * 100)} min={0} max={99} step={1} unit="%" variant="field" onChange={(value) => apply({ arcRatio: value / 100 }, 'Change ring')} {...gesture} />
      {full ? null : (
        <div className="vector-panel__actions">
          <Tooltip content="Close the slice back into a whole ellipse">
            <Button variant="quiet" size="sm" data-action="reset-arc" onClick={() => onUpdate(element.id, { arcStart: undefined, arcSweep: undefined, arcRatio: undefined }, true, 'Whole ellipse')}>Whole ellipse</Button>
          </Tooltip>
        </div>
      )}
      <p className="vector-panel__hint">Drag the points on the edge for the ends of the slice, the inner one for the hole.</p>
    </section>
  )
}

function ImagePanel({ element, onUpdate, onCrop }: {
  element: VectorElement
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  onCrop?: (id: string) => void
}) {
  const cropped = !isFullCrop(element.crop)
  const natural = element.imageWidth && element.imageHeight ? `${element.imageWidth} × ${element.imageHeight}` : 'Unknown size'
  const box = { x: element.x, y: element.y, width: element.width, height: element.height }
  return (
    <section className="vector-panel" aria-label="Image">
      <div className="vector-panel__row">
        <h2 className="vector-panel__title">Image</h2>
        <span className="vector-panel__meta">{natural}{cropped ? ' · cropped' : ''}</span>
      </div>
      <SelectField
        label="Rendering"
        value={element.imageRendering ?? 'smooth'}
        options={[{ value: 'smooth', label: 'Smooth' }, { value: 'pixelated', label: 'Pixelated' }]}
        onChange={(value) => onUpdate(element.id, { imageRendering: value === 'pixelated' ? 'pixelated' : undefined })}
      />
      <div className="vector-panel__actions">
        <Tooltip content="Crop the picture · double-click it on the canvas"><Button variant="quiet" size="sm" data-action="crop-image" onClick={() => onCrop?.(element.id)}>Crop</Button></Tooltip>
        {cropped ? (
          <Button
            variant="quiet"
            size="sm"
            data-action="reset-crop"
            onClick={() => onUpdate(element.id, { ...roundBox(resetCropBox(box, element.crop!)), crop: undefined })}
          >Show whole image</Button>
        ) : null}
      </div>
      <p className="vector-panel__hint">Double-click the picture to crop it. Resizing keeps its shape unless Shift is held.</p>
    </section>
  )
}

function formatStepTime(at: number): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime()) || at === 0) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function roundBox(box: { x: number; y: number; width: number; height: number }) {
  return { x: round(box.x), y: round(box.y), width: Math.max(1, round(box.width)), height: Math.max(1, round(box.height)) }
}

function FramePanel({ element, elements, onUpdate, onUpdateElements }: {
  element: VectorElement
  elements: VectorElement[]
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  onUpdateElements: (updates: ElementPatch[], record?: boolean, label?: string) => void
}) {
  const preset = matchFramePreset(element.width, element.height)
  const children = leafElements(elements, [element.id]).filter((leaf) => leaf.id !== element.id)
  const applyPreset = (value: string) => {
    const found = FRAME_PRESETS.find((item) => item.value === value)
    if (!found) return
    const bounds = framePresetBounds(element, found)
    // The frame's own children ride along so the layout inside it survives the resize.
    onUpdateElements([
      { id: element.id, patch: bounds },
      ...children.map((child) => ({ id: child.id, patch: { x: child.x + bounds.x - element.x, y: child.y + bounds.y - element.y } })),
    ])
  }
  return (
    <section className="vector-panel" aria-label="Frame">
      <div className="vector-panel__row">
        <h2 className="vector-panel__title">Frame</h2>
        <span className="vector-panel__meta">{children.length === 0 ? 'Empty' : `${children.length} ${children.length === 1 ? 'object' : 'objects'}`}</span>
      </div>
      <SelectField
        label="Size"
        value={preset}
        options={[{ value: FRAME_CUSTOM, label: 'Custom' }, ...FRAME_PRESETS.map((item) => ({ value: item.value, label: `${item.label} · ${item.width} × ${item.height}` }))]}
        onChange={applyPreset}
      />
      <SwitchField label="Clip content" checked={element.clipContent !== false} onChange={(clipContent) => onUpdate(element.id, { clipContent })} />
      <p className="vector-panel__hint">A frame keeps its own box and exports at its own size. Drop layers onto it to put them inside.</p>
    </section>
  )
}

/** Every named style in the document, with what uses it. */
function StylesPanel({ styles, elements, onRename, onDelete }: {
  styles: VectorStyle[]
  elements: VectorElement[]
  onRename?: (styleId: string, name: string) => void
  onDelete?: (styleId: string) => void
}) {
  if (styles.length === 0) return null
  return (
    <section className="vector-panel" aria-label="Styles">
      <div className="vector-panel__row">
        <h2 className="vector-panel__title">Styles</h2>
        <span className="vector-panel__meta">{styles.length} {styles.length === 1 ? 'style' : 'styles'}</span>
      </div>
      <ul className="vector-styles">
        {styles.map((style) => {
          const usage = styleUsage(elements, style)
          return (
            <li key={style.id} className="vector-styles__row">
              <span
                className="vector-styles__chip"
                data-kind={style.kind}
                // An effect style has no paint to show, so it gets a plain chip rather than an empty one.
                style={{ background: style.kind === 'effect' ? 'var(--vector-guide)' : summaryColor(style.paints) }}
                aria-hidden="true"
              />
              <input
                className="vector-styles__name"
                defaultValue={style.name}
                key={style.name}
                aria-label={`${style.name} name`}
                spellCheck={false}
                onBlur={(event) => onRename?.(style.id, event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') { event.currentTarget.value = style.name; event.currentTarget.blur() }
                }}
              />
              <span className="vector-styles__meta">{style.kind === 'fill' ? 'Fill' : 'Stroke'} · {usage}</span>
              <Tooltip content={usage > 0 ? `Delete and detach ${usage} ${usage === 1 ? 'object' : 'objects'}` : 'Delete style'}>
                <IconButton label={`Delete ${style.name}`} onClick={() => onDelete?.(style.id)}><IconTrash /></IconButton>
              </Tooltip>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The style a paint follows: pick one, make one from what is painted, or cut the link. */
function StyleLink({ kind, styles, linked, source, onCreateStyle, onLinkStyle }: {
  kind: VectorStyleKind
  styles: VectorStyle[]
  linked: VectorStyle | null
  source: VectorElement
  onCreateStyle?: (kind: VectorStyleKind, source: VectorElement) => void
  onLinkStyle?: (kind: VectorStyleKind, styleId: string | null) => void
}) {
  if (!onLinkStyle && !onCreateStyle) return null
  const options = styles.filter((style) => style.kind === kind)
  // With nothing to pick from, the list would be an empty control: offer only the way in.
  if (options.length === 0 && !linked) {
    return (
      <div className="vector-style-link__actions">
        <Button variant="quiet" size="sm" data-action={`create-${kind}-style`} onClick={() => onCreateStyle?.(kind, source)}>Create style</Button>
      </div>
    )
  }
  return (
    <div className="vector-style-link">
      <SelectField
        label="Style"
        value={linked?.id ?? ''}
        options={[{ value: '', label: 'No style' }, ...options.map((style) => ({ value: style.id, label: style.name }))]}
        onChange={(value) => onLinkStyle?.(kind, value || null)}
      />
      <div className="vector-style-link__actions">
        {linked ? (
          <Button variant="quiet" size="sm" data-action={`detach-${kind}-style`} onClick={() => onLinkStyle?.(kind, null)}>Detach</Button>
        ) : (
          <Button variant="quiet" size="sm" data-action={`create-${kind}-style`} onClick={() => onCreateStyle?.(kind, source)}>Create style</Button>
        )}
      </div>
      {linked ? <p className="vector-panel__hint">Editing this {kind} updates “{linked.name}” everywhere it is used.</p> : null}
    </div>
  )
}

function TextPanel({ element, onUpdate, onOutline, gesture }: {
  element: VectorElement
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  onOutline: () => Promise<void>
  gesture: { onGestureStart: () => void; onGestureEnd: () => void; onGestureCancel: () => void }
}) {
  const properties = textProperties(element)
  const apply = (patch: Partial<VectorElement>, record?: boolean) => onUpdate(element.id, resizeTextPatch(element, patch, canvasMeasure), record, 'Change text style')
  const outlineable = canOutline(properties.fontFamily)
  return (
    <section className="vector-panel" aria-label="Text">
      <div className="vector-panel__row">
        <h2 className="vector-panel__title">Text</h2>
        <span className="vector-panel__meta">{properties.text.split('\n').length} {properties.text.split('\n').length === 1 ? 'line' : 'lines'}</span>
      </div>
      <SelectField
        label="Font"
        value={properties.fontFamily}
        options={TEXT_FACES.map((face) => ({ value: face.value, label: face.label }))}
        onChange={(fontFamily) => apply({ fontFamily })}
      />
      <div className="vector-field-grid">
        <NumberField label="Size" value={properties.fontSize} min={1} max={2000} step={1} unit="px" variant="field" onChange={(fontSize) => apply({ fontSize })} {...gesture} />
        <SelectField
          label="Weight"
          value={String(properties.fontWeight)}
          options={TEXT_WEIGHTS.map((weight) => ({ value: String(weight), label: weightLabel(weight) }))}
          onChange={(value) => apply({ fontWeight: Number(value) })}
        />
      </div>
      <div className="vector-field-grid">
        <NumberField label="Line height" value={properties.lineHeight} min={0.5} max={6} step={0.05} onChange={(lineHeight) => apply({ lineHeight })} variant="field" {...gesture} />
        <NumberField label="Tracking" value={properties.letterSpacing} min={-200} max={200} step={0.5} unit="px" variant="field" onChange={(letterSpacing) => apply({ letterSpacing })} {...gesture} />
      </div>
      <SelectField
        label="Align"
        value={properties.textAlign}
        options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]}
        onChange={(textAlign) => apply({ textAlign: textAlign as VectorElement['textAlign'] })}
      />
      <SelectField
        label="Box"
        value={properties.textSizing}
        options={[{ value: 'auto', label: 'Auto width' }, { value: 'fixed', label: 'Fixed width' }]}
        onChange={(textSizing) => apply({ textSizing: textSizing as VectorElement['textSizing'] })}
      />
      <div className="vector-panel__actions">
        <Tooltip content={outlineable ? 'Convert the letters into editable paths' : `${properties.fontFamily} is a system font, so its glyphs cannot be read`}>
          <span>
            <Button variant="quiet" size="sm" data-action="outline-text" disabled={!outlineable} onClick={() => void onOutline()}>Outline text</Button>
          </span>
        </Tooltip>
      </div>
      <p className="vector-panel__hint">Double-click the text on the canvas to edit it, or press Enter with it selected.</p>
    </section>
  )
}

function weightLabel(weight: number): string {
  if (weight <= 300) return 'Light'
  if (weight === 400) return 'Regular'
  if (weight === 500) return 'Medium'
  if (weight === 600) return 'Semibold'
  return 'Bold'
}

function kindLabel(element: VectorElement): string {
  if (element.network && element.kind !== 'path') return `${element.kind === 'ellipse' ? 'Ellipse' : 'Rectangle'} · edited`
  switch (element.kind) {
    case 'rectangle': return 'Rectangle'
    case 'ellipse': return 'Ellipse'
    case 'path': return 'Path'
    case 'group': return 'Group'
    case 'text': return 'Text'
    case 'frame': return 'Frame'
    case 'image': return 'Image'
    case 'polygon': return 'Polygon'
    case 'boolean': return 'Boolean'
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
