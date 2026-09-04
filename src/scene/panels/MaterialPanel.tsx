import { MaterialSwatch } from '@/scene/panels/MaterialSwatch'
import { ResourceField } from '@/scene/panels/ResourceField'
import { Exposable } from '@/scene/SceneExpose'
import { SceneEmpty, SceneSection } from '@/scene/SceneProperties'
import type { EditorMode, Material, SceneDocument, SceneObject, TextureSlot } from '@/scene/types'
import { BarField } from '@/ui/BarField'
import { IconButton } from '@/ui/Button'
import { ColorField } from '@/ui/ColorField'
import { IconChevron, IconChevronUp, IconMinus, IconPlus } from '@/ui/icons'
import { SelectField } from '@/ui/SelectField'
import { SwitchField } from '@/ui/SwitchField'
import { Tooltip } from '@/ui/Tooltip'

/**
 * The Material tab: the object's slots, and the material in the active one.
 *
 * The two halves are separate on purpose, as they are in Blender. The top is a property of the
 * *object*: a list of slots, which its faces point into by index. The bottom is the material
 * itself, which is a thing in the document that any number of objects may name — so editing it here
 * changes it everywhere, and the users count says how many places that is before a person is
 * surprised by it.
 *
 * Assign, Select and Deselect only exist in edit mode, because they are about faces. They are
 * operators rather than panel edits: assigning is a change to the mesh, and F9 must be able to
 * replay it.
 */

const TEXTURE_TYPES = 'image/png,image/jpeg,image/webp,image/avif'
const TEXTURE_HINT = 'PNG · JPEG · WebP, up to 32 MB'

const BLEND_MODES = [
  { value: 'opaque', label: 'Opaque' },
  { value: 'clip', label: 'Alpha clip' },
  { value: 'blend', label: 'Alpha blend' },
]

type TextureName = 'baseColor' | 'roughness' | 'metallic' | 'emission' | 'normal'

const TEXTURE_LABELS: Array<{ id: TextureName; label: string }> = [
  { id: 'baseColor', label: 'Base colour' },
  { id: 'roughness', label: 'Roughness' },
  { id: 'metallic', label: 'Metallic' },
  { id: 'emission', label: 'Emission' },
  { id: 'normal', label: 'Normal' },
]

