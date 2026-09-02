import { useState, type ReactNode } from 'react'
import { INSPECTOR_TABS, type InspectorTab } from '@/vector/inspectorPrefs'
import { VectorEmpty, VectorSection } from '@/vector/VectorSection'
import { Exposable } from '@/vector/VectorExpose'
import { useSectionState } from '@/vector/useSectionState'

import { createEffect } from '@/vector/effects'
import { IconChevron } from '@/ui/icons'
import { StatusMessage } from '@/ui/StatusMessage'
import { IconTrash } from '@/ui/icons'
import { Button, IconButton } from '@/ui/Button'
import { ColorField } from '@/ui/ColorField'
import { IconAlignBottom, IconAlignCenterH, IconAlignCenterV, IconAlignLeft, IconAlignRight, IconAlignTop, IconDistributeH, IconDistributeV } from '@/ui/icons'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { SwitchField } from '@/ui/SwitchField'
import { BarField } from '@/ui/BarField'
import { AdjustmentsPanel, BlendMode, EffectList, MAX_EFFECTS_PER_ELEMENT } from '@/vector/VectorEffectsPanel'
import { BrushPanel } from '@/vector/VectorBrushPanel'
import { PaintList, type PaintPalette } from '@/vector/VectorPaintPanel'
import { linkedStyle } from '@/vector/styles'
import { addedPaints, fillsOf, fillsPatch, strokesOf, strokesPatch } from '@/vector/paints'
import { cornerRadii } from '@/vector/corners'
import type { BooleanOperation } from '@/vector/booleans'
import { geometryOps } from '@/vector/geometryOps'
import { booleanLabel, BOOLEAN_OPERATIONS } from '@/vector/booleanGroups'
import { Tooltip } from '@/ui/Tooltip'
import { alignElements, distributeElements, type AlignMode, type DistributeAxis, type ElementPatch } from '@/vector/align'
import { createVectorElement } from '@/vector/document'
import { FRAME_CUSTOM, FRAME_PRESETS, framePresetBounds, matchFramePreset } from '@/vector/frames'
import { canOutline, canvasMeasure, resizeTextPatch, textProperties, TEXT_WEIGHTS } from '@/vector/text'
import { outlineText } from '@/vector/textOutline'
import { commitWorld, components, connectNodes, moveHandle, moveNodes, normalizeWorld, setHandleMode, toggleNodeSmooth, worldNetwork, type AbsNetwork } from '@/vector/network'
type Gesture = { onGestureStart: () => void; onGestureEnd: () => void; onGestureCancel: () => void }

const ARROW_OPTIONS = [{ value: 'none', label: 'None' }, { value: 'arrow', label: 'Arrow' }, { value: 'triangle', label: 'Triangle' }, { value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }, { value: 'bar', label: 'Bar' }]
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
import { VectorFontPicker } from '@/vector/VectorFontPicker'
import type { VectorBrush, VectorDocument, VectorElement, VectorFont, VectorFontFeatures, VectorPaint, VectorStyle, VectorStyleKind, VectorTool } from '@/vector/types'

import type { DocumentPatch } from '@/vector/useVectorDocument'

type VectorInspectorProps = {
  document: VectorDocument
  tool: VectorTool
  selectedElements: VectorElement[]
  selectedNodeIds: string[]
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
  /** The message shown when a write to browser storage failed. */
  saveMessage?: string | null
  /** Which of the three tabs is showing, and how to move between them. */
  tab: InspectorTab
  onTab: (tab: InspectorTab) => void
  /** What the Controls tab holds, once the document carries a rig. */
  controls?: ReactNode
  palette?: PaintPalette
  /** Creates a named style from what the selection currently paints. */
  onCreateStyle?: (kind: VectorStyleKind, source: VectorElement) => void
  /** Repaints the selection from a style, or cuts the link when the id is null. */
  onLinkStyle?: (kind: VectorStyleKind, styleId: string | null) => void
  /** Writes a paint edit back to the style the selection follows. */
  onUpdateStyle?: (styleId: string, paints: VectorPaint[], record?: boolean) => void
  /** Drops a named style, leaving every object with the look it already had. */
  onDeleteStyle?: (styleId: string) => void
  /** Opens crop editing on an image, the way a double-click does. */
  onCropImage?: (id: string) => void
  /** Wraps the given shapes in a boolean group. */
  onBooleanGroup?: (operation: BooleanOperation, ids: string[]) => void
  /** Which mesh knot the canvas has selected. */
  selectedMeshPoint?: number | null
  /** Turns a selected path into a brush the document keeps. */
  onDefineBrush?: (element: VectorElement) => void
  /** Applies a font to the selection, loading and registering it with the document when needed. */
  onPickFont?: (family: string, source: VectorFont['source'] | 'app') => void
  onImportFont?: (font: VectorFont) => void
}

