import { SceneAxes, SceneEmpty, SceneSection } from '@/scene/SceneProperties'
import type { CameraData, SceneDocument, SceneObject, Vec3 } from '@/scene/types'
import { BarField } from '@/ui/BarField'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { SwitchField } from '@/ui/SwitchField'

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

  const output = document.output ?? DEFAULT_OUTPUT
  const setOutput = (patch: Partial<NonNullable<SceneDocument['output']>>, label: string) => {
    onEditDocument((current) => ({ ...current, output: { ...(current.output ?? DEFAULT_OUTPUT), ...patch } }), label)
  }
  const colour = document.colorManagement ?? DEFAULT_COLOR_MANAGEMENT
  const setColour = (patch: Partial<NonNullable<SceneDocument['colorManagement']>>, label: string) => {
    onEditDocument((current) => ({
      ...current,
      colorManagement: { ...(current.colorManagement ?? DEFAULT_COLOR_MANAGEMENT), ...patch },
    }), label)
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
          property="cursor.position"
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

      <SceneSection
        id="scene-output"
        title="Output"
        meta={`${Math.round((output.width * output.percentage) / 100)} × ${Math.round((output.height * output.percentage) / 100)}`}
        {...folds}
      >
        <NumberField
          label="Resolution X"
          value={output.width}
          min={4}
          max={16384}
          step={1}
          variant="field"
          onChange={(width) => setOutput({ width: Math.round(width) }, 'Render width')}
          {...gesture}
        />
        <NumberField
          label="Resolution Y"
          value={output.height}
          min={4}
          max={16384}
          step={1}
          variant="field"
          onChange={(height) => setOutput({ height: Math.round(height) }, 'Render height')}
          {...gesture}
        />
        <BarField
          label="Percentage"
          value={output.percentage}
          min={1}
          max={400}
          sliderMax={200}
          step={1}
          unit="%"
          defaultValue={100}
          onChange={(percentage) => setOutput({ percentage: Math.round(percentage) }, 'Render scale')}
          {...gesture}
        />
        <SwitchField
          label="Transparent"
          checked={output.transparent}
          defaultValue={false}
          onChange={(transparent) => setOutput({ transparent }, 'Transparent background')}
        />
        <SceneEmpty>The percentage scales the image without changing the framing, which is how a draft render is made small.</SceneEmpty>
      </SceneSection>

      <SceneSection id="scene-color" title="Colour management" {...folds}>
        <BarField
          label="Exposure"
          value={colour.exposure}
          min={-10}
          max={10}
          sliderMin={-4}
          sliderMax={4}
          step={0.01}
          defaultValue={0}
          onChange={(exposure) => setColour({ exposure }, 'Exposure')}
          {...gesture}
        />
        <BarField
          label="Gamma"
          value={colour.gamma}
          min={0.1}
          max={5}
          sliderMax={2}
          step={0.01}
          defaultValue={1}
          onChange={(gamma) => setColour({ gamma }, 'Gamma')}
          {...gesture}
        />
        <SceneEmpty>Exposure is a stop of light before the film curve; both apply to the rendered view and to the image it makes.</SceneEmpty>
      </SceneSection>
    </>
  )
}

/** What an image is rendered at until a document says otherwise: Blender's own starting frame. */
const DEFAULT_OUTPUT = { width: 1920, height: 1080, percentage: 100, transparent: false } as const

const DEFAULT_COLOR_MANAGEMENT = { exposure: 0, gamma: 1 } as const
