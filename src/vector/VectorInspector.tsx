import { ColorField } from '@/ui/ColorField'
import { NumberField } from '@/ui/NumberField'
import type { VectorDocument, VectorElement } from '@/vector/types'

type VectorInspectorProps = {
  document: VectorDocument
  selected: VectorElement | null
  onRenameDocument: (name: string) => void
  onUpdateDocument: (patch: Partial<Pick<VectorDocument, 'background'>>, record?: boolean) => void
  onUpdate: (id: string, patch: Partial<VectorElement>, record?: boolean) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  onGestureCancel: () => void
}

export function VectorInspector({
  document,
  selected,
  onRenameDocument,
  onUpdateDocument,
  onUpdate,
  onGestureStart,
  onGestureEnd,
  onGestureCancel,
}: VectorInspectorProps) {
  const gesture = {
    onGestureStart,
    onGestureEnd,
    onGestureCancel,
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
        {selected ? (
          <section className="vector-panel" aria-label="Selection properties">
            <div className="vector-field-grid">
              <NumberField label="X" value={selected.x} min={-10000} max={10000} step={1} unit="px" variant="field" onChange={(x) => onUpdate(selected.id, { x })} {...gesture} />
              <NumberField label="Y" value={selected.y} min={-10000} max={10000} step={1} unit="px" variant="field" onChange={(y) => onUpdate(selected.id, { y })} {...gesture} />
              <NumberField label="W" value={selected.width} min={1} max={10000} step={1} unit="px" variant="field" onChange={(width) => onUpdate(selected.id, { width })} {...gesture} />
              <NumberField label="H" value={selected.height} min={1} max={10000} step={1} unit="px" variant="field" onChange={(height) => onUpdate(selected.id, { height })} {...gesture} />
            </div>
            <NumberField label="Rotation" value={selected.rotation} min={-360} max={360} step={1} unit="°" variant="field" onChange={(rotation) => onUpdate(selected.id, { rotation })} {...gesture} />
            <ColorField label="Fill" value={selected.fill} onChange={(fill) => onUpdate(selected.id, { fill })} {...gesture} />
            <ColorField label="Stroke" value={selected.stroke} onChange={(stroke) => onUpdate(selected.id, { stroke })} {...gesture} />
            <NumberField label="Stroke" value={selected.strokeWidth} min={0} max={100} step={0.5} unit="px" variant="field" onChange={(strokeWidth) => onUpdate(selected.id, { strokeWidth })} {...gesture} />
            <NumberField label="Opacity" value={Math.round(selected.opacity * 100)} min={0} max={100} step={1} unit="%" variant="field" onChange={(opacity) => onUpdate(selected.id, { opacity: opacity / 100 })} {...gesture} />
          </section>
        ) : (
          <section className="vector-panel vector-panel--document" aria-label="Page properties">
            <h2 className="vector-panel__title">Page</h2>
            <ColorField label="Background" value={document.background} onChange={(background) => onUpdateDocument({ background })} {...gesture} />
          </section>
        )}
      </div>
    </aside>
  )
}
