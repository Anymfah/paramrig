import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { EDGE_MENU, EDIT_SELECT_MENU, EDIT_VIEW_MENU, FACE_MENU, MESH_MENU, VERTEX_MENU } from '@/scene/editMenus'
import { menuEntries } from '@/scene/commands'
import { sceneIcon } from '@/scene/iconRegistry'
import { MATCAPS, MATCAP_LABELS } from '@/scene/viewport/matcap'
import { bindingFor, shortcutLabel } from '@/scene/keymap'
import type { OperatorContext } from '@/scene/operators/types'
import { SceneMenu, type SceneMenuEntry } from '@/scene/SceneMenu'
import type {
  EditorMode,
  GizmoFlags,
  OverlayFlags,
  PivotPoint,
  SelectMode,
  ShadingMode,
  SnapMode,
  SnapTarget,
  TransformOrientation,
  ViewState,
} from '@/scene/types'
import { IconButton } from '@/ui/Button'
import { IconDoc, IconSearch, IconSliders } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { useRovingFocus } from '@/ui/useRovingFocus'

/**
 * The bar across the top of the viewport: what is being edited, on what, and how it is drawn.
 *
 * Blender's header divides in two. On the left is what the editor *does* — the mode, and the menus
 * that hold every operator of that mode — and on the right is how the viewport *looks and
 * behaves*, which is state rather than action: an orientation, a pivot, snapping, the shading, the
 * overlays. That division is kept here because it is the one a Blender user already navigates by,
 * and because it falls out cleanly in the code: everything on the left runs an operator through
 * `onRunOperator`, and everything on the right writes `ViewState` through `onView`.
 *
 * The menus are not written out. Each is a list of operator ids, declared at the top of this file,
 * that `menuEntries` turns into commands against the registry: an id no family has registered yet
 * is left out, and one whose operator refuses here is drawn greyed with its reason. So a menu is
 * never a promise the editor cannot keep, and a family that lands later needs no edit here.
 */

/* ------------------------------------------------------------- the menus */

/*
 * Operator ids, in the order Blender lists them, with '-' where a rule goes. `menuEntries` drops
 * an id no family registered, so these lists may name operators that arrive in a later prompt:
 * that is deliberate, and is what lets a menu fill itself in as the families land.
 */

const VIEW_MENU: Array<string | '-'> = [
  'view.frameSelected', 'view.frameAll', '-',
  'view.front', 'view.back', 'view.right', 'view.left', 'view.top', 'view.bottom', '-',
  'view.opposite', 'view.togglePerspective', '-',
  'view.camera', 'view.local',
]

const SELECT_MENU: Array<string | '-'> = [
  'select.all', 'select.none', 'select.invert', '-',
  'select.box', 'select.circle', 'select.lasso', '-',
  'select.allByType', 'select.grouped', 'select.linkedData', '-',
  'select.similar', 'select.pattern', 'select.random',
]

const ADD_MENU: Array<string | '-'> = [
  'add.plane', 'add.cube', 'add.circle', 'add.uvSphere', 'add.icoSphere',
  'add.cylinder', 'add.cone', 'add.torus', 'add.grid', 'add.paramRigMark', '-',
  'add.lightPoint', 'add.lightSun', 'add.lightSpot', 'add.lightArea', '-',
  'add.camera', 'add.empty',
]

const OBJECT_MENU: Array<string | '-'> = [
  'transform.move', 'transform.rotate', 'transform.scale', '-',
  'object.clearLocation', 'object.clearRotation', 'object.clearScale', 'object.apply', '-',
  'object.duplicate', 'object.duplicateLinked', 'object.join', 'object.setOrigin', '-',
  'object.parent', 'object.clearParent', 'object.moveToCollection', 'object.linkToCollection', '-',
  'object.shadeSmooth', 'object.shadeFlat', '-',
  'object.hide', 'object.hideUnselected', 'object.revealHidden', '-',
  'object.rename', 'object.copy', 'object.paste', 'object.delete',
]

const OBJECT_MODE_MENUS: Array<{ label: string; ids: Array<string | '-'> }> = [
  { label: 'View', ids: VIEW_MENU },
  { label: 'Select', ids: SELECT_MENU },
  { label: 'Add', ids: ADD_MENU },
  { label: 'Object', ids: OBJECT_MENU },
]

