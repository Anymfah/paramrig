import { useState } from 'react'
import { uvMapsOf } from '@/scene/mesh/uv'
import { UvMapsSection } from '@/scene/panels/UvMapsSection'
import { meshOf } from '@/scene/document'
import { meshCounts } from '@/scene/mesh/data'
import { Exposable } from '@/scene/SceneExpose'
import { SceneEmpty, SceneSection } from '@/scene/SceneProperties'
import type { AreaShape, CameraData, EmptyData, EmptyDisplay, LightData, LightKind, MeshData, SceneDocument, SceneObject, Vec2 } from '@/scene/types'
import { BarField } from '@/ui/BarField'
import { Tooltip } from '@/ui/Tooltip'
import { ColorField } from '@/ui/ColorField'
import { NumberField } from '@/ui/NumberField'
import { SelectField } from '@/ui/SelectField'
import { SwitchField } from '@/ui/SwitchField'

/**
 * The Data tab: what the active object *is*, as opposed to where it is.
 *
 * Blender shows one object here, the active one, because the data of two objects is rarely the
 * same thing twice. A mesh reads out its numbers and nothing more for now — the tools that would
 * change them are the mesh editing work — while a light and a camera are fully editable.
 */

type Folds = {
  isOpen: (sectionId: string) => boolean
  onSection: (sectionId: string, open: boolean) => void
}

type Gesture = { onGestureStart: () => void; onGestureEnd: () => void }

const LIGHT_KINDS: Array<{ value: LightKind; label: string }> = [
  { value: 'point', label: 'Point' },
  { value: 'sun', label: 'Sun' },
  { value: 'spot', label: 'Spot' },
  { value: 'area', label: 'Area' },
]

const AREA_SHAPES: Array<{ value: AreaShape; label: string }> = [
  { value: 'square', label: 'Square' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'disk', label: 'Disk' },
  { value: 'ellipse', label: 'Ellipse' },
]

const EMPTY_DISPLAYS: Array<{ value: EmptyDisplay; label: string }> = [
  { value: 'plain-axes', label: 'Plain axes' },
  { value: 'arrows', label: 'Arrows' },
  { value: 'single-arrow', label: 'Single arrow' },
  { value: 'cube', label: 'Cube' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'circle', label: 'Circle' },
  { value: 'cone', label: 'Cone' },
  { value: 'image', label: 'Image' },
]

export function DataPanel({
  document,
  activeObject,
  unit,
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
  unit: string | undefined
  onUpdateObject: (id: string, patch: Partial<SceneObject>, label?: string) => void
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string) => void
  onRunOperator: (id: string, params?: Record<string, unknown>) => void
  onGestureStart: () => void
  onGestureEnd: () => void
} & Folds) {
  const folds = { isOpen, onSection }
  const gesture = { onGestureStart, onGestureEnd }

  if (!activeObject) {
    return (
      <div className="scene-properties__notice">
        <SceneEmpty>No active object. The Data tab shows one object at a time, the last one picked.</SceneEmpty>
      </div>
    )
  }

  const data = activeObject.data
  if (data.kind === 'mesh') {
    const mesh = meshOf(document, activeObject)
    return mesh
      ? (
        <MeshFields
          mesh={mesh}
          meshId={data.meshId}
          editing={document.view.mode === 'edit'}
          onEditDocument={onEditDocument}
          onRunOperator={onRunOperator}
          {...gesture}
          {...folds}
        />
      )
      : (
        <div className="scene-properties__notice">
          <SceneEmpty>This object points at a mesh the document no longer holds.</SceneEmpty>
        </div>
      )
  }
  if (data.kind === 'light') {
    return (
      <LightFields
        data={data}
        objectId={activeObject.id}
        unit={unit}
        onChange={(patch, label) => onUpdateObject(activeObject.id, { data: { ...data, ...patch } }, label)}
        {...gesture}
        {...folds}
      />
    )
  }
  if (data.kind === 'camera') {
    return (
      <CameraFields
        data={data}
        objectId={activeObject.id}
        unit={unit}
        onChange={(patch, label) => onUpdateObject(activeObject.id, { data: { ...data, ...patch } }, label)}
        {...gesture}
        {...folds}
      />
    )
  }
  return (
    <EmptyFields
      data={data}
      unit={unit}
      onChange={(patch, label) => onUpdateObject(activeObject.id, { data: { ...data, ...patch } }, label)}
      {...gesture}
      {...folds}
    />
  )
}

