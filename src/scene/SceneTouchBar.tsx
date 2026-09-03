import { sceneIcon } from '@/scene/iconRegistry'
import type { EditorMode, SelectMode } from '@/scene/types'
import { IconButton } from '@/ui/Button'

/**
 * Edit mode on a narrow screen.
 *
 * Almost everything in a modelling editor is a key, and a phone has no keys. The bar puts the eight
 * things a person cannot work without on the glass — the mode, which kind of element is being
 * picked, the three transforms, extrude, delete, and a way to the rest — at forty-four pixels each,
 * and leaves everything else to the menus, which the same width already makes reachable.
 *
 * It appears only in edit mode and only where the layout has already folded: in object mode the T
 * bar and the header carry the same work, and on a wide screen the keyboard does.
 */

const ELEMENT_MODES: Array<{ value: SelectMode; label: string; icon: string }> = [
  { value: 'vertex', label: 'Vertex select', icon: 'vertex-mode' },
  { value: 'edge', label: 'Edge select', icon: 'edge-mode' },
  { value: 'face', label: 'Face select', icon: 'face-mode' },
]

const TRANSFORMS: Array<{ id: string; label: string; icon: string }> = [
  { id: 'transform.move', label: 'Move', icon: 'move' },
  { id: 'transform.rotate', label: 'Rotate', icon: 'rotate' },
  { id: 'transform.scale', label: 'Scale', icon: 'scale' },
]

export function SceneTouchBar({ mode, selectMode, onMode, onSelectMode, onRun, onMore }: {
  mode: EditorMode
  selectMode: SelectMode[]
  onMode: () => void
  onSelectMode: (kind: SelectMode) => void
  onRun: (operatorId: string) => void
  onMore: (at: { x: number; y: number }) => void
}) {
  if (mode !== 'edit') return null
  const Glyph = ({ name }: { name: string }) => {
    const Icon = sceneIcon(name)
    return Icon ? <Icon /> : null
  }

  return (
    <div className="scene-touchbar" role="toolbar" aria-label="Edit mode">
      <IconButton label="Object mode" className="scene-touchbar__button" onClick={onMode}>
        <Glyph name="mesh" />
      </IconButton>
      <span className="scene-touchbar__rule" aria-hidden="true" />
      {ELEMENT_MODES.map((entry) => (
        <IconButton
          key={entry.value}
          label={entry.label}
          className="scene-touchbar__button"
          aria-pressed={selectMode.includes(entry.value)}
          onClick={() => onSelectMode(entry.value)}
        >
          <Glyph name={entry.icon} />
        </IconButton>
      ))}
      <span className="scene-touchbar__rule" aria-hidden="true" />
      {TRANSFORMS.map((entry) => (
        <IconButton key={entry.id} label={entry.label} className="scene-touchbar__button" onClick={() => onRun(entry.id)}>
          <Glyph name={entry.icon} />
        </IconButton>
      ))}
      <IconButton label="Extrude region" className="scene-touchbar__button" onClick={() => onRun('mesh.extrudeRegion')}>
        <Glyph name="extrude" />
      </IconButton>
      <IconButton label="Delete" className="scene-touchbar__button" onClick={() => onRun('mesh.deleteVertices')}>
        <Glyph name="modifier" />
      </IconButton>
      <button
        type="button"
        className="scene-touchbar__more"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          onMore({ x: box.left, y: box.top })
        }}
      >
        More…
      </button>
    </div>
  )
}