const EDIT_MODE_MENUS: Array<{ label: string; ids: Array<string | '-'> }> = [
  { label: 'View', ids: EDIT_VIEW_MENU },
  { label: 'Select', ids: EDIT_SELECT_MENU },
  { label: 'Mesh', ids: MESH_MENU },
  { label: 'Vertex', ids: VERTEX_MENU },
  { label: 'Edge', ids: EDGE_MENU },
  { label: 'Face', ids: FACE_MENU },
]

/* ------------------------------------------------------- the view's state */

const MODES: Array<{ value: EditorMode; label: string }> = [
  { value: 'object', label: 'Object mode' },
  { value: 'edit', label: 'Edit mode' },
  { value: 'sculpt', label: 'Sculpt mode' },
]

const SCULPT_REASON = 'Sculpt mode is not in this build yet.'

/** Solid shading's three ways of lighting a surface, and the five colours it can take. */
const SOLID_LIGHTING: Array<{ value: 'studio' | 'matcap' | 'flat'; label: string }> = [
  { value: 'studio', label: 'Studio' },
  { value: 'matcap', label: 'Matcap' },
  { value: 'flat', label: 'Flat' },
]

const SOLID_COLOURS: Array<{ value: 'material' | 'object' | 'single' | 'random' | 'texture'; label: string }> = [
  { value: 'material', label: 'Material' },
  { value: 'object', label: 'Object' },
  { value: 'single', label: 'Single' },
  { value: 'random', label: 'Random' },
  { value: 'texture', label: 'Texture' },
]

/** What the menu shows before a document has said otherwise; the same defaults the document has. */
const DEFAULT_SOLID: NonNullable<ViewState['solid']> = {
  lighting: 'studio',
  matcap: 'basic',
  colour: 'material',
  single: '#b4b4b4',
  background: 'theme',
  backfaceCulling: false,
  cavity: false,
  cavityStrength: 0.5,
  shadow: false,
  outline: true,
  specular: true,
}

const SELECT_MODES: Array<{ value: SelectMode; label: string; icon: string }> = [
  { value: 'vertex', label: 'Vertex select', icon: 'vertex-mode' },
  { value: 'edge', label: 'Edge select', icon: 'edge-mode' },
  { value: 'face', label: 'Face select', icon: 'face-mode' },
]

const ORIENTATIONS: Array<{ value: TransformOrientation; label: string }> = [
  { value: 'global', label: 'Global' },
  { value: 'local', label: 'Local' },
  { value: 'normal', label: 'Normal' },
  { value: 'gimbal', label: 'Gimbal' },
  { value: 'view', label: 'View' },
  { value: 'cursor', label: 'Cursor' },
]

const PIVOTS: Array<{ value: PivotPoint; label: string }> = [
  { value: 'bounding-box', label: 'Bounding box centre' },
  { value: 'cursor', label: '3D cursor' },
  { value: 'individual', label: 'Individual origins' },
  { value: 'median', label: 'Median point' },
  { value: 'active', label: 'Active element' },
]

const SNAP_MODES: Array<{ value: SnapMode; label: string; icon?: string }> = [
  { value: 'increment', label: 'Increment', icon: 'snap-increment' },
  { value: 'vertex', label: 'Vertex', icon: 'snap-vertex' },
  { value: 'edge', label: 'Edge', icon: 'snap-edge' },
  { value: 'face', label: 'Face', icon: 'snap-face' },
  { value: 'volume', label: 'Volume', icon: 'snap-volume' },
  { value: 'edge-center', label: 'Edge centre' },
  { value: 'edge-perpendicular', label: 'Edge perpendicular' },
]

const SNAP_TARGETS: Array<{ value: SnapTarget; label: string }> = [
  { value: 'closest', label: 'Snap to closest' },
  { value: 'center', label: 'Snap to centre' },
  { value: 'median', label: 'Snap to median' },
  { value: 'active', label: 'Snap to active' },
]

const FALLOFFS: Array<{ value: ViewState['proportionalFalloff']; label: string }> = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'root', label: 'Root' },
  { value: 'inverse-square', label: 'Inverse square' },
  { value: 'sharp', label: 'Sharp' },
  { value: 'linear', label: 'Linear' },
  { value: 'constant', label: 'Constant' },
  { value: 'random', label: 'Random' },
]

