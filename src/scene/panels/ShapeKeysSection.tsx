import { useEffect, useRef, useState } from 'react'
import { emptyKey, keyFromMix, keyFromShape, uniqueKeyName } from '@/scene/mesh/shapeKeys'
import { meshOf } from '@/scene/document'
import { Exposable } from '@/scene/SceneExpose'
import { SceneEmpty, SceneSection } from '@/scene/SceneProperties'
import type { SceneDocument, SceneObject, ShapeKey } from '@/scene/types'
import { IconButton } from '@/ui/Button'
import { IconPencil, IconTrash } from '@/ui/icons'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { Tooltip } from '@/ui/Tooltip'

/**
 * Data > Shape keys: the shapes an object can be, and how much of each it is.
 *
 * A key is a set of offsets from the mesh as stored, so the list here is a list of *differences*
 * and the mesh itself is the basis they are measured from. Scrubbing a value changes what is drawn
 * and never the document's mesh, which is what lets a key be animated and driven by a controller.
 *
 * Where this differs from Blender, and why: there is no editing "on" a key. Blender's edit mode
 * writes into whichever key is active, and every mesh operator here writes into the mesh. So a key
 * is authored the other way about — shape a copy of the object and take the difference, which is
 * Blender's own "Join as Shapes" and works with the tools that exist.
 */