export function VectorInspector({
  document,
  tool,
  selectedElements,
  selectedNodeIds,
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
  saveMessage,
  tab,
  onTab,
  controls,
  palette,
  onCreateStyle,
  onLinkStyle,
  onUpdateStyle,
  onDeleteStyle,
  onCropImage,
  onBooleanGroup,
  selectedMeshPoint,
  onDefineBrush,
  onPickFont,
  onImportFont,
}: VectorInspectorProps) {
  const gesture = { onGestureStart, onGestureEnd, onGestureCancel }
  const [versionName, setVersionName] = useState('')
  const nodeMode = tool === 'node'
  const ops = geometryOps({
    elements: document.elements,
    selected: selectedElements,
    onUpdate,
    onEditElements,
    onSelectIds,
    onBooleanGroup,
  })
  const combinable = ops.combinable

  const outlineTextElement = async () => {
    const target = single
    if (!target || target.kind !== 'text') return
    const geometry = await outlineText(target, document.fonts ?? [])
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

  const tabPanelId = 'vector-inspector-panel'
  return (
    <aside className="inspector vector-inspector" aria-label="Vector inspector">
      <div className="vector-inspector__tabs" role="tablist" aria-label="Inspector panels">
        {INSPECTOR_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`vector-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={tabPanelId}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => onTab(id)}
            onKeyDown={(event) => {
              const index = INSPECTOR_TABS.indexOf(tab)
              const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
              if (!move) return
              event.preventDefault()
              const next = INSPECTOR_TABS[(index + move + INSPECTOR_TABS.length) % INSPECTOR_TABS.length]!
              onTab(next)
              queueMicrotask(() => window.document.getElementById(`vector-tab-${next}`)?.focus())
            }}
          >
            {id[0]!.toUpperCase() + id.slice(1)}
          </button>
        ))}
      </div>
      <div className="vector-inspector__body scroll-area" role="tabpanel" id={tabPanelId} aria-labelledby={`vector-tab-${tab}`}>
        {saveMessage ? <div className="vector-inspector__notice"><StatusMessage tone="error">{saveMessage}</StatusMessage></div> : null}
        {tab === 'history' ? (
          <VectorSection
            id="history"
            title="History"
            meta={historyDepth === 0 ? 'Nothing to undo' : `${historyDepth} ${historyDepth === 1 ? 'step' : 'steps'}`}
          >
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
          </VectorSection>
        ) : null}
        {tab === 'controls' ? (controls ?? <VectorEmpty>No controls yet. Expose a property with ◇</VectorEmpty>) : null}
        {tab === 'design' && selectedElements.length === 0 ? (
          <>
            <VectorSection id="page" title="Page" meta={`${document.width} × ${document.height}`}>
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
              <SelectField
                label="Colours"
                value={document.colorSpace ?? 'srgb'}
                options={[{ value: 'srgb', label: 'sRGB' }, { value: 'display-p3', label: 'Display P3' }]}
                onChange={(value) => onUpdateDocument({ colorSpace: value === 'display-p3' ? 'display-p3' : undefined })}
              />
              <p className="vector-empty">Colours are stored as sRGB either way. Display P3 reads the same numbers in the wider space, on screens that have one.</p>
            </VectorSection>
            <VectorSection
              id="guides"
              title="Guides"
              meta={document.guides.length === 0 ? undefined : `${document.guides.length}`}
              menu={document.guides.length > 0 ? [{ label: 'Clear guides', onSelect: () => onUpdateDocument({ guides: [] }) }] : undefined}
            >
              {document.guides.length === 0
                ? <VectorEmpty>No guides. Drag one out of a ruler</VectorEmpty>
                : <p className="vector-empty">Drag a guide back onto its ruler to remove it.</p>}
            </VectorSection>
            <VectorSection id="document-export" title="Export" meta={`${document.exportPresets?.length ?? 0}`}>
              {(document.exportPresets ?? []).length === 0
                ? <VectorEmpty>No export presets. Save one from the export menu</VectorEmpty>
                : (document.exportPresets ?? []).map((preset) => (
                  <div className="vector-row" key={preset.id}>
                    <span className="vector-row__label">{preset.name}</span>
                    <span className="vector-row__value">{preset.format.toUpperCase()} · {preset.scale}×</span>
                  </div>
                ))}
            </VectorSection>
          </>
        ) : null}
        {tab === 'design' && selectedElements.length > 0 ? (
          <>
            {nodeMode && single ? (
              <>
                <NodeSection element={single} selectedNodeIds={selectedNodeIds} onUpdate={onUpdate} onSelectNodes={onSelectNodes} gesture={gesture} />
                <PathPanel element={single} tool={tool} selectedNodeIds={selectedNodeIds} onUpdate={onUpdate} onEditElements={onEditElements} onSelectIds={onSelectIds} onSelectNodes={onSelectNodes} />
              </>
            ) : (
              <VectorSection
                id="position"
                title="Position"
                meta={single ? undefined : `${selectedElements.length} objects`}
                actions={selectedElements.length === 1 ? <AlignRow align={align} /> : undefined}
              >
                {single && single.kind !== 'group' ? (
                  <>
                    <div className="vector-field-grid">
                      <Exposable property="x" min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE}><NumberField label="X" value={single.x} min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(x) => onUpdate(single.id, { x })} {...gesture} /></Exposable>
                      <Exposable property="y" min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE}><NumberField label="Y" value={single.y} min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(y) => onUpdate(single.id, { y })} {...gesture} /></Exposable>
                      <Exposable property="width" min={1} max={MAX_DOCUMENT_SIZE}><NumberField label="W" value={single.width} min={1} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(width) => onUpdate(single.id, { width })} {...gesture} /></Exposable>
                      <Exposable property="height" min={1} max={MAX_DOCUMENT_SIZE}><NumberField label="H" value={single.height} min={1} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(height) => onUpdate(single.id, { height })} {...gesture} /></Exposable>
                    </div>
                    <Exposable property="rotation" min={-360} max={360}><NumberField label="Rotation" value={single.rotation} min={-360} max={360} step={1} unit="°" variant="field" onChange={(rotation) => onUpdate(single.id, { rotation })} {...gesture} /></Exposable>
                    <ShapeFields element={single} onUpdate={onUpdate} gesture={gesture} />
                  </>
                ) : bounds ? (
                  <div className="vector-field-grid">
                    <NumberField label="X" value={round(bounds.x)} min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(x) => moveSelection(x - bounds.x, 0)} {...gesture} />
                    <NumberField label="Y" value={round(bounds.y)} min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(y) => moveSelection(0, y - bounds.y)} {...gesture} />
                    <NumberField label="W" value={round(bounds.width)} min={1} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(width) => resizeSelection(width, bounds.height)} {...gesture} />
                    <NumberField label="H" value={round(bounds.height)} min={1} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(height) => resizeSelection(bounds.width, height)} {...gesture} />
                  </div>
                ) : null}
              </VectorSection>
            )}
            {!nodeMode && selectedElements.length > 1 ? (
              <VectorSection id="align" title="Align" meta={`${selectedElements.length} objects`}>
                <AlignRow align={align} />
                {selectedElements.length > 2 ? (
                  <div className="vector-align" role="group" aria-label="Distribute">
                    <AlignButton label="Distribute horizontally" onClick={() => distribute('x')}><IconDistributeH /></AlignButton>
                    <AlignButton label="Distribute vertically" onClick={() => distribute('y')}><IconDistributeV /></AlignButton>
                  </div>
                ) : null}
              </VectorSection>
            ) : null}
            {nodeMode ? null : (
              <LayerSection elements={selectedElements} leaves={leaves} onUpdate={onUpdate} onUpdateElements={onUpdateElements} gesture={gesture} />
            )}
            {!nodeMode && single && single.kind === 'text' ? (
              <TextPanel
                element={single}
                fonts={document.fonts ?? []}
                onUpdate={onUpdate}
                onOutline={outlineTextElement}
                onPickFont={onPickFont}
                onImportFont={onImportFont}
                gesture={gesture}
              />
            ) : null}
            <PaintSections
              elements={selectedElements}
              leaves={leaves}
              styles={document.styles ?? []}
              brushes={document.brushes ?? []}
              palette={palette}
              selectedMeshPoint={selectedMeshPoint}
              onUpdate={onUpdate}
              onUpdateElements={onUpdateElements}
              onCreateStyle={onCreateStyle}
              onLinkStyle={onLinkStyle}
              onUpdateStyle={onUpdateStyle}
              onDeleteStyle={onDeleteStyle}
              onDefineBrush={onDefineBrush}
              gesture={gesture}
            />
            {!nodeMode && single && single.kind === 'image' ? (
              <VectorSection id="image" title="Image" meta={single.imageWidth && single.imageHeight ? `${single.imageWidth} × ${single.imageHeight}` : undefined}>
                <ImagePanel element={single} onUpdate={onUpdate} onCrop={onCropImage} />
                <AdjustmentsPanel element={single} onChange={(adjustments, record) => onUpdate(single.id, { adjustments }, record, 'Adjust picture')} gesture={gesture} />
              </VectorSection>
            ) : null}
            {!nodeMode && single && single.kind === 'frame' ? (
              <FramePanel element={single} onUpdate={onUpdate} onUpdateElements={onUpdateElements} elements={document.elements} />
            ) : null}
            {!nodeMode && single && single.kind === 'boolean' ? (
              <VectorSection id="boolean" title="Boolean" meta={`${document.elements.filter((element) => element.parentId === single.id).length} shapes`} menu={[{ label: 'Flatten', onSelect: () => onUpdate(single.id, { kind: 'path', operation: undefined }, true, 'Flatten the boolean') }]}>
                <SelectField
                  label="Operation"
                  value={single.operation ?? 'unite'}
                  options={BOOLEAN_OPERATIONS.map((operation) => ({ value: operation, label: booleanLabel(operation) }))}
                  onChange={(value) => onUpdate(single.id, { operation: value as BooleanOperation }, true, 'Change the boolean')}
                />
                <p className="vector-empty">The shapes underneath stay editable: double-click to go in.</p>
              </VectorSection>
            ) : null}
            {!nodeMode && combinable.length > 1 ? (
              <VectorSection id="combine" title="Combine" meta={`${combinable.length} shapes`}>
                <div className="vector-panel__actions">
                  <Tooltip content="Merge the shapes into one"><Button variant="quiet" size="sm" onClick={() => ops.runBoolean('unite')}>Union</Button></Tooltip>
                  <Tooltip content="Cut the shapes above out of the bottom one"><Button variant="quiet" size="sm" onClick={() => ops.runBoolean('subtract')}>Subtract</Button></Tooltip>
                  <Tooltip content="Keep only what the shapes have in common"><Button variant="quiet" size="sm" onClick={() => ops.runBoolean('intersect')}>Intersect</Button></Tooltip>
                  <Tooltip content="Keep everything but the overlap"><Button variant="quiet" size="sm" onClick={() => ops.runBoolean('exclude')}>Exclude</Button></Tooltip>
                </div>
                <div className="vector-panel__actions">
                  <Tooltip content={withShortcut('Keep every sub-path in one object', 'combine')}><Button variant="quiet" size="sm" data-action="combine" onClick={ops.combine}>Combine</Button></Tooltip>
                  <Tooltip content="Unite the shapes into one path, losing the originals"><Button variant="quiet" size="sm" data-action="flatten-union" onClick={() => ops.flattenBoolean('unite')}>Union (flatten)</Button></Tooltip>
                  <Tooltip content="Unite the shapes into a single outline"><Button variant="quiet" size="sm" data-action="flatten" onClick={ops.flatten}>Flatten</Button></Tooltip>
                </div>
                <p className="vector-empty">Booleans use the bottom object as the base. Combine keeps every sub-path; Flatten unites them.</p>
              </VectorSection>
            ) : null}
            {!nodeMode && single && single.kind !== 'group' && single.kind !== 'text' && single.kind !== 'frame' && single.kind !== 'image' ? (
              <PathPanel element={single} tool={tool} selectedNodeIds={selectedNodeIds} onUpdate={onUpdate} onEditElements={onEditElements} onSelectIds={onSelectIds} onSelectNodes={onSelectNodes} />
            ) : null}
          </>
        ) : null}
      </div>
    </aside>
  )
}

/** The extra numbers a primitive carries: a rectangle's corners, a polygon's points, an arc. */
function ShapeFields({ element, onUpdate, gesture }: {
  element: VectorElement
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  gesture: Gesture
}) {
  if (element.kind === 'rectangle' && !element.network) return <CornerFields element={element} onUpdate={onUpdate} gesture={gesture} />
  if (element.kind === 'polygon' && !element.network) {
    const { sides, innerRatio } = polygonProperties(element)
    return (
      <>
        <Exposable property="sides" min={MIN_SIDES} max={MAX_SIDES}><NumberField label="Sides" value={sides} min={MIN_SIDES} max={MAX_SIDES} step={1} variant="field" onChange={(value) => onUpdate(element.id, { sides: Math.round(value) }, true, 'Change sides')} {...gesture} /></Exposable>
        <Exposable property="innerRatio" min={0} max={1} step={0.01}><NumberField label="Star points" value={Math.round(innerRatio * 100)} min={0} max={100} step={1} unit="%" variant="field" onChange={(value) => onUpdate(element.id, { innerRatio: value / 100 }, true, 'Change star points')} {...gesture} /></Exposable>
      </>
    )
  }
  if (element.kind === 'ellipse' && !element.network) {
    const arc = arcProperties(element)
    const apply = (patch: Partial<VectorElement>, label: string) => onUpdate(element.id, { arcStart: arc.start, arcSweep: arc.sweep, arcRatio: arc.ratio, ...patch }, true, label)
    return (
      <>
        <Exposable property="arcStart" min={0} max={360}><NumberField label="Arc start" value={round(arc.start)} min={0} max={360} step={1} unit="°" variant="field" onChange={(value) => apply({ arcStart: value }, 'Change arc')} {...gesture} /></Exposable>
        <Exposable property="arcSweep" min={-360} max={360}><NumberField label="Arc sweep" value={round(arc.sweep)} min={-360} max={360} step={1} unit="°" variant="field" onChange={(value) => apply({ arcSweep: value }, 'Change arc')} {...gesture} /></Exposable>
        <NumberField label="Inner radius" value={Math.round(arc.ratio * 100)} min={0} max={99} step={1} unit="%" variant="field" onChange={(value) => apply({ arcRatio: value / 100 }, 'Change ring')} {...gesture} />
        {isFullEllipse(arc) ? null : (
          <div className="vector-panel__actions">
            <Button variant="quiet" size="sm" data-action="reset-arc" onClick={() => onUpdate(element.id, { arcStart: undefined, arcSweep: undefined, arcRatio: undefined }, true, 'Whole ellipse')}>Whole ellipse</Button>
          </div>
        )}
      </>
    )
  }
  return null
}

function CornerFields({ element, onUpdate, gesture }: {
  element: VectorElement
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  gesture: Gesture
}) {
  const radii = cornerRadii(element)
  const uniform = typeof element.cornerRadius !== 'object'
  const max = Math.floor(Math.min(element.width, element.height) / 2)
  return (
    <>
      {uniform ? (
        <>
          <Exposable property="cornerRadius" min={0} max={max}><NumberField label="Radius" value={radii[0]} min={0} max={max} step={1} unit="px" variant="field" onChange={(radius) => onUpdate(element.id, { cornerRadius: radius > 0 ? radius : undefined })} {...gesture} /></Exposable>
          <Exposable property="cornerSmoothing" min={0} max={1} step={0.01}><NumberField label="Smoothing" value={Math.round((element.cornerSmoothing ?? 0) * 100)} min={0} max={100} step={1} unit="%" variant="field" disabled={!radii.some(Boolean)} onChange={(value) => onUpdate(element.id, { cornerSmoothing: value > 0 ? value / 100 : undefined })} {...gesture} /></Exposable>
        </>
      ) : (
        <div className="vector-field-grid">
          {(['Top left', 'Top right', 'Bottom right', 'Bottom left'] as const).map((label, index) => (
            <NumberField key={label} label={label} value={radii[index]!} min={0} max={max} step={1} unit="px" variant="field" onChange={(value) => {
              const next = [...radii] as [number, number, number, number]
              next[index] = value
              onUpdate(element.id, { cornerRadius: next })
            }} {...gesture} />
          ))}
        </div>
      )}
      <SwitchField label="Radius per corner" checked={!uniform} onChange={(separate) => onUpdate(element.id, { cornerRadius: separate ? [radii[0], radii[1], radii[2], radii[3]] : radii[0] || undefined })} />
    </>
  )
}

/** What the selection is as a layer: how much of it shows, how it mixes, whether it can be touched. */
function LayerSection({ elements, leaves, onUpdate, onUpdateElements, gesture }: {
  elements: VectorElement[]
  leaves: VectorElement[]
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  onUpdateElements: (updates: ElementPatch[], record?: boolean, label?: string) => void
  gesture: Gesture
}) {
  const single = elements.length === 1 ? elements[0]! : null
  const targets = single ? [single] : leaves
  const first = targets[0] ?? elements[0]
  if (!first) return null
  const apply = (patch: Partial<VectorElement>, record?: boolean, label = 'Change the layer') => {
    if (single) onUpdate(single.id, patch, record, label)
    else onUpdateElements(targets.map((element) => ({ id: element.id, patch })), record, label)
  }
  const allVisible = elements.every((element) => element.visible)
  const allLocked = elements.every((element) => element.locked)
  const maskable = single && single.parentId
  return (
    <VectorSection id="layer" title="Layer" meta={single ? `${kindLabel(single)} · ${Math.round(single.opacity * 100)}%` : `${Math.round(first.opacity * 100)}%`}>
      <Exposable property="blendMode">
        <BlendMode mode={first.blendMode ?? 'normal'} onChange={(blendMode) => apply({ blendMode: blendMode === 'normal' ? undefined : blendMode }, true, 'Change blend mode')} />
      </Exposable>
      <Exposable property="opacity" min={0} max={1} step={0.01}>
        <BarField label="Opacity" value={Math.round((single ?? first).opacity * 100)} min={0} max={100} step={1} unit="%" onChange={(value) => single ? onUpdate(single.id, { opacity: value / 100 }) : apply({ opacity: value / 100 })} {...gesture} />
      </Exposable>
      <Exposable property="visible">
        <SwitchField label="Visible" checked={allVisible} mixed={elements.some((element) => element.visible) && !allVisible} onChange={(visible) => onUpdateElements(elements.map((element) => ({ id: element.id, patch: { visible } })))} />
      </Exposable>
      <SwitchField label="Locked" checked={allLocked} mixed={elements.some((element) => element.locked) && !allLocked} onChange={(locked) => onUpdateElements(elements.map((element) => ({ id: element.id, patch: { locked } })))} />
      {maskable ? <SwitchField label="Mask" checked={!!single.mask} onChange={(mask) => onUpdate(single.id, { mask: mask || undefined }, true, mask ? 'Use as mask' : 'Remove mask')} /> : null}
    </VectorSection>
  )
}

/** Fill, Stroke and Effects: three sections of lines, each with its own + and its own ⋯. */
function PaintSections({ elements, leaves, styles, brushes, palette, selectedMeshPoint, onUpdate, onUpdateElements, onCreateStyle, onLinkStyle, onUpdateStyle, onDeleteStyle, onDefineBrush, gesture }: {
  elements: VectorElement[]
  leaves: VectorElement[]
  styles: VectorStyle[]
  brushes: VectorBrush[]
  palette?: PaintPalette
  selectedMeshPoint?: number | null
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  onUpdateElements: (updates: ElementPatch[], record?: boolean, label?: string) => void
  onCreateStyle?: (kind: VectorStyleKind, source: VectorElement) => void
  onLinkStyle?: (kind: VectorStyleKind, styleId: string | null) => void
  onUpdateStyle?: (styleId: string, paints: VectorPaint[], record?: boolean) => void
  /** Drops a named style, leaving every object with the look it already had. */
  onDeleteStyle?: (styleId: string) => void
  onDefineBrush?: (element: VectorElement) => void
  gesture: Gesture
}) {
  const single = elements.length === 1 && elements[0]!.kind !== 'group' ? elements[0]! : null
  const targets = single ? [single] : leaves
  if (targets.length === 0) return null
  const first = targets[0]!
  const same = (key: 'fill' | 'stroke' | 'strokeWidth') => targets.every((element) => element[key] === first[key])
  const apply = (patch: Partial<VectorElement>, record?: boolean, label = 'Change appearance') => {
    if (single) onUpdate(single.id, patch, record, label)
    else onUpdateElements(targets.map((element) => ({ id: element.id, patch })), record, label)
  }
  const fills = fillsOf(first)
  const strokes = strokesOf(first)
  const fillStyle = linkedStyle(styles, first, 'fill')
  const strokeStyle = linkedStyle(styles, first, 'stroke')
  const effectStyle = linkedStyle(styles, first, 'effect')
  const fillsMixed = !same('fill') || targets.some((element) => JSON.stringify(element.fills) !== JSON.stringify(first.fills))
  const strokesMixed = !same('stroke') || targets.some((element) => JSON.stringify(element.strokes) !== JSON.stringify(first.strokes))
  const effects = first.effects ?? []
  const effectsMixed = targets.some((element) => JSON.stringify(element.effects ?? []) !== JSON.stringify(first.effects ?? []))
  const isPath = !!single?.network
  const isRectangle = single?.kind === 'rectangle' && !single.network
  const sides = single?.strokeSides ?? { top: true, right: true, bottom: true, left: true }
  const setSide = (side: keyof typeof sides, value: boolean) => {
    if (!single) return
    const next = { ...sides, [side]: value }
    onUpdate(single.id, { strokeSides: next.top && next.right && next.bottom && next.left ? undefined : next })
  }
  const styleLink = (kind: VectorStyleKind, linked: VectorStyle | null) => ({
    name: linked?.name ?? null,
    canCreate: !!onCreateStyle,
    onCreate: () => onCreateStyle?.(kind, first),
    onDetach: () => onLinkStyle?.(kind, null),
  })
  const styleMenu = (kind: VectorStyleKind, linked: VectorStyle | null) => [
    ...(linked ? [{ label: 'Detach style', onSelect: () => onLinkStyle?.(kind, null) }] : [{ label: 'Create style', onSelect: () => onCreateStyle?.(kind, first) }]),
    ...styles.filter((style) => style.kind === kind && style.id !== linked?.id).map((style) => ({ label: `Use “${style.name}”`, onSelect: () => onLinkStyle?.(kind, style.id) })),
    ...(linked && onDeleteStyle ? [{ label: `Delete “${linked.name}”`, onSelect: () => onDeleteStyle(linked.id) }] : []),
  ]
  const writePaints = (kind: 'fill' | 'stroke') => (paints: VectorPaint[], record?: boolean) => {
    const linked = kind === 'fill' ? fillStyle : strokeStyle
    if (linked && onUpdateStyle) onUpdateStyle(linked.id, paints, record)
    else apply(kind === 'fill' ? fillsPatch(paints) : strokesPatch(paints), record, kind === 'fill' ? 'Change fill' : 'Change stroke')
  }
  return (
    <>
      <VectorSection
        id="fill"
        title="Fill"
        meta={fills.length > 1 ? `${fills.length} layers` : undefined}
        addLabel="Add fill layer"
        addDisabled={!addedPaints('Fill', fills)}
        onAdd={() => { const next = addedPaints('Fill', fills); if (next) writePaints('fill')(next) }}
        menu={styleMenu('fill', fillStyle)}
      >
        <PaintList
          label="Fill"
          paints={fills}
          mixed={fillsMixed}
          palette={palette}
          style={styleLink('fill', fillStyle)}
          selectedMeshPoint={selectedMeshPoint}
          onChange={writePaints('fill')}
          gesture={gesture}
        />
      </VectorSection>
      <VectorSection
        id="stroke"
        title="Stroke"
        meta={strokes.length > 0 ? `${first.strokeWidth} px` : undefined}
        addLabel="Add stroke layer"
        addDisabled={!addedPaints('Stroke', strokes)}
        onAdd={() => { const next = addedPaints('Stroke', strokes); if (next) writePaints('stroke')(next) }}
        menu={styleMenu('stroke', strokeStyle)}
      >
        <PaintList
          label="Stroke"
          paints={strokes}
          mixed={strokesMixed}
          palette={palette}
          style={styleLink('stroke', strokeStyle)}
          onChange={writePaints('stroke')}
          gesture={gesture}
        />
        {strokes.length > 0 ? (
          <StrokeDetail
            first={first}
            single={single}
            isPath={isPath}
            isRectangle={isRectangle}
            sides={sides}
            setSide={setSide}
            mixedWidth={!single && !same('strokeWidth')}
            brushes={brushes}
            onDefineBrush={onDefineBrush}
            onUpdate={onUpdate}
            apply={apply}
            gesture={gesture}
          />
        ) : null}
      </VectorSection>
      <VectorSection
        id="effects"
        title="Effects"
        meta={effects.length > 0 ? `${effects.length}` : undefined}
        addLabel="Add an effect"
        addDisabled={effects.length >= MAX_EFFECTS_PER_ELEMENT}
        onAdd={() => apply({ effects: [...effects, createEffect('dropShadow')] }, true, 'Add an effect')}
        menu={styleMenu('effect', effectStyle)}
      >
        <EffectList
          effects={effects}
          mixed={effectsMixed}
          palette={palette}
          onChange={(next, record) => apply({ effects: next.length ? next : undefined }, record, 'Change effects')}
          gesture={gesture}
        />
      </VectorSection>
    </>
  )
}

/** The contour's own numbers, folded away under one line until they are wanted. */
function StrokeDetail({ first, single, isPath, isRectangle, sides, setSide, mixedWidth, brushes, onDefineBrush, onUpdate, apply, gesture }: {
  first: VectorElement
  single: VectorElement | null
  isPath: boolean
  isRectangle: boolean
  sides: { top: boolean; right: boolean; bottom: boolean; left: boolean }
  setSide: (side: 'top' | 'right' | 'bottom' | 'left', value: boolean) => void
  mixedWidth: boolean
  brushes: VectorBrush[]
  onDefineBrush?: (element: VectorElement) => void
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  apply: (patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  gesture: Gesture
}) {
  const [open, setOpen] = useSectionState('stroke-detail', false)
  const panelId = 'vector-stroke-detail'
  return (
    <div className="vector-fold" data-open={open}>
      <button type="button" className="vector-fold__head" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        <IconChevron />
        <span>Width · Align · Cap · Join · Dash · Arrows</span>
      </button>
      <div className="vector-fold__panel" id={panelId} inert={!open} aria-hidden={!open}>
        <Exposable property="strokeWidth" min={0} max={100} step={0.5}><NumberField label="Width" value={first.strokeWidth} min={0} max={100} step={0.5} unit="px" variant="field" mixed={mixedWidth} onChange={(strokeWidth) => apply({ strokeWidth })} {...gesture} /></Exposable>
        <SelectField label="Align" value={first.strokeAlign ?? 'center'} options={[{ value: 'inside', label: 'Inside' }, { value: 'center', label: 'Center' }, { value: 'outside', label: 'Outside' }]} onChange={(value) => apply({ strokeAlign: value === 'center' ? undefined : value as VectorElement['strokeAlign'] })} />
        <SelectField label="Cap" value={first.strokeCap ?? 'butt'} options={[{ value: 'butt', label: 'Butt' }, { value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }]} onChange={(value) => apply({ strokeCap: value === 'butt' ? undefined : value as VectorElement['strokeCap'] })} />
        <SelectField label="Join" value={first.strokeJoin ?? 'miter'} options={[{ value: 'miter', label: 'Miter' }, { value: 'round', label: 'Round' }, { value: 'bevel', label: 'Bevel' }]} onChange={(value) => apply({ strokeJoin: value === 'miter' ? undefined : value as VectorElement['strokeJoin'] })} />
        <div className="vector-field-grid">
          <NumberField label="Dash" value={first.strokeDash?.[0] ?? 0} min={0} max={1000} step={1} unit="px" variant="field" onChange={(dash) => apply({ strokeDash: dash > 0 ? [dash, first.strokeDash?.[1] ?? dash] : undefined })} {...gesture} />
          <NumberField label="Gap" value={first.strokeDash?.[1] ?? 0} min={0} max={1000} step={1} unit="px" variant="field" disabled={!first.strokeDash} onChange={(gap) => apply({ strokeDash: first.strokeDash ? [first.strokeDash[0], gap] : undefined })} {...gesture} />
        </div>
        {isPath ? (
          <div className="vector-field-grid">
            <SelectField label="Arrow start" value={first.strokeArrowStart ?? 'none'} options={ARROW_OPTIONS} onChange={(value) => apply({ strokeArrowStart: value === 'none' ? undefined : value as VectorElement['strokeArrowStart'] })} />
            <SelectField label="Arrow end" value={first.strokeArrowEnd ?? 'none'} options={ARROW_OPTIONS} onChange={(value) => apply({ strokeArrowEnd: value === 'none' ? undefined : value as VectorElement['strokeArrowEnd'] })} />
          </div>
        ) : null}
        {single?.strokeProfile ? (
          <div className="vector-row vector-row--action">
            <span className="vector-row__label">Width profile · {single.strokeProfile.length} points</span>
            <Button variant="quiet" size="sm" data-action="reset-stroke-width" onClick={() => onUpdate(single.id, { strokeProfile: undefined }, true, 'Reset stroke width')}>Reset</Button>
          </div>
        ) : null}
        {isRectangle && !cornerRadii(single ?? first).some(Boolean) ? (
          <div className="vector-sides" role="group" aria-label="Stroke sides">
            <SwitchField label="Top" checked={sides.top} onChange={(value) => setSide('top', value)} />
            <SwitchField label="Right" checked={sides.right} onChange={(value) => setSide('right', value)} />
            <SwitchField label="Bottom" checked={sides.bottom} onChange={(value) => setSide('bottom', value)} />
            <SwitchField label="Left" checked={sides.left} onChange={(value) => setSide('left', value)} />
          </div>
        ) : null}
        {single && single.kind !== 'text' && single.kind !== 'image' ? (
          <BrushPanel
            element={single}
            brushes={brushes}
            canDefine={!!single.network}
            onDefine={() => onDefineBrush?.(single)}
            onChange={(brush, record) => onUpdate(single.id, { brush }, record, 'Change brush')}
            gesture={gesture}
          />
        ) : null}
      </div>
    </div>
  )
}

/** The node under the pointer: where it is, how its handles behave, how far they reach. */
function NodeSection({ element, selectedNodeIds, onUpdate, onSelectNodes, gesture }: {
  element: VectorElement
  selectedNodeIds: string[]
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  onSelectNodes: (ids: string[]) => void
  gesture: Gesture
}) {
  const world = worldNetwork(element)
  const activeId = selectedNodeIds.length === 1 ? selectedNodeIds[0]! : null
  const applyEdit = (edit: ReturnType<typeof toggleNodeSmooth> | null, selection?: string[]) => {
    if (!edit) return
    onUpdate(element.id, { ...edit, kind: 'path' })
    if (selection) onSelectNodes(selection)
  }
  const active = activeId ? world.nodes.find((node) => node.id === activeId) ?? null : null
  const incident = active ? world.segments.filter((segment) => segment.a === active.id || segment.b === active.id) : []
  const smooth = active ? incident.some((segment) => (segment.a === active.id && segment.ah) || (segment.b === active.id && segment.bh)) : false
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
    <VectorSection id="node" title="Node" meta={selectedNodeIds.length > 1 ? `${selectedNodeIds.length} selected` : active ? `${incident.length} ${incident.length === 1 ? 'segment' : 'segments'}` : undefined}>
      {!active ? (
        <VectorEmpty>{selectedNodeIds.length > 1 ? 'Several nodes. Line them up from the Network section.' : 'No node selected. Click one on the canvas'}</VectorEmpty>
      ) : (
        <>
          <div className="vector-field-grid">
            <NumberField label="X" value={round(active.point.x)} min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(x) => applyEdit(moveNodes(element, world, [active.id], { x: x - active.point.x, y: 0 }))} {...gesture} />
            <NumberField label="Y" value={round(active.point.y)} min={-MAX_DOCUMENT_SIZE} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(y) => applyEdit(moveNodes(element, world, [active.id], { x: 0, y: y - active.point.y }))} {...gesture} />
          </div>
          <SelectField
            label="Handles"
            value={smooth ? (active.handles ?? 'mirrored') : 'corner'}
            options={[{ value: 'corner', label: 'Corner' }, { value: 'mirrored', label: 'Mirror' }, { value: 'asymmetric', label: 'Angle' }, { value: 'independent', label: 'Free' }]}
            onChange={(value) => {
              if (value === 'corner') {
                if (smooth) applyEdit(toggleNodeSmooth(element, world, active.id), [active.id])
                return
              }
              const mode = value as 'mirrored' | 'asymmetric' | 'independent'
              if (!smooth) {
                const smoothed = toggleNodeSmooth(element, world, active.id)
                const next = { ...element, ...smoothed, kind: 'path' as const }
                applyEdit(setHandleMode(next, worldNetwork(next), active.id, mode), [active.id])
              } else {
                applyEdit(setHandleMode(element, world, active.id, mode), [active.id])
              }
            }}
          />
          {handles.map((handle, index) => {
            const polar = handlePolar(active.point, handle.point)
            return (
              <div key={`${handle.segmentId}-${handle.end}`} className="vector-field-grid">
                <NumberField label={`Handle ${index + 1} length`} value={round(polar.length)} min={0} max={MAX_DOCUMENT_SIZE} step={1} unit="px" variant="field" onChange={(length) => setHandle(handle, length, polar.angle)} {...gesture} />
                <NumberField label={`Handle ${index + 1} angle`} value={round(polar.angle)} min={-360} max={360} step={1} unit="°" variant="field" onChange={(angle) => setHandle(handle, polar.length, angle)} {...gesture} />
              </div>
            )
          })}
          {!smooth && incident.length === 2 ? (
            <NumberField label="Corner radius" value={active.radius ?? 0} min={0} max={1000} step={1} unit="px" variant="field" onChange={(radius) => onUpdate(element.id, { kind: 'path', network: { ...(element.network ?? normalizeWorld(world).network), nodes: (element.network ?? normalizeWorld(world).network).nodes.map((node) => node.id === active.id ? { ...node, radius: radius > 0 ? radius : undefined } : node) } })} {...gesture} />
          ) : null}
        </>
      )}
    </VectorSection>
  )
}

function PathPanel({ element, tool, selectedNodeIds, onUpdate, onEditElements, onSelectIds, onSelectNodes }: {
  element: VectorElement
  tool: VectorTool
  selectedNodeIds: string[]
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  onEditElements: (edit: (elements: VectorElement[]) => VectorElement[], record?: boolean) => void
  onSelectIds: (ids: string[]) => void
  onSelectNodes: (ids: string[]) => void
}) {
  const world = worldNetwork(element)
  const edited = !!element.network
  const faces = computeFaces(world)
  const off = new Set(element.regionsOff ?? [])
  const filled = faces.filter((face) => !off.has(face.key)).length
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
  return (
    <VectorSection
      id="network"
      title="Network"
      meta={`${world.nodes.length} nodes · ${world.segments.length} segments${edited ? '' : ' · primitive'}`}
      menu={groups.length > 1 ? [{ label: 'Separate parts', onSelect: separate }] : undefined}
      defaultOpen={tool === 'node'}
    >
      <p className="vector-empty">
        {faces.length === 0 ? 'No closed region.' : `${filled} of ${faces.length} ${faces.length === 1 ? 'region' : 'regions'} filled.`}
        {groups.length > 1 ? ` ${groups.length} parts.` : ''}
        {faces.length > 0 ? ' Use the paint bucket (B) to switch regions on or off.' : ''}
      </p>
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
      <p className="vector-empty">{tool === 'node'
        ? 'Double-click a node to toggle corner and smooth; double-click a segment to add a node; ⌘-drag a segment to bend it; ⌥-click a region to select its nodes.'
        : 'Press Enter or double-click the shape to edit nodes.'}</p>
      {tool === 'node' && canConnect ? (
        <div className="vector-panel__actions">
          <Tooltip content={withShortcut('Join the two selected nodes', 'join')}><Button variant="quiet" size="sm" data-action="join" onClick={() => applyEdit(connectNodes(element, world, pair![0]!, pair![1]!), [])}>Connect</Button></Tooltip>
        </div>
      ) : null}
    </VectorSection>
  )
}

/** The six ways of lining things up, as one row of icons. */
function AlignRow({ align }: { align: (mode: AlignMode) => void }) {
  return (
    <div className="vector-align" role="group" aria-label="Align">
      <AlignButton label="Align left" shortcut="⌥A" onClick={() => align('left')}><IconAlignLeft /></AlignButton>
      <AlignButton label="Align horizontal centres" shortcut="⌥H" onClick={() => align('centerX')}><IconAlignCenterH /></AlignButton>
      <AlignButton label="Align right" shortcut="⌥D" onClick={() => align('right')}><IconAlignRight /></AlignButton>
      <AlignButton label="Align top" shortcut="⌥W" onClick={() => align('top')}><IconAlignTop /></AlignButton>
      <AlignButton label="Align vertical centres" shortcut="⌥V" onClick={() => align('centerY')}><IconAlignCenterV /></AlignButton>
      <AlignButton label="Align bottom" shortcut="⌥S" onClick={() => align('bottom')}><IconAlignBottom /></AlignButton>
    </div>
  )
}

function AlignButton({ label, shortcut, onClick, children }: { label: string; shortcut?: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={shortcut ? `${label} · ${shortcut}` : label}>
      <IconButton label={label} className="vector-align__button" onClick={onClick}>{children}</IconButton>
    </Tooltip>
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
    <>
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
      <p className="vector-empty">{natural}{cropped ? ' · cropped' : ''}. Double-click the picture to crop it; resizing keeps its shape unless Shift is held.</p>
    </>
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
    <VectorSection id="frame" title="Frame" meta={children.length === 0 ? 'Empty' : `${children.length} ${children.length === 1 ? 'object' : 'objects'}`}>
      <SelectField
        label="Size"
        value={preset}
        options={[{ value: FRAME_CUSTOM, label: 'Custom' }, ...FRAME_PRESETS.map((item) => ({ value: item.value, label: `${item.label} · ${item.width} × ${item.height}` }))]}
        onChange={applyPreset}
      />
      <SwitchField label="Clip content" checked={element.clipContent !== false} onChange={(clipContent) => onUpdate(element.id, { clipContent })} />
      <p className="vector-empty">A frame keeps its own box and exports at its own size. Drop layers onto it to put them inside.</p>
    </VectorSection>
  )
}

/** Why a text cannot be outlined, in the words of what the user picked. */
function outlineReason(family: string, fonts: VectorFont[]): string {
  const carried = fonts.find((font) => font.family === family)
  if (carried?.source === 'google') return `${family} arrives as a woff2, which cannot be read for outlines. Import the .ttf or .otf to outline it.`
  if (carried?.format === 'woff2') return `${family} was imported as a woff2, which cannot be read for outlines. Import the .ttf or .otf instead.`
  return `${family} is a system font: its glyph outlines are not available to read`
}

/** The features an element asks for once one of the switches moves. */
function features(element: VectorElement, patch: VectorFontFeatures): VectorFontFeatures | undefined {
  const next = { kern: true, ...element.fontFeatures, ...patch }
  const entries = Object.entries(next).filter(([tag, on]) => on !== (tag === 'kern'))
  return entries.length ? Object.fromEntries(entries) as VectorFontFeatures : undefined
}

function TextPanel({ element, fonts, onUpdate, onOutline, onPickFont, onImportFont, gesture }: {
  element: VectorElement
  fonts: VectorFont[]
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean, label?: string) => void
  onOutline: () => Promise<void>
  onPickFont?: (family: string, source: VectorFont['source'] | 'app') => void
  onImportFont?: (font: VectorFont) => void
  gesture: { onGestureStart: () => void; onGestureEnd: () => void; onGestureCancel: () => void }
}) {
  const properties = textProperties(element)
  const apply = (patch: Partial<VectorElement>, record?: boolean) => onUpdate(element.id, resizeTextPatch(element, patch, canvasMeasure), record, 'Change text style')
  const outlineable = canOutline(properties.fontFamily, fonts)
  return (
    <VectorSection id="text" title="Text" meta={`${properties.text.split('\n').length} ${properties.text.split('\n').length === 1 ? 'line' : 'lines'}`}>
      <VectorFontPicker
        value={properties.fontFamily}
        fonts={fonts}
        onPick={(fontFamily, source) => onPickFont?.(fontFamily, source)}
        onImport={(font) => onImportFont?.(font)}
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
      <div className="vector-sides" role="group" aria-label="Type features">
        <SwitchField label="Ligatures" checked={element.fontFeatures?.liga ?? false} onChange={(liga) => apply({ fontFeatures: features(element, { liga }) })} />
        <SwitchField label="Kerning" checked={element.fontFeatures?.kern ?? true} onChange={(kern) => apply({ fontFeatures: features(element, { kern }) })} />
        <SwitchField label="Small caps" checked={element.fontFeatures?.smcp ?? false} onChange={(smcp) => apply({ fontFeatures: features(element, { smcp }) })} />
        <SwitchField label="Tabular figures" checked={element.fontFeatures?.tnum ?? false} onChange={(tnum) => apply({ fontFeatures: features(element, { tnum }) })} />
      </div>
      {element.textPath ? (
        <>
          <BarField label="Path offset" value={Math.round(element.textPath.offset * 100)} min={0} max={100} step={1} unit="%" onChange={(offset) => apply({ textPath: { ...element.textPath!, offset: offset / 100 } })} {...gesture} />
          <SelectField
            label="Side"
            value={element.textPath.side}
            options={[{ value: 'above', label: 'Above' }, { value: 'below', label: 'Below' }]}
            onChange={(side) => apply({ textPath: { ...element.textPath!, side: side as 'above' | 'below' } })}
          />
          <div className="vector-panel__actions">
            <Button variant="quiet" size="sm" data-action="detach-path" onClick={() => apply({ textPath: undefined })}>Detach from path</Button>
          </div>
        </>
      ) : null}
      <div className="vector-panel__actions">
        <Tooltip content={outlineable ? 'Convert the letters into editable paths' : outlineReason(properties.fontFamily, fonts)}>
          <span>
            <Button variant="quiet" size="sm" data-action="outline-text" disabled={!outlineable} onClick={() => void onOutline()}>Outline text</Button>
          </span>
        </Tooltip>
      </div>
      <p className="vector-empty">Double-click the text on the canvas to edit it, or press Enter with it selected.</p>
    </VectorSection>
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
    case 'component': return 'Component'
    case 'instance': return 'Instance'
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