const SHADINGS: Array<{ value: ShadingMode; label: string }> = [
  { value: 'wireframe', label: 'Wireframe' },
  { value: 'solid', label: 'Solid' },
  { value: 'material', label: 'Material preview' },
  { value: 'rendered', label: 'Rendered' },
]

const VIEWPORT_OVERLAYS: Array<{ key: OverlaySwitch; label: string }> = [
  { key: 'grid', label: 'Grid' },
  { key: 'floor', label: 'Floor' },
  { key: 'axisX', label: 'X axis' },
  { key: 'axisY', label: 'Y axis' },
  { key: 'axisZ', label: 'Z axis' },
  { key: 'cursor', label: '3D cursor' },
  { key: 'outline', label: 'Outline' },
  { key: 'extras', label: 'Extras' },
  { key: 'statistics', label: 'Statistics' },
  { key: 'textInfo', label: 'Text info' },
]

/** The overlays that are switches, which is every one of them but the normals' length. */
type OverlaySwitch = { [Key in keyof OverlayFlags]: OverlayFlags[Key] extends boolean ? Key : never }[keyof OverlayFlags]

const EDIT_OVERLAYS: Array<{ key: OverlaySwitch; label: string }> = [
  { key: 'wireframe', label: 'Wireframe' },
  { key: 'faceCentres', label: 'Face centres' },
  { key: 'faceOrientation', label: 'Face orientation' },
  { key: 'normals', label: 'Normals' },
  { key: 'seams', label: 'Seams' },
  { key: 'sharp', label: 'Sharp edges' },
  { key: 'creases', label: 'Creases' },
  { key: 'bevelWeight', label: 'Bevel weight' },
  { key: 'indices', label: 'Indices' },
  { key: 'edgeLength', label: 'Edge length' },
  { key: 'edgeAngle', label: 'Edge angle' },
  { key: 'faceArea', label: 'Face area' },
]

const GIZMOS: Array<{ key: keyof GizmoFlags; label: string }> = [
  { key: 'navigate', label: 'Navigation gizmo' },
  { key: 'object', label: 'Active object' },
  { key: 'move', label: 'Move' },
  { key: 'rotate', label: 'Rotate' },
  { key: 'scale', label: 'Scale' },
]

/**
 * Under this width the right-hand half folds into one popover. The header is the one strip that
 * may not wrap or scroll — a control that moves under the pointer between two frames of a gesture
 * is worse than one that has to be opened — so the width is a real breakpoint, not a hint.
 */
const NARROW_HEADER_PX = 720

/**
 * The header folds by its own width, not the window's. It sits between the outliner and the
 * properties editor, both of which the person can widen: a header that only listened to the window
 * would still be overflowing its column on a wide screen with both panels open.
 */
function useNarrowHeader(element: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const node = element.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? node.clientWidth
      // Hysteresis, so a header sitting exactly on the threshold does not flicker as it folds.
      setNarrow((current) => (current ? width < NARROW_HEADER_PX + 40 : width < NARROW_HEADER_PX))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [element])
  return narrow
}

/**
 * The chord a control shows, read from the keymap and from nowhere else, so a tooltip can never
 * promise a key the editor does not answer to. A control the keymap has not bound shows no chord.
 */
function chordFor(actionId: string): string | undefined {
  const binding = bindingFor(actionId)
  return binding ? shortcutLabel(binding) : undefined
}

function tipFor(label: string, actionId: string): string {
  const chord = chordFor(actionId)
  return chord ? `${label} · ${chord}` : label
}

function SceneGlyph({ name }: { name: string }) {
  const Glyph = sceneIcon(name)
  return Glyph ? <Glyph className="scene-header__glyph" /> : null
}

/** A pressed-or-not button in one of the header's groups. */
function ToggleButton({ label, tip, icon, pressed, onPress }: {
  label: string
  tip: string
  icon: string
  pressed: boolean
  onPress: () => void
}) {
  return (
    <Tooltip content={tip}>
      <IconButton label={label} className="scene-header__button" aria-pressed={pressed} onClick={onPress}>
        <SceneGlyph name={icon} />
      </IconButton>
    </Tooltip>
  )
}