export function MaterialPanel({
  document,
  activeObject,
  mode,
  activeSlot,
  onActiveSlot,
  onUpdateObject,
  onEditDocument,
  onRunOperator,
  onGestureStart,
  onGestureEnd,
  isOpen,
  onSection,
}: {
  document: SceneDocument
  activeObject: SceneObject | null
  mode: EditorMode
  /** Which slot the panel is on, which is also what the material operators work on. */
  activeSlot: number
  onActiveSlot: (slot: number) => void
  onUpdateObject: (id: string, patch: Partial<SceneObject>, label?: string) => void
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string) => void
  onRunOperator: (id: string, params?: Record<string, unknown>) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  isOpen: (sectionId: string) => boolean
  onSection: (sectionId: string, open: boolean) => void
}) {
  const folds = { isOpen, onSection }
  const gesture = { onGestureStart, onGestureEnd }

  if (!activeObject) {
    return <div className="scene-properties__notice"><SceneEmpty>Nothing is active. Select an object to give it a material.</SceneEmpty></div>
  }

  const slots = activeObject.materialSlots
  const slot = Math.max(0, Math.min(slots.length - 1, activeSlot))
  const material = document.materials.find((entry) => entry.id === slots[slot]) ?? null
  const users = material ? document.objects.filter((object) => object.materialSlots.includes(material.id)).length : 0

  const edit = (patch: Partial<Material>, label: string) => {
    if (!material) return
    onEditDocument((current) => ({
      ...current,
      materials: current.materials.map((entry) => (entry.id === material.id ? { ...entry, ...patch } : entry)),
    }), label)
  }
  const setTexture = (name: TextureName, texture: TextureSlot | undefined, label: string) => {
    if (!material) return
    const textures = { ...(material.textures ?? {}) }
    if (texture) textures[name] = texture
    else delete textures[name]
    edit({ textures: Object.keys(textures).length > 0 ? textures : undefined }, label)
  }

  return (
    <>
      <SceneSection id="material-slots" title="Slots" meta={`${slot + 1} of ${slots.length}`} {...folds}>
        <div className="scene-slots">
          <ul className="scene-slots__list" role="listbox" aria-label="Material slots" aria-activedescendant={`material-slot-${slot}`}>
            {slots.map((id, index) => {
              const entry = document.materials.find((candidate) => candidate.id === id)
              return (
                <li key={`${id}-${index}`}>
                  <button
                    type="button"
                    id={`material-slot-${index}`}
                    role="option"
                    aria-selected={index === slot}
                    className="scene-slots__row"
                    onClick={() => onActiveSlot(index)}
                  >
                    <MaterialSwatch material={entry ?? null} />
                    <span className="scene-slots__name">{entry?.name ?? 'Empty slot'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="scene-slots__tools">
            <Tooltip content="Add a slot">
              <IconButton label="Add material slot" onClick={() => onRunOperator('material.addSlot')}><IconPlus /></IconButton>
            </Tooltip>
            <Tooltip content={slots.length > 1 ? 'Remove the slot' : 'An object keeps at least one slot'}>
              <IconButton
                label="Remove material slot"
                disabled={slots.length <= 1}
                onClick={() => onRunOperator('material.removeSlot')}
              >
                <IconMinus />
              </IconButton>
            </Tooltip>
            <Tooltip content="Move the slot up">
              <IconButton
                label="Move material slot up"
                disabled={slot === 0}
                onClick={() => onRunOperator('material.moveSlot', { step: -1 })}
              >
                <IconChevronUp />
              </IconButton>
            </Tooltip>
            <Tooltip content="Move the slot down">
              <IconButton
                label="Move material slot down"
                disabled={slot >= slots.length - 1}
                onClick={() => onRunOperator('material.moveSlot', { step: 1 })}
              >
                <IconChevron />
              </IconButton>
            </Tooltip>
          </div>
        </div>

        <SelectField
          label="Material"
          value={material?.id ?? ''}
          options={document.materials.map((entry) => ({ value: entry.id, label: entry.name }))}
          onChange={(id) => onUpdateObject(
            activeObject.id,
            { materialSlots: slots.map((current, index) => (index === slot ? id : current)) },
            'Material slot',
          )}
        />
        <div className="scene-buttons">
          <button type="button" className="scene-button" onClick={() => onRunOperator('material.new')}>New</button>
          <button type="button" className="scene-button" disabled={!material} onClick={() => onRunOperator('material.new', { copyActive: true })}>
            Duplicate
          </button>
          <button
            type="button"
            className="scene-button"
            disabled={!material || document.materials.length <= 1}
            onClick={() => material && onRunOperator('material.delete', { materialId: material.id })}
          >
            Delete
          </button>
        </div>
        {material ? (
          <>
            <NameField
              value={material.name}
              onChange={(name) => edit({ name }, 'Rename material')}
            />
            <SceneEmpty>
              {users === 1
                ? 'Used by this object alone, so changes here stay here.'
                : `Used by ${users} objects, so a change here changes all of them.`}
            </SceneEmpty>
          </>
        ) : (
          <SceneEmpty>This slot has no material. Choose one, or press New.</SceneEmpty>
        )}
        {mode === 'edit' ? (
          <div className="scene-buttons">
            <button type="button" className="scene-button" onClick={() => onRunOperator('material.assign')}>Assign</button>
            <button type="button" className="scene-button" onClick={() => onRunOperator('material.select')}>Select</button>
            <button type="button" className="scene-button" onClick={() => onRunOperator('material.deselect')}>Deselect</button>
          </div>
        ) : null}
      </SceneSection>

      {material ? (
        <>
          <SceneSection id="material-surface" title="Surface" {...folds}>
            <Exposable property={`materials[${material.id}].baseColor`}><ColorField label="Base colour" value={material.baseColor} onChange={(baseColor) => edit({ baseColor }, 'Base colour')} {...gesture} /></Exposable>
            <Exposable property={`materials[${material.id}].metallic`} min={0} max={1} step={0.01}><BarField label="Metallic" value={material.metallic} min={0} max={1} step={0.01} defaultValue={0} onChange={(metallic) => edit({ metallic }, 'Metallic')} {...gesture} /></Exposable>
            <Exposable property={`materials[${material.id}].roughness`} min={0} max={1} step={0.01}><BarField label="Roughness" value={material.roughness} min={0} max={1} step={0.01} defaultValue={0.5} onChange={(roughness) => edit({ roughness }, 'Roughness')} {...gesture} /></Exposable>
            <BarField label="Specular" value={material.specular} min={0} max={1} step={0.01} defaultValue={0.5} onChange={(specular) => edit({ specular }, 'Specular')} {...gesture} />
            <BarField label="IOR" value={material.ior} min={1} max={2.333} step={0.001} defaultValue={1.45} onChange={(ior) => edit({ ior }, 'IOR')} {...gesture} />
            <Exposable property={`materials[${material.id}].transmission`} min={0} max={1} step={0.01}><BarField label="Transmission" value={material.transmission} min={0} max={1} step={0.01} defaultValue={0} onChange={(transmission) => edit({ transmission }, 'Transmission')} {...gesture} /></Exposable>
          </SceneSection>

          <SceneSection id="material-emission" title="Emission" {...folds}>
            <Exposable property={`materials[${material.id}].emission`}><ColorField label="Colour" value={material.emission} onChange={(emission) => edit({ emission }, 'Emission colour')} {...gesture} /></Exposable>
            <Exposable property={`materials[${material.id}].emissionStrength`} min={0} max={10} step={0.01}>
              <BarField
                label="Strength"
                value={material.emissionStrength}
                min={0}
                max={100}
                sliderMax={10}
                step={0.01}
                defaultValue={0}
                onChange={(emissionStrength) => edit({ emissionStrength }, 'Emission strength')}
                {...gesture}
              />
            </Exposable>
            <SceneEmpty>An emitting surface is drawn bright; it does not light its neighbours.</SceneEmpty>
          </SceneSection>

          <SceneSection id="material-transparency" title="Transparency" {...folds}>
            <Exposable property={`materials[${material.id}].alpha`} min={0} max={1} step={0.01}><BarField label="Alpha" value={material.alpha} min={0} max={1} step={0.01} defaultValue={1} onChange={(alpha) => edit({ alpha }, 'Alpha')} {...gesture} /></Exposable>
            <SelectField
              label="Blend mode"
              value={material.blendMode}
              options={BLEND_MODES}
              onChange={(value) => edit({ blendMode: value === 'blend' ? 'blend' : value === 'clip' ? 'clip' : 'opaque' }, 'Blend mode')}
            />
          </SceneSection>

          <SceneSection id="material-textures" title="Textures" {...folds}>
            {TEXTURE_LABELS.map(({ id, label }) => {
              const texture = material.textures?.[id]
              return (
                <ResourceField
                  key={id}
                  label={label}
                  accept={TEXTURE_TYPES}
                  hint={TEXTURE_HINT}
                  name={texture ? texture.name ?? label : null}
                  onChoose={(resource) => setTexture(id, { resourceId: resource.id, name: resource.name }, `${label} texture`)}
                  onClear={() => setTexture(id, undefined, `Remove ${label.toLowerCase()} texture`)}
                />
              )
            })}
            <BarField
              label="Normal strength"
              value={material.normalStrength}
              min={0}
              max={4}
              sliderMax={2}
              step={0.01}
              defaultValue={1}
              onChange={(normalStrength) => edit({ normalStrength }, 'Normal strength')}
              {...gesture}
            />
            <SceneEmpty>Images are stored in this browser; a project file carries the reference.</SceneEmpty>
          </SceneSection>

          <SceneSection id="material-settings" title="Settings" {...folds}>
            <SwitchField
              label="Backface culling"
              checked={material.backfaceCulling}
              defaultValue={false}
              onChange={(backfaceCulling) => edit({ backfaceCulling }, 'Backface culling')}
            />
          </SceneSection>
        </>
      ) : null}
    </>
  )
}

/** The material's name, edited in place: a text field with no ceremony around it. */
function NameField({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <label className="control control--field scene-name-field">
      <span className="control__label">Name</span>
      <input
        type="text"
        defaultValue={value}
        key={value}
        maxLength={80}
        onBlur={(event) => {
          const name = event.target.value.trim()
          if (name && name !== value) onChange(name)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key !== 'Escape') return
          event.currentTarget.value = value
          event.currentTarget.blur()
        }}
      />
    </label>
  )
}
