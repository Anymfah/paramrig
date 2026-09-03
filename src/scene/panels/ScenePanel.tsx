import { SceneAxes, SceneEmpty, SceneSection } from '@/scene/SceneProperties'
import type { CameraData, SceneDocument, SceneObject, Vec3 } from '@/scene/types'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'

/**
 * The Scene tab: what a unit means here, where the 3D cursor is, and which camera the scene looks
 * through. These are properties of the document rather than of anything selected, so the panel
 * edits the document directly.
 */

/** No object id can be this, so it is safe as the "no camera" option of a select. */
const NO_CAMERA = 'none'

const UNIT_SYSTEMS = [
  { value: 'metric', label: 'Metric' },
  { value: 'imperial', label: 'Imperial' },
  { value: 'none', label: 'None' },
]

type CameraObject = SceneObject & { data: CameraData }

export function ScenePanel({ document, unit, onEditDocument, onGestureStart, onGestureEnd, isOpen, onSection }: {
  document: SceneDocument
  /** The suffix a length field shows, decided once for the whole panel. */
  unit: string | undefined
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string) => void
  onGestureStart: () => void
  onGestureEnd: () => void
  isOpen: (sectionId: string) => boolean
  onSection: (sectionId: string, open: boolean) => void
}) {
  const folds = { isOpen, onSection }
  const gesture = { onGestureStart, onGestureEnd }
  const cameras = document.objects.filter((object): object is CameraObject => object.data.kind === 'camera')
  const active = cameras.find((camera) => camera.data.active)

  const setCursor = (part: 'position' | 'rotation', axis: number, value: number) => {
    onEditDocument((current) => {
      const next = [...current.cursor[part]] as Vec3
      next[axis] = value
      return { ...current, cursor: { ...current.cursor, [part]: next } }
    }, '3D cursor')
  }

  const setActiveCamera = (id: string) => {
    onEditDocument((current) => ({
      ...current,
      // At most one object carries the flag, so setting one has to clear every other camera.
      objects: current.objects.map((object) => (
        object.data.kind !== 'camera' ? object : { ...object, data: { ...object.data, active: object.id === id } }
      )),
    }), 'Active camera')
  }

  return (
    <>
      <SceneSection id="scene-units" title="Units" meta={document.units.system === 'none' ? 'None' : undefined} {...folds}>
        <SelectField
          label="Unit system"
          value={document.units.system}
          options={UNIT_SYSTEMS}
          onChange={(value) => onEditDocument((current) => ({
            ...current,
            units: { ...current.units, system: value === 'imperial' ? 'imperial' : value === 'none' ? 'none' : 'metric' },
          }), 'Unit system')}
        />
        <NumberField
          label="Unit scale"
          value={document.units.scale}
          min={0.00001}
          max={100000}
          step={0.001}
          variant="field"
          onChange={(scale) => onEditDocument((current) => ({ ...current, units: { ...current.units, scale } }), 'Unit scale')}
          {...gesture}
        />
        <SceneEmpty>Unit scale is how many metres one unit of this scene is worth.</SceneEmpty>
      </SceneSection>

      <SceneSection id="scene-cursor" title="3D cursor" {...folds}>
        <SceneAxes
          label="Location"
          unit={unit}
          min={-1e6}
          max={1e6}
          step={0.01}
          values={document.cursor.position}
          onChange={(axis, value) => setCursor('position', axis, value)}
          {...gesture}
        />
        <SceneAxes
          label="Rotation"
          unit="°"
          min={-3600}
          max={3600}
          step={0.1}
          values={document.cursor.rotation}
          onChange={(axis, value) => setCursor('rotation', axis, value)}
          {...gesture}
        />
      </SceneSection>

      <SceneSection id="scene-camera" title="Camera" meta={active?.name} {...folds}>
        {cameras.length === 0 ? (
          <SceneEmpty>No camera in this scene. Add one to render it from somewhere.</SceneEmpty>
        ) : (
          <SelectField
            label="Active camera"
            value={active?.id ?? NO_CAMERA}
            options={[{ value: NO_CAMERA, label: 'None' }, ...cameras.map((camera) => ({ value: camera.id, label: camera.name }))]}
            onChange={setActiveCamera}
          />
        )}
      </SceneSection>
    </>
  )
}