/**
 * The folded half of the header, as a panel rather than a menu: what it holds is a set of
 * controls, and a `role="menu"` around a row of toggles would lie about how it is operated.
 */
function HeaderSettings({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
    if (triggerRef.current?.isConnected) triggerRef.current.focus()
  }

  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const anchor = triggerRef.current?.getBoundingClientRect()
    if (!panel || !anchor) return
    const size = panel.getBoundingClientRect()
    const viewWidth = document.documentElement.clientWidth || window.innerWidth
    setPlacement({
      top: anchor.bottom + 4,
      left: Math.max(8, Math.min(anchor.right - size.width, viewWidth - size.width - 8)),
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  return (
    <>
      <Tooltip content={label}>
        <button
          type="button"
          ref={triggerRef}
          className="icon-btn icon-btn--ghost scene-header__button"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <IconSliders />
        </button>
      </Tooltip>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="popover scene-header__settings"
              role="dialog"
              aria-label={label}
              tabIndex={-1}
              data-placed={placement ? '' : undefined}
              style={{ top: placement?.top ?? 0, left: placement?.left ?? 0 }}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                close()
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

export function SceneHeader({ view, mode, context, onRunOperator, onView, onMode, onCommand }: {
  view: ViewState
  mode: EditorMode
  context: OperatorContext | null
  onRunOperator: (id: string, params?: Record<string, unknown>) => void
  onView: (patch: Partial<ViewState>) => void
  onMode: (mode: EditorMode) => void
  /** The editor's own actions: the palette, the keymap sheet. */
  onCommand: (id: string) => void
}) {
  const barRef = useRef<HTMLDivElement>(null)
  useRovingFocus(barRef)
  const narrow = useNarrowHeader(barRef)

  const runOperator = (id: string) => onRunOperator(id)
  const menus = mode === 'edit' ? EDIT_MODE_MENUS : OBJECT_MODE_MENUS
  const modeLabel = MODES.find((entry) => entry.value === mode)?.label ?? 'Object mode'

  const modeEntries: SceneMenuEntry[] = MODES.map((entry) => ({
    id: `mode.${entry.value}`,
    label: entry.label,
    checked: entry.value === mode,
    ...(entry.value === 'sculpt' ? { disabled: true, reason: SCULPT_REASON } : { shortcut: chordFor('mode.toggleEdit') }),
    run: () => onMode(entry.value),
  }))

  const orientationEntries: SceneMenuEntry[] = ORIENTATIONS.map((entry) => ({
    id: `orientation.${entry.value}`,
    label: entry.label,
    icon: `orientation-${entry.value}`,
    checked: view.orientation === entry.value,
    run: () => onView({ orientation: entry.value }),
  }))

  const pivotEntries: SceneMenuEntry[] = PIVOTS.map((entry) => ({
    id: `pivot.${entry.value}`,
    label: entry.label,
    icon: `pivot-${entry.value}`,
    checked: view.pivot === entry.value,
    run: () => onView({ pivot: entry.value }),
  }))

  const snapEntries: SceneMenuEntry[] = [
    ...SNAP_MODES.map((entry) => ({
      id: `snap.${entry.value}`,
      label: entry.label,
      ...(entry.icon ? { icon: entry.icon } : {}),
      checked: view.snapMode === entry.value,
      run: () => onView({ snapMode: entry.value, snapEnabled: true }),
    })),
    { separator: true },
    ...SNAP_TARGETS.map((entry) => ({
      id: `snapTarget.${entry.value}`,
      label: entry.label,
      checked: view.snapTarget === entry.value,
      run: () => onView({ snapTarget: entry.value }),
    })),
  ]

  const falloffEntries: SceneMenuEntry[] = FALLOFFS.map((entry) => ({
    id: `falloff.${entry.value}`,
    label: entry.label,
    checked: view.proportionalFalloff === entry.value,
    run: () => onView({ proportionalFalloff: entry.value, proportional: true }),
  }))

  /** Every overlay in the menu is a switch; the one number among them is set in the sidebar. */
  const overlayFlag = (key: OverlaySwitch, label: string): SceneMenuEntry => ({
    id: `overlay.${key}`,
    label,
    choice: 'check',
    checked: view.overlays[key],
    run: () => onView({ overlays: { ...view.overlays, [key]: !view.overlays[key] } }),
  })

  const editOverlayEntries: SceneMenuEntry[] = mode === 'edit'
    ? [{ separator: true }, ...EDIT_OVERLAYS.map((entry) => overlayFlag(entry.key, entry.label))]
    : []

  const overlayEntries: SceneMenuEntry[] = [
    ...VIEWPORT_OVERLAYS.map((entry) => overlayFlag(entry.key, entry.label)),
    ...editOverlayEntries,
  ]

  /**
   * Solid shading's own settings, in one menu under the mode buttons — where Blender puts them.
   *
   * They are grouped rather than listed: how it is lit, what colour it takes, and the switches. A
   * flat list of fifteen entries would be a wall, and these are settings a person returns to often
   * enough to learn the shape of.
   */
  const solid = view.solid ?? DEFAULT_SOLID
  const setSolid = (patch: Partial<NonNullable<ViewState['solid']>>) => onView({ solid: { ...solid, ...patch } })
  const shadingEntries: SceneMenuEntry[] = [
    { heading: 'Lighting' },
    ...SOLID_LIGHTING.map((entry) => ({
      id: `solid.lighting.${entry.value}`,
      label: entry.label,
      checked: solid.lighting === entry.value,
      run: () => setSolid({ lighting: entry.value }),
    })),
    ...(solid.lighting === 'matcap'
      ? [
        { heading: 'Matcap' } as SceneMenuEntry,
        ...MATCAPS.map((name) => ({
          id: `solid.matcap.${name}`,
          label: MATCAP_LABELS[name],
          checked: solid.matcap === name,
          run: () => setSolid({ matcap: name }),
        })),
      ]
      : []),
    { heading: 'Colour' },
    ...SOLID_COLOURS.map((entry) => ({
      id: `solid.colour.${entry.value}`,
      label: entry.label,
      checked: solid.colour === entry.value,
      run: () => setSolid({ colour: entry.value }),
    })),
    { heading: 'Options' },
    {
      id: 'solid.cavity',
      label: 'Cavity',
      choice: 'check' as const,
      checked: solid.cavity,
      run: () => setSolid({ cavity: !solid.cavity }),
    },
    {
      id: 'solid.backfaceCulling',
      label: 'Backface culling',
      choice: 'check' as const,
      checked: solid.backfaceCulling,
      run: () => setSolid({ backfaceCulling: !solid.backfaceCulling }),
    },
    {
      id: 'solid.specular',
      label: 'Specular lighting',
      choice: 'check' as const,
      checked: solid.specular,
      run: () => setSolid({ specular: !solid.specular }),
    },
  ]

  const gizmoEntries: SceneMenuEntry[] = GIZMOS.map((entry) => ({
    id: `gizmo.${entry.key}`,
    label: entry.label,
    choice: 'check',
    checked: view.gizmos[entry.key],
    run: () => onView({ gizmos: { ...view.gizmos, [entry.key]: !view.gizmos[entry.key] } }),
  }))

  const chooseSelectMode = (kind: SelectMode, extend: boolean) => {
    if (!extend) {
      onView({ selectMode: [kind] })
      return
    }
    const next = view.selectMode.includes(kind)
      ? view.selectMode.filter((entry) => entry !== kind)
      : [...view.selectMode, kind]
    onView({ selectMode: next.length > 0 ? next : [kind] })
  }

  /*
   * Every one of these writes `ViewState` and nothing else, which is what lets the same markup be
   * rendered in the bar or inside the folded popover without a second copy of any of it.
   */
  const viewSettings = (
    <>
      <div className="scene-header__group" role="group" aria-label="Transform">
        <SceneMenu
          variant="icon"
          icon={`orientation-${view.orientation}`}
          label="Transform orientation"
          shortcut={chordFor('pie.orientation')}
          entries={orientationEntries}
        />
        <SceneMenu
          variant="icon"
          icon={`pivot-${view.pivot}`}
          label="Pivot point"
          shortcut={chordFor('pie.pivot')}
          entries={pivotEntries}
        />
        <div className="scene-header__pair">
          <ToggleButton
            label="Snapping"
            tip="Snapping"
            icon="snap"
            pressed={view.snapEnabled}
            onPress={() => onView({ snapEnabled: !view.snapEnabled })}
          />
          <SceneMenu variant="chevron" label="Snapping options" entries={snapEntries} />
        </div>
        <div className="scene-header__pair">
          <ToggleButton
            label="Proportional editing"
            tip="Proportional editing"
            icon="proportional"
            pressed={view.proportional}
            onPress={() => onView({ proportional: !view.proportional })}
          />
          <SceneMenu variant="chevron" label="Proportional falloff" entries={falloffEntries} />
        </div>
      </div>
      <div className="scene-header__group" role="group" aria-label="Viewport shading">
        {SHADINGS.map((entry) => (
          <ToggleButton
            key={entry.value}
            label={entry.label}
            tip={tipFor(entry.label, 'pie.shading')}
            icon={`shading-${entry.value}`}
            pressed={view.shading === entry.value}
            onPress={() => onView({ shading: entry.value })}
          />
        ))}
        <SceneMenu variant="chevron" label="Shading options" entries={shadingEntries} />
      </div>
      <div className="scene-header__group" role="group" aria-label="Overlays and gizmos">
        <SceneMenu variant="icon" icon="overlays" label="Overlays" entries={overlayEntries} />
        <SceneMenu variant="icon" icon="gizmos" label="Gizmos" entries={gizmoEntries} />
        <ToggleButton
          label="X-ray"
          tip="X-ray"
          icon="xray"
          pressed={view.xray}
          onPress={() => onView({ xray: !view.xray })}
        />
      </div>
    </>
  )

  return (
    <div ref={barRef} className="scene-header" role="toolbar" aria-label="Scene tools" aria-orientation="horizontal">
      <SceneMenu
        label={modeLabel}
        className="scene-header__mode"
        shortcut={chordFor('mode.toggleEdit')}
        entries={modeEntries}
      />
      {mode === 'edit' ? (
        <div className="scene-header__group" role="group" aria-label="Mirror editing">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <Tooltip key={axis} content={`Mirror editing on ${axis.toUpperCase()}`}>
              <IconButton
                label={`Mirror ${axis.toUpperCase()}`}
                className="scene-header__button scene-header__axis"
                aria-pressed={view.symmetry?.[axis] === true}
                onClick={() => onView({
                  symmetry: {
                    x: view.symmetry?.x === true,
                    y: view.symmetry?.y === true,
                    z: view.symmetry?.z === true,
                    [axis]: !(view.symmetry?.[axis] === true),
                  },
                })}
              >
                <span aria-hidden="true">{axis.toUpperCase()}</span>
              </IconButton>
            </Tooltip>
          ))}
        </div>
      ) : null}
      {mode === 'edit' ? (
        <div className="scene-header__group" role="group" aria-label="Selection mode">
          {SELECT_MODES.map((entry) => (
            <Tooltip key={entry.value} content={entry.label}>
              <IconButton
                label={entry.label}
                className="scene-header__button"
                aria-pressed={view.selectMode.includes(entry.value)}
                onClick={(event) => chooseSelectMode(entry.value, event.shiftKey)}
              >
                <SceneGlyph name={entry.icon} />
              </IconButton>
            </Tooltip>
          ))}
        </div>
      ) : null}
      <div className="scene-header__group scene-header__menus">
        {menus.map((menu) => (
          <SceneMenu key={menu.label} label={menu.label} entries={menuEntries(menu.ids, context, runOperator)} />
        ))}
      </div>
      <div className="scene-header__spacer" />
      {narrow ? <HeaderSettings label="View settings">{viewSettings}</HeaderSettings> : viewSettings}
      <div className="scene-header__group" role="group" aria-label="Editor">
        <Tooltip content={tipFor('Command palette', 'palette')}>
          <IconButton label="Command palette" className="scene-header__button" onClick={() => onCommand('palette')}>
            <IconSearch />
          </IconButton>
        </Tooltip>
        <Tooltip content={tipFor('Keymap sheet', 'keymapSheet')}>
          <IconButton label="Keymap sheet" className="scene-header__button" onClick={() => onCommand('keymapSheet')}>
            <IconDoc />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  )
}