/**
 * A mesh's own data: how much of it there is, how it is shaded, and what it carries.
 *
 * The attributes are listed rather than edited. A seam, a crease and a sharp flag are put on by the
 * operators that mean something — Mark seam, ⇧E — and a list that let you tick them one at a time
 * would be a second way of doing the same thing with none of the context. What the list does offer
 * is the one thing the operators cannot: clearing a whole attribute at once.
 */
function MeshFields({ mesh, meshId, editing, onEditDocument, onRunOperator, onGestureStart, onGestureEnd, isOpen, onSection }: {
  mesh: MeshData
  meshId: string
  editing: boolean
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string) => void
  onRunOperator: (id: string, params?: Record<string, unknown>) => void
} & Gesture & Folds) {
  const counts = meshCounts(mesh)
  const smooth = mesh.autoSmooth
  const setAutoSmooth = (patch: { enabled?: boolean; angle?: number }, label: string) => {
    onEditDocument((current) => {
      const data = current.meshes[meshId]
      if (!data) return current
      const next = { enabled: smooth?.enabled ?? false, angle: smooth?.angle ?? 30, ...patch }
      return { ...current, meshes: { ...current.meshes, [meshId]: { ...data, autoSmooth: next } } }
    }, label)
  }
  const attributes = listAttributes(mesh)
  const reason = editing ? undefined : 'Open the mesh for editing to clear an attribute.'
  /*
   * The remesh settings are the panel's own rather than the document's: they are how a person is
   * about to rebuild this mesh, not something about the mesh, and Blender keeps them the same way.
   */
  const [voxel, setVoxel] = useState(0.1)
  const [preserveVolume, setPreserveVolume] = useState(true)

  return (
    <>
      <SceneSection id="data-mesh" title="Mesh" meta={`${counts.vertices.toLocaleString()} vertices`} isOpen={isOpen} onSection={onSection}>
        <dl className="scene-readout">
          <div className="scene-readout__row"><dt>Vertices</dt><dd>{counts.vertices.toLocaleString()}</dd></div>
          <div className="scene-readout__row"><dt>Edges</dt><dd>{counts.edges.toLocaleString()}</dd></div>
          <div className="scene-readout__row"><dt>Faces</dt><dd>{counts.faces.toLocaleString()}</dd></div>
          <div className="scene-readout__row"><dt>Triangles</dt><dd>{counts.triangles.toLocaleString()}</dd></div>
        </dl>
      </SceneSection>
      <SceneSection id="data-mesh-normals" title="Normals" isOpen={isOpen} onSection={onSection}>
        <SwitchField
          label="Auto smooth"
          checked={smooth?.enabled ?? false}
          onChange={(value) => setAutoSmooth({ enabled: value }, 'Auto smooth')}
        />
        <NumberField
          label="Angle"
          value={smooth?.angle ?? 30}
          min={0}
          max={180}
          step={1}
          unit="°"
          variant="field"
          disabled={!(smooth?.enabled ?? false)}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
          onChange={(value) => setAutoSmooth({ angle: value }, 'Auto smooth angle')}
        />
      </SceneSection>
      <UvMapsSection mesh={mesh} meshId={meshId} onEditDocument={onEditDocument} isOpen={isOpen} onSection={onSection} />
      <SceneSection id="data-mesh-attributes" title="Attributes" meta={`${attributes.length}`} isOpen={isOpen} onSection={onSection}>
        {attributes.length === 0 ? (
          <SceneEmpty>This mesh carries no attributes yet. Marking a seam or a sharp edge makes one.</SceneEmpty>
        ) : (
          <dl className="scene-readout">
            {attributes.map((attribute) => (
              <div key={attribute.name} className="scene-readout__row">
                <dt>{attribute.name}</dt>
                <dd>{attribute.domain} · {attribute.type} · {attribute.count.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
        )}
      </SceneSection>
      <SceneSection id="data-mesh-remesh" title="Remesh" isOpen={isOpen} onSection={onSection}>
        <NumberField
          label="Voxel size"
          value={voxel}
          min={0.005}
          max={2}
          step={0.005}
          unit="m"
          variant="field"
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
          onChange={setVoxel}
        />
        <SwitchField label="Preserve volume" checked={preserveVolume} onChange={setPreserveVolume} />
        <div className="scene-buttons">
          <Tooltip content="Rebuild this mesh as an even grid of quads">
            <button
              type="button"
              className="scene-button"
              onClick={() => onRunOperator('mesh.remesh', { voxelSize: voxel, preserveVolume })}
            >
              Voxel remesh
            </button>
          </Tooltip>
        </div>
        <SceneEmpty>
          A remesh keeps the shape and nothing else: the UV maps, the mask and any selection are
          expressed in the old topology and go with it.
        </SceneEmpty>
      </SceneSection>
      <SceneSection id="data-mesh-geometry" title="Geometry data" isOpen={isOpen} onSection={onSection}>
        <div className="scene-buttons">
          {[
            { id: 'mesh.clearSharp', label: 'Clear sharp' },
            { id: 'mesh.clearSeam', label: 'Clear seam' },
            { id: 'mesh.setCrease', label: 'Clear crease', params: { value: 0 } },
            { id: 'mesh.setBevelWeight', label: 'Clear bevel weight', params: { value: 0 } },
          ].map((entry) => (
            <Tooltip key={entry.id} content={reason ?? entry.label}>
              <button
                type="button"
                className="scene-button"
                disabled={!editing}
                onClick={() => onRunOperator(entry.id, entry.params)}
              >
                {entry.label}
              </button>
            </Tooltip>
          ))}
        </div>
        {editing ? null : <SceneEmpty>{reason}</SceneEmpty>}
      </SceneSection>
    </>
  )
}

/** What a mesh carries beyond its geometry, in the form the Data tab lists it. */
function listAttributes(mesh: MeshData): Array<{ name: string; domain: string; type: string; count: number }> {
  const found: Array<{ name: string; domain: string; type: string; count: number }> = []
  const edge = mesh.attributes.edge
  for (const map of uvMapsOf(mesh)) {
    found.push({ name: map.name, domain: 'corner', type: '2D vector', count: Math.floor(map.data.length / 2) })
  }
  if (mesh.attributes.vertex.color) {
    found.push({ name: 'Color', domain: 'point', type: 'colour', count: mesh.vertexIds.length })
  }
  if (edge.seam?.some(Boolean)) found.push({ name: 'Seam', domain: 'edge', type: 'boolean', count: edge.seam.filter(Boolean).length })
  if (edge.sharp?.some(Boolean)) found.push({ name: 'Sharp', domain: 'edge', type: 'boolean', count: edge.sharp.filter(Boolean).length })
  if (edge.crease?.some((value) => value > 0)) {
    found.push({ name: 'Crease', domain: 'edge', type: 'float', count: edge.crease.filter((value) => value > 0).length })
  }
  if (edge.bevelWeight?.some((value) => value > 0)) {
    found.push({ name: 'Bevel weight', domain: 'edge', type: 'float', count: edge.bevelWeight.filter((value) => value > 0).length })
  }
  if (mesh.attributes.face.smooth.some(Boolean)) {
    found.push({ name: 'Shade smooth', domain: 'face', type: 'boolean', count: mesh.attributes.face.smooth.filter(Boolean).length })
  }
  return found
}

function LightFields({ data, objectId, unit, onChange, onGestureStart, onGestureEnd, isOpen, onSection }: {
  data: LightData
  /** The object the light belongs to, which is what a control writing to it binds against. */
  objectId: string
  unit: string | undefined
  onChange: (patch: Partial<LightData>, label: string) => void
} & Gesture & Folds) {
  const gesture = { onGestureStart, onGestureEnd }
  const sun = data.light === 'sun'
  const sized = data.areaShape === 'rectangle' || data.areaShape === 'ellipse'
  const setAreaSize = (axis: 0 | 1, value: number) => {
    const size: Vec2 = [data.areaSize[0], data.areaSize[1]]
    size[axis] = value
    onChange({ areaSize: size }, 'Light size')
  }
  return (
    <>
      <SceneSection id="data-light" title="Light" meta={LIGHT_KINDS.find((kind) => kind.value === data.light)?.label} isOpen={isOpen} onSection={onSection}>
        <SelectField
          label="Type"
          value={data.light}
          options={LIGHT_KINDS}
          onChange={(value) => {
            const kind = LIGHT_KINDS.find((entry) => entry.value === value)
            if (kind) onChange({ light: kind.value }, 'Light type')
          }}
        />
        <Exposable property="light.color" objectId={objectId}><ColorField label="Colour" value={data.color} onChange={(color) => onChange({ color }, 'Light colour')} {...gesture} /></Exposable>
        <Exposable property="light.power" objectId={objectId} min={0} max={sun ? 100 : 100000} step={sun ? 0.1 : 1}>
          <NumberField
            // A sun is measured where the light lands, not at the lamp: irradiance, not wattage.
            label={sun ? 'Strength' : 'Power'}
            value={data.power}
            min={0}
            max={sun ? 100 : 100000}
            step={sun ? 0.1 : 1}
            unit={sun ? 'W/m²' : 'W'}
            variant="field"
            onChange={(power) => onChange({ power }, 'Light power')}
            {...gesture}
          />
        </Exposable>
        <Exposable property="light.radius" objectId={objectId} min={0} max={100} step={0.01}>
          <NumberField
            label="Radius"
            value={data.radius}
            min={0}
            max={100}
            step={0.01}
            unit={unit}
            variant="field"
            onChange={(radius) => onChange({ radius }, 'Light radius')}
            {...gesture}
          />
        </Exposable>
        <SwitchField label="Shadow" checked={data.shadow} onChange={(shadow) => onChange({ shadow }, 'Light shadow')} />
        <NumberField
          label="Custom distance"
          value={data.distance ?? 0}
          min={0}
          max={10000}
          step={0.1}
          unit={unit}
          variant="field"
          onChange={(distance) => onChange({ distance }, 'Light distance')}
          {...gesture}
        />
        <SceneEmpty>A custom distance of zero lets the light carry as far as it reaches.</SceneEmpty>
      </SceneSection>
      {data.light === 'spot' ? (
        <SceneSection id="data-light-spot" title="Spot shape" isOpen={isOpen} onSection={onSection}>
          <Exposable property="light.spotAngle" objectId={objectId} min={1} max={180} step={0.5}>
            <NumberField
              label="Spot size"
              value={data.spotAngle}
              min={1}
              max={180}
              step={0.5}
              unit="°"
              variant="field"
              onChange={(spotAngle) => onChange({ spotAngle }, 'Spot size')}
              {...gesture}
            />
          </Exposable>
          <Exposable property="light.spotBlend" objectId={objectId} min={0} max={1} step={0.01}>
            <BarField
              label="Blend"
              value={data.spotBlur}
              min={0}
              max={1}
              step={0.01}
              onChange={(spotBlur) => onChange({ spotBlur }, 'Spot blend')}
              {...gesture}
            />
          </Exposable>
        </SceneSection>
      ) : null}
      {data.light === 'area' ? (
        <SceneSection id="data-light-area" title="Area shape" isOpen={isOpen} onSection={onSection}>
          <SelectField
            label="Shape"
            value={data.areaShape}
            options={AREA_SHAPES}
            onChange={(value) => {
              const shape = AREA_SHAPES.find((entry) => entry.value === value)
              if (shape) onChange({ areaShape: shape.value }, 'Light shape')
            }}
          />
          <NumberField
            label={sized ? 'Size X' : 'Size'}
            value={data.areaSize[0]}
            min={0}
            max={1000}
            step={0.01}
            unit={unit}
            variant="field"
            onChange={(value) => setAreaSize(0, value)}
            {...gesture}
          />
          {sized ? (
            <NumberField
              label="Size Y"
              value={data.areaSize[1]}
              min={0}
              max={1000}
              step={0.01}
              unit={unit}
              variant="field"
              onChange={(value) => setAreaSize(1, value)}
              {...gesture}
            />
          ) : null}
        </SceneSection>
      ) : null}
    </>
  )
}

function CameraFields({ data, objectId, unit, onChange, onGestureStart, onGestureEnd, isOpen, onSection }: {
  data: CameraData
  /** The object the camera belongs to, which is what a control writing to it binds against. */
  objectId: string
  unit: string | undefined
  onChange: (patch: Partial<CameraData>, label: string) => void
} & Gesture & Folds) {
  const gesture = { onGestureStart, onGestureEnd }
  const depth = data.depthOfField ?? { enabled: false, focusDistance: 10, fStop: 2.8 }
  const setDepth = (patch: Partial<NonNullable<CameraData['depthOfField']>>, label: string) => {
    onChange({ depthOfField: { ...depth, ...patch } }, label)
  }
  return (
    <>
      <SceneSection id="data-camera" title="Lens" isOpen={isOpen} onSection={onSection}>
        <SelectField
          label="Projection"
          value={data.projection}
          options={[{ value: 'perspective', label: 'Perspective' }, { value: 'orthographic', label: 'Orthographic' }]}
          onChange={(value) => onChange({ projection: value === 'orthographic' ? 'orthographic' : 'perspective' }, 'Projection')}
        />
        {data.projection === 'perspective' ? (
          <>
            <Exposable property="camera.focalLength" objectId={objectId} min={1} max={5000} step={0.1}>
              <NumberField
                label="Focal length"
                value={data.focalLength}
                min={1}
                max={5000}
                step={0.1}
                unit="mm"
                variant="field"
                onChange={(focalLength) => onChange({ focalLength }, 'Focal length')}
                {...gesture}
              />
            </Exposable>
            <NumberField
              label="Sensor width"
              value={data.sensor}
              min={1}
              max={200}
              step={0.1}
              unit="mm"
              variant="field"
              onChange={(sensor) => onChange({ sensor }, 'Sensor width')}
              {...gesture}
            />
          </>
        ) : (
          <Exposable property="camera.orthoScale" objectId={objectId} min={0.001} max={10000} step={0.01}>
            <NumberField
              label="Ortho scale"
              value={data.orthoScale}
              min={0.001}
              max={10000}
              step={0.01}
              variant="field"
              onChange={(orthoScale) => onChange({ orthoScale }, 'Ortho scale')}
              {...gesture}
            />
          </Exposable>
        )}
        <NumberField
          label="Clip start"
          value={data.clipStart}
          min={0.0001}
          max={10000}
          step={0.01}
          unit={unit}
          variant="field"
          onChange={(clipStart) => onChange({ clipStart }, 'Clip start')}
          {...gesture}
        />
        <NumberField
          label="Clip end"
          value={data.clipEnd}
          min={0.001}
          max={1000000}
          step={0.1}
          unit={unit}
          variant="field"
          onChange={(clipEnd) => onChange({ clipEnd }, 'Clip end')}
          {...gesture}
        />
      </SceneSection>
      <SceneSection id="data-camera-depth" title="Depth of field" isOpen={isOpen} onSection={onSection}>
        <SwitchField label="Depth of field" checked={depth.enabled} onChange={(enabled) => setDepth({ enabled }, 'Depth of field')} />
        <NumberField
          label="Focus distance"
          value={depth.focusDistance}
          min={0}
          max={100000}
          step={0.01}
          unit={unit}
          variant="field"
          disabled={!depth.enabled}
          onChange={(focusDistance) => setDepth({ focusDistance }, 'Focus distance')}
          {...gesture}
        />
        <NumberField
          label="F-stop"
          value={depth.fStop}
          min={0.1}
          max={128}
          step={0.1}
          variant="field"
          disabled={!depth.enabled}
          onChange={(fStop) => setDepth({ fStop }, 'F-stop')}
          {...gesture}
        />
        <SceneEmpty>The viewport blurs nothing; the render pass is what reads these.</SceneEmpty>
      </SceneSection>
    </>
  )
}

function EmptyFields({ data, unit, onChange, onGestureStart, onGestureEnd, isOpen, onSection }: {
  data: EmptyData
  unit: string | undefined
  onChange: (patch: Partial<EmptyData>, label: string) => void
} & Gesture & Folds) {
  return (
    <SceneSection id="data-empty" title="Empty" isOpen={isOpen} onSection={onSection}>
      <SelectField
        label="Display as"
        value={data.display}
        options={EMPTY_DISPLAYS}
        onChange={(value) => {
          const display = EMPTY_DISPLAYS.find((entry) => entry.value === value)
          if (display) onChange({ display: display.value }, 'Empty display')
        }}
      />
      <NumberField
        label="Size"
        value={data.size}
        min={0.001}
        max={10000}
        step={0.01}
        unit={unit}
        variant="field"
        onChange={(size) => onChange({ size }, 'Empty size')}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
      />
    </SceneSection>
  )
}
