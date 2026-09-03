import type { SceneIconComponent } from '@/scene/icons'
import * as Icons from '@/scene/icons'

/*
 * The lookup that turns a name in the document — a tool, an object kind, a modifier — into the
 * drawing for it. It lives beside `icons.tsx` rather than inside it because a module that exports
 * both components and a table cannot be hot-replaced on its own, and the icons are edited far more
 * often than the table.
 */

/**
 * The name an operator's `icon` field, a toolbar or an outliner row asks for.
 *
 * Where the document already has a vocabulary the name is that vocabulary verbatim — the tool
 * names are `SceneTool`, the object kinds are `SceneObjectKind` — so a caller can index straight
 * from state. Families whose members would collide across vocabularies carry their family as a
 * prefix instead: `SCENE_ICONS['pivot-' + view.pivot]`, `SCENE_ICONS['shading-' + view.shading]`,
 * `SCENE_ICONS['snap-' + view.snapMode]`, `SCENE_ICONS['modifier-' + modifier.kind]`.
 */
export const SCENE_ICONS: Record<string, SceneIconComponent> = {
  'vertex-mode': Icons.IconVertexMode,
  'edge-mode': Icons.IconEdgeMode,
  'face-mode': Icons.IconFaceMode,

  mesh: Icons.IconMeshObject,
  'light-point': Icons.IconLightPoint,
  'light-sun': Icons.IconLightSun,
  'light-spot': Icons.IconLightSpot,
  'light-area': Icons.IconLightArea,
  camera: Icons.IconCameraObject,
  empty: Icons.IconEmpty,
  curve: Icons.IconCurveObject,
  text: Icons.IconTextObject,
  collection: Icons.IconCollection,
  'scene-collection': Icons.IconSceneCollection,

  'select-box': Icons.IconSelectBox,
  'select-circle': Icons.IconSelectCircle,
  'select-lasso': Icons.IconSelectLasso,
  cursor: Icons.IconCursor3D,
  move: Icons.IconMove,
  rotate: Icons.IconRotate,
  scale: Icons.IconScale,
  transform: Icons.IconTransform,
  annotate: Icons.IconAnnotate,
  measure: Icons.IconMeasure,

  extrude: Icons.IconExtrude,
  inset: Icons.IconInset,
  bevel: Icons.IconBevel,
  'loop-cut': Icons.IconLoopCut,
  knife: Icons.IconKnife,
  bisect: Icons.IconBisect,
  'poly-build': Icons.IconPolyBuild,
  spin: Icons.IconSpin,
  smooth: Icons.IconSmoothTool,
  'edge-slide': Icons.IconEdgeSlide,
  'shrink-fatten': Icons.IconShrinkFatten,
  shear: Icons.IconShear,
  rip: Icons.IconRip,

  'shading-wireframe': Icons.IconShadingWireframe,
  'shading-solid': Icons.IconShadingSolid,
  'shading-material': Icons.IconShadingMaterial,
  'shading-rendered': Icons.IconShadingRendered,
  xray: Icons.IconXray,
  overlays: Icons.IconOverlays,
  gizmos: Icons.IconGizmos,

  'pivot-bounding-box': Icons.IconPivotBoundingBox,
  'pivot-cursor': Icons.IconPivotCursor,
  'pivot-individual': Icons.IconPivotIndividual,
  'pivot-median': Icons.IconPivotMedian,
  'pivot-active': Icons.IconPivotActive,

  'orientation-global': Icons.IconOrientationGlobal,
  'orientation-local': Icons.IconOrientationLocal,
  'orientation-normal': Icons.IconOrientationNormal,
  'orientation-gimbal': Icons.IconOrientationGimbal,
  'orientation-view': Icons.IconOrientationView,
  'orientation-cursor': Icons.IconOrientationCursor,

  snap: Icons.IconSnap,
  'snap-increment': Icons.IconSnapIncrement,
  'snap-vertex': Icons.IconSnapVertex,
  'snap-edge': Icons.IconSnapEdge,
  'snap-face': Icons.IconSnapFace,
  'snap-volume': Icons.IconSnapVolume,
  proportional: Icons.IconProportional,

  modifier: Icons.IconModifier,
  'modifier-subsurf': Icons.IconSubsurf,
  'modifier-mirror': Icons.IconMirror,
  'modifier-array': Icons.IconArray,
  'modifier-solidify': Icons.IconSolidify,
  'modifier-boolean': Icons.IconBoolean,
  'modifier-decimate': Icons.IconDecimate,
  'modifier-screw': Icons.IconScrew,
  'modifier-wireframe': Icons.IconWireframeModifier,
  'modifier-displace': Icons.IconDisplace,
  'modifier-simple-deform': Icons.IconSimpleDeform,

  'tab-scene': Icons.IconTabScene,
  'tab-world': Icons.IconTabWorld,
  'tab-object': Icons.IconTabObject,
  'tab-modifiers': Icons.IconTabModifiers,
  'tab-material': Icons.IconTabMaterial,
  'tab-data': Icons.IconTabData,
  'tab-controls': Icons.IconTabControls,
  'tab-history': Icons.IconTabHistory,

  'eye-open': Icons.IconEyeOpen,
  'eye-closed': Icons.IconEyeClosed,
  'selectable-on': Icons.IconSelectableOn,
  'selectable-off': Icons.IconSelectableOff,
  'render-on': Icons.IconRenderOn,
  'render-off': Icons.IconRenderOff,
}

/** `IconLoopCut`, `loopCut`, `loop_cut` and `loop-cut` all name the same icon. */
function kebabCase(name: string): string {
  return name
    .replace(/^Icon(?=[A-Z])/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
}

/**
 * The icon an operator's `icon` field names, or null when it names none.
 *
 * An operator's icon name is data, so the lookup goes through `Object.hasOwn`: a name such as
 * `constructor` must come back as "no icon", not as something reached through the prototype. The
 * spelling is forgiving because operators are written in several files by several hands, and a
 * button with no icon is a worse outcome than a name that was written the other way round.
 */
export function sceneIcon(name: string | undefined): SceneIconComponent | null {
  if (!name) return null
  if (Object.hasOwn(SCENE_ICONS, name)) return SCENE_ICONS[name] ?? null
  const normalised = kebabCase(name)
  if (Object.hasOwn(SCENE_ICONS, normalised)) return SCENE_ICONS[normalised] ?? null
  return null
}