export function ShapeKeysSection({ document, object, onEditDocument, isOpen, onSection, onGestureStart, onGestureEnd }: {
  document: SceneDocument
  object: SceneObject
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string) => void
  isOpen: (sectionId: string) => boolean
  onSection: (sectionId: string, open: boolean) => void
  onGestureStart: () => void
  onGestureEnd: () => void
}) {
  const keys = object.shapeKeys ?? []
  const active = Math.min(keys.length - 1, Math.max(0, object.activeShapeKey ?? 0))
  const [renaming, setRenaming] = useState<{ index: number; draft: string } | null>(null)
  const [source, setSource] = useState('')
  const field = useRef<HTMLInputElement | null>(null)
  const mesh = meshOf(document, object)

  useEffect(() => {
    if (renaming) field.current?.select()
  }, [renaming])

  const write = (change: (current: ShapeKey[]) => ShapeKey[], label: string, activeIndex?: number): void => {
    onEditDocument((current) => ({
      ...current,
      objects: current.objects.map((entry) => {
        if (entry.id !== object.id) return entry
        const next = change(entry.shapeKeys ?? [])
        return {
          ...entry,
          ...(next.length === 0 ? { shapeKeys: undefined } : { shapeKeys: next }),
          ...(activeIndex === undefined ? {} : { activeShapeKey: Math.max(0, Math.min(next.length - 1, activeIndex)) }),
        }
      }),
    }), label)
  }

  const commitRename = (keep: boolean): void => {
    const pending = renaming
    setRenaming(null)
    if (!pending || !keep) return
    const wanted = pending.draft.trim()
    if (wanted.length === 0 || wanted === keys[pending.index]?.name) return
    write((current) => current.map((key, index) => (
      index === pending.index ? { ...key, name: uniqueKeyName(current.filter((_, at) => at !== index), wanted) } : key
    )), 'Rename shape key')
  }

  /** The other meshes a shape could be taken from: same vertex count, so the offsets line up. */
  const donors = mesh
    ? document.objects.filter((entry) => {
      if (entry.id === object.id || entry.data.kind !== 'mesh') return false
      const other = meshOf(document, entry)
      return other !== null && other.vertexIds.length === mesh.vertexIds.length
    })
    : []

  return (
    <SceneSection id="data-mesh-shape-keys" title="Shape keys" meta={`${keys.length}`} isOpen={isOpen} onSection={onSection}>
      {keys.length === 0 ? (
        <SceneEmpty>
          No shape keys. Add one to hold a shape this object can blend into — a smile, a fist, a
          flap — and bind its value to a controller.
        </SceneEmpty>
      ) : (
        <div className="scene-shape-keys" role="group" aria-label="Shape keys">
          {keys.map((key, index) => (
            <div key={`${key.name}-${index}`} className="scene-shape-keys__row" data-active={index === active}>
              {renaming?.index === index ? (
                <input
                  ref={field}
                  className="scene-uv-maps__field"
                  aria-label={`Rename ${key.name}`}
                  value={renaming.draft}
                  maxLength={64}
                  autoFocus
                  onChange={(event) => setRenaming({ index, draft: event.currentTarget.value })}
                  onBlur={() => commitRename(true)}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitRename(true)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      commitRename(false)
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="scene-uv-maps__name"
                  aria-pressed={index === active}
                  title={`${Object.keys(key.offsets).length} vertices moved`}
                  onClick={() => write((current) => current, 'Active shape key', index)}
                  onDoubleClick={() => setRenaming({ index, draft: key.name })}
                >
                  {key.name}
                </button>
              )}
              <span className="scene-shape-keys__value">
                <Exposable property={`shapeKeys[${key.name}].value`} objectId={object.id} label={key.name}>
                  <NumberField
                    label={key.name}
                    value={key.value}
                    min={key.min}
                    max={key.max}
                    step={0.01}
                    variant="bar"
                    onGestureStart={onGestureStart}
                    onGestureEnd={onGestureEnd}
                    onChange={(value) => write((current) => current.map((entry, at) => (at === index ? { ...entry, value } : entry)), 'Shape key value')}
                  />
                </Exposable>
              </span>
              <span className="scene-uv-maps__actions">
                <Tooltip content={`Rename ${key.name}`}>
                  <IconButton label={`Rename ${key.name}`} onClick={() => setRenaming({ index, draft: key.name })}>
                    <IconPencil />
                  </IconButton>
                </Tooltip>
                <Tooltip content={`Remove ${key.name}`}>
                  <IconButton
                    label={`Remove ${key.name}`}
                    onClick={() => write((current) => current.filter((_, at) => at !== index), 'Remove shape key', Math.max(0, index - 1))}
                  >
                    <IconTrash />
                  </IconButton>
                </Tooltip>
              </span>
            </div>
          ))}
        </div>
      )}

      {keys[active] ? (
        <>
          <NumberField
            label="Range minimum"
            value={keys[active]!.min}
            min={-10}
            max={10}
            step={0.1}
            variant="field"
            onGestureStart={onGestureStart}
            onGestureEnd={onGestureEnd}
            onChange={(min) => write((current) => current.map((entry, at) => (at === active ? { ...entry, min: Math.min(min, entry.max) } : entry)), 'Shape key range')}
          />
          <NumberField
            label="Range maximum"
            value={keys[active]!.max}
            min={-10}
            max={10}
            step={0.1}
            variant="field"
            onGestureStart={onGestureStart}
            onGestureEnd={onGestureEnd}
            onChange={(max) => write((current) => current.map((entry, at) => (at === active ? { ...entry, max: Math.max(max, entry.min) } : entry)), 'Shape key range')}
          />
        </>
      ) : null}

      <div className="scene-buttons">
        <Tooltip content="A key holding no difference yet, ready to be given one">
          <button
            type="button"
            className="scene-button"
            onClick={() => write((current) => [...current, emptyKey('Key', current)], 'Add shape key', keys.length)}
          >
            Add
          </button>
        </Tooltip>
        <Tooltip content="A key holding the shape the keys currently mix to">
          <button
            type="button"
            className="scene-button"
            disabled={!mesh || keys.length === 0}
            onClick={() => {
              if (!mesh) return
              write((current) => [...current, keyFromMix(mesh, current, 'Mix')], 'Shape key from mix', keys.length)
            }}
          >
            From mix
          </button>
        </Tooltip>
      </div>

      {donors.length > 0 && mesh ? (
        <div className="scene-shape-keys__donor">
          <SelectField
            label="From another object"
            value={source}
            options={[{ value: '', label: 'Choose…' }, ...donors.map((entry) => ({ value: entry.id, label: entry.name }))]}
            onChange={(id) => {
              setSource('')
              const donor = document.objects.find((entry) => entry.id === id)
              const shape = donor ? meshOf(document, donor) : null
              if (!donor || !shape) return
              write((current) => [...current, keyFromShape(mesh, shape, donor.name, current)], 'Shape key from object', keys.length)
            }}
          />
          <SceneEmpty>
            The difference between this mesh and that one, vertex by vertex — which is how a key is
            shaped here: model the shape on a copy, then take it.
          </SceneEmpty>
        </div>
      ) : null}
    </SceneSection>
  )
}
