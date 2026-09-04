import type { ComponentType, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Boxes,
  Camera,
  CameraOff,
  CircleDashed,
  Eye,
  EyeOff,
  FlipHorizontal,
  Globe,
  History,
  Lasso,
  Magnet,
  MousePointer2,
  MousePointerBan,
  Move,
  PenLine,
  RotateCw,
  Ruler,
  Scaling,
  SlidersHorizontal,
  SquareDashed,
  Sun,
  SwatchBook,
  Type,
  Video,
  Wrench,
} from 'lucide-react'

/**
 * The scene editor's own icon set: everything a Blender-shaped editor points at that lucide has no
 * glyph for — the selection modes, the object kinds, the mesh tools, the shading modes, the pivot
 * points, the transform orientations, the snap modes and the modifiers.
 *
 * Every icon is one 16-unit square drawn with the same stroke, so a row of them reads as one
 * family whether it was drawn here or borrowed from lucide. `SCENE_ICONS` is the lookup an
 * operator's `icon` field and the toolbars go through; its names follow the document's own
 * vocabulary — `SceneTool` verbatim for the tools, and a family prefix everywhere the vocabularies
 * would otherwise collide (`pivot-cursor` against the `cursor` tool, `modifier-wireframe` against
 * the `wireframe` shading mode).
 */

export type SceneIconProps = { className?: string }
export type SceneIconComponent = ComponentType<SceneIconProps>

/** The one svg every icon in the set is drawn inside, so the family cannot drift apart. */
function Glyph({ className, children }: SceneIconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** A solid point: a vertex, a pivot, the thing an icon is about. Filled areas mean nothing else. */
function Dot({ cx, cy, r = 1.4 }: { cx: number; cy: number; r?: number }) {
  return <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
}

/**
 * Lucide draws on a 24-unit grid, this set on a 16-unit one. Rather than redraw a glyph lucide
 * already has right, its svg is nested as its own viewport, which rescales it; the stroke is
 * widened by the same factor so the borrowed glyph still lands on the house weight of 1.5.
 */
const LUCIDE_GRID = 24

function fromLucide(Icon: LucideIcon): SceneIconComponent {
  return function BorrowedGlyph({ className }: SceneIconProps) {
    return (
      <Glyph className={className}>
        <Icon x={0} y={0} width={16} height={16} strokeWidth={(1.5 * LUCIDE_GRID) / 16} />
      </Glyph>
    )
  }
}

/* ------------------------------------------------------------- selection modes */

export function IconVertexMode({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="4" y="4" width="8" height="8" rx="0.5" />
      <Dot cx={4} cy={4} />
      <Dot cx={12} cy={4} />
      <Dot cx={4} cy={12} />
      <Dot cx={12} cy={12} />
    </Glyph>
  )
}

export function IconEdgeMode({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="4" y="4" width="8" height="8" rx="0.5" />
      <path d="M4 4v8" strokeWidth={2.75} />
      <Dot cx={4} cy={4} />
      <Dot cx={4} cy={12} />
    </Glyph>
  )
}

export function IconFaceMode({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="4" y="4" width="8" height="8" rx="0.5" />
      <Dot cx={8} cy={8} r={1.75} />
    </Glyph>
  )
}

/* ----------------------------------------------------------------- object kinds */

/*
 * A quad with its diagonal and its four corners: a polygon mesh, and nothing else. The first
 * drawing was Blender's triangle-inside-a-triangle, which at sixteen pixels in a list of rows is
 * indistinguishable from a warning sign.
 */
export function IconMeshObject({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M3 3.5h10v9H3z" />
      <path d="M3 12.5 13 3.5" />
      <Dot cx={3} cy={3.5} r={1.15} />
      <Dot cx={13} cy={3.5} r={1.15} />
      <Dot cx={3} cy={12.5} r={1.15} />
      <Dot cx={13} cy={12.5} r={1.15} />
    </Glyph>
  )
}

export function IconLightPoint({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <Dot cx={8} cy={8} r={1.75} />
      <path d="M8 1.5v2.5M8 12v2.5M1.5 8h2.5M12 8h2.5" />
      <path d="m3.4 3.4 1.75 1.75M10.85 10.85l1.75 1.75M12.6 3.4l-1.75 1.75M5.15 10.85 3.4 12.6" />
    </Glyph>
  )
}

export const IconLightSun = fromLucide(Sun)

export function IconLightSpot({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M5.5 3.5h5" />
      <path d="M5.5 3.5 2.5 12.25M10.5 3.5l3 8.75" />
      <ellipse cx="8" cy="12.25" rx="5.5" ry="2" />
    </Glyph>
  )
}

export function IconLightArea({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 3 14 6.5 8 10 2 6.5z" />
      <path d="M5 11v3M8 11.5v3M11 11v3" />
    </Glyph>
  )
}

export const IconCameraObject = fromLucide(Video)

export function IconEmpty({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 2v12M2 8h12M3.75 12.25 12.25 3.75" />
    </Glyph>
  )
}

export function IconCurveObject({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.5 4c0 6 2.5 8 5.5 8s5.5-2 5.5-8" />
      <Dot cx={2.5} cy={4} r={1.3} />
      <Dot cx={13.5} cy={4} r={1.3} />
    </Glyph>
  )
}

export const IconTextObject = fromLucide(Type)

export const IconCollection = fromLucide(Boxes)

export function IconSceneCollection({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12" />
      <rect x="4.25" y="8.5" width="3" height="3" rx="0.5" />
      <rect x="8.75" y="8.5" width="3" height="3" rx="0.5" />
    </Glyph>
  )
}

/* ------------------------------------------------------------------------ tools */

export const IconSelectBox = fromLucide(SquareDashed)
export const IconSelectCircle = fromLucide(CircleDashed)
export const IconSelectLasso = fromLucide(Lasso)

export function IconCursor3D({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="4" strokeDasharray="1.6 1.6" />
      <path d="M8 1.25v2.5M8 12.25v2.5M1.25 8h2.5M12.25 8h2.5" />
      <path d="M6.5 8h3M8 6.5v3" />
    </Glyph>
  )
}

export const IconMove = fromLucide(Move)
export const IconRotate = fromLucide(RotateCw)
export const IconScale = fromLucide(Scaling)

export function IconTransform({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="3.5" y="3.5" width="9" height="9" strokeDasharray="1.5 1.5" />
      <rect x="2.25" y="2.25" width="2.5" height="2.5" rx="0.5" />
      <rect x="11.25" y="2.25" width="2.5" height="2.5" rx="0.5" />
      <rect x="2.25" y="11.25" width="2.5" height="2.5" rx="0.5" />
      <rect x="11.25" y="11.25" width="2.5" height="2.5" rx="0.5" />
    </Glyph>
  )
}

export const IconAnnotate = fromLucide(PenLine)
export const IconMeasure = fromLucide(Ruler)

export function IconExtrude({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="2" y="7" width="7" height="7" rx="0.75" />
      <path d="M9 7 13.5 2.5" />
      <path d="M9.5 2.5h4v4" />
    </Glyph>
  )
}

export function IconInset({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="1" />
      <rect x="5.25" y="5.25" width="5.5" height="5.5" rx="0.75" />
      <path d="m2.75 2.75 1.75 1.75M13.25 2.75 11.5 4.5M2.75 13.25 4.5 11.5M13.25 13.25 11.5 11.5" />
    </Glyph>
  )
}

export function IconBevel({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M13.5 13.5H2.5V6.5l4-4h7z" />
      <path d="M2.5 6.5v-4h4" strokeDasharray="1.5 1.5" />
    </Glyph>
  )
}

export function IconLoopCut({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="4" width="11.5" height="8" rx="1.25" />
      <path d="M5.25 4v8M10.75 4v8" strokeDasharray="1.5 1.5" />
      <path d="M8 2.5v11" />
    </Glyph>
  )
}

export function IconKnife({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M13.5 2.5 6.5 6.5l4 4z" />
      <path d="M6.5 6.5 3.5 9.5" />
      <path d="M2 13.5h12" strokeDasharray="1.5 1.75" />
    </Glyph>
  )
}

export function IconBisect({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="3" y="3" width="10" height="10" rx="1" />
      <path d="M1.5 14.5 14.5 1.5" />
    </Glyph>
  )
}

export function IconPolyBuild({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M3 12.5V5.5l5.5-2v8z" />
      <path d="M8.5 3.5 13 6.5l-4.5 5" strokeDasharray="1.5 1.5" />
      <Dot cx={13} cy={6.5} r={1.3} />
    </Glyph>
  )
}

export function IconSpin({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 1.5v3.2M8 13v1.5" strokeDasharray="1.5 1.5" />
      <ellipse cx="8" cy="9.5" rx="5.5" ry="2.75" />
      <path d="M6.5 5.5 8 6.75 6.5 8" />
      <Dot cx={13.5} cy={9.5} r={1.3} />
    </Glyph>
  )
}

export function IconSmoothTool({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M1.5 11 3.75 6 6 11l2-4.5" />
      <path d="M8 6.5c1.5 0 1.75 4.5 3.25 4.5s1.75-4.5 3.25-4.5" />
    </Glyph>
  )
}

export function IconEdgeSlide({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M3 2.5v11M13 2.5v11" />
      <path d="M7 2.5v11" />
      <path d="M8.5 8H11" />
      <path d="m9.9 6.9 1.1 1.1-1.1 1.1" />
    </Glyph>
  )
}

export function IconShrinkFatten({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M2 12.5C4.5 8 11.5 8 14 12.5" />
      <path d="M2 8C4.5 3.5 11.5 3.5 14 8" strokeDasharray="1.5 1.5" />
      <path d="M8 8.6V5.6" />
      <path d="M6.6 7 8 5.6 9.4 7" />
    </Glyph>
  )
}

export function IconShear({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M2 13.5 5 5h9l-3 8.5z" />
      <path d="M4.5 2.5h7" />
      <path d="m10.2 1.3 1.3 1.2-1.3 1.2" />
    </Glyph>
  )
}

export function IconRip({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 1.5V4" />
      <path d="M5.5 7.3 4 10.5V14M10.5 7.3 12 10.5V14" />
      <Dot cx={5.5} cy={6} r={1.3} />
      <Dot cx={10.5} cy={6} r={1.3} />
    </Glyph>
  )
}

/* ---------------------------------------------------------------------- shading */

export function IconShadingWireframe({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="6" />
      <ellipse cx="8" cy="8" rx="2.6" ry="6" />
      <path d="M3 4.8h10M3 11.2h10" />
    </Glyph>
  )
}

export function IconShadingSolid({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="6" />
      <path d="M4.5 6a4.5 4.5 0 0 1 3.5-2" />
    </Glyph>
  )
}

export function IconShadingMaterial({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 2v12M8 8h6" />
    </Glyph>
  )
}

export function IconShadingRendered({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <circle cx="9.25" cy="9.25" r="5.25" />
      <path d="M1.25 2.25 4 5M6 1l1.1 2.2M1 6.25l2.2 1.1" />
    </Glyph>
  )
}

export function IconXray({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="1.75" y="1.75" width="9" height="9" rx="1" />
      <rect x="5.25" y="5.25" width="9" height="9" rx="1" strokeDasharray="2 1.5" />
    </Glyph>
  )
}

export function IconOverlays({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <circle cx="6" cy="8" r="4.5" />
      <circle cx="10" cy="8" r="4.5" />
    </Glyph>
  )
}

export function IconGizmos({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 8.75V4.6M8 8.75 4.2 11.05M8 8.75l3.8 2.3" />
      <circle cx="8" cy="3.1" r="1.5" />
      <circle cx="3" cy="12.1" r="1.5" />
      <circle cx="13" cy="12.1" r="1.5" />
    </Glyph>
  )
}

/* ----------------------------------------------------------- transform settings */

export function IconPivotBoundingBox({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" strokeDasharray="2 1.5" />
      <Dot cx={8} cy={8} r={1.6} />
    </Glyph>
  )
}

export function IconPivotCursor({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" strokeDasharray="2 1.5" />
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 4.25v1.25M8 10.5v1.25M4.25 8h1.25M10.5 8h1.25" />
    </Glyph>
  )
}

export function IconPivotIndividual({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="1.75" y="1.75" width="6" height="6" rx="0.75" strokeDasharray="1.5 1.5" />
      <Dot cx={4.75} cy={4.75} r={1.3} />
      <rect x="8.25" y="8.25" width="6" height="6" rx="0.75" strokeDasharray="1.5 1.5" />
      <Dot cx={11.25} cy={11.25} r={1.3} />
    </Glyph>
  )
}

/** The filled point sits at the true median of the three hollow ones: the icon is what it does. */
export function IconPivotMedian({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <circle cx="4.25" cy="5" r="1.25" />
      <circle cx="11.75" cy="4.25" r="1.25" />
      <circle cx="6.5" cy="12.25" r="1.25" />
      <Dot cx={7.5} cy={7.15} r={1.6} />
    </Glyph>
  )
}

export function IconPivotActive({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <circle cx="4" cy="11.5" r="1.25" />
      <circle cx="11.5" cy="11.5" r="1.25" />
      <circle cx="8" cy="5.5" r="3.75" />
      <Dot cx={8} cy={5.5} r={1.6} />
    </Glyph>
  )
}

export function IconOrientationGlobal({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M8 10V5.5M8 10 4.75 11.9M8 10l3.25 1.9" />
    </Glyph>
  )
}

export function IconOrientationLocal({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 1.5 14.5 8 8 14.5 1.5 8z" />
      <path d="M8 10V6.25M8 10 5.5 11.5M8 10l2.5 1.5" />
    </Glyph>
  )
}

export function IconOrientationNormal({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M1.5 12h13" />
      <path d="M8 12V4.5" />
      <path d="M5.8 6.7 8 4.5l2.2 2.2" />
      <path d="M9.5 12v-1.5H8" />
    </Glyph>
  )
}

export function IconOrientationGimbal({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="6" />
      <ellipse cx="8" cy="8" rx="5.5" ry="2.2" transform="rotate(-32 8 8)" />
      <ellipse cx="8" cy="8" rx="5.5" ry="2.2" transform="rotate(32 8 8)" />
    </Glyph>
  )
}

export function IconOrientationView({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="1.5" y="2.75" width="13" height="10.5" rx="1.5" />
      <path d="M8 10V6M8 10 5.5 11.5M8 10l2.5 1.5" />
    </Glyph>
  )
}

export function IconOrientationCursor({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="3" />
      <Dot cx={8} cy={8} r={1.2} />
      <path d="M8 5V2.25M5.9 10.1 4 12M10.1 10.1 12 12" />
    </Glyph>
  )
}

export const IconSnap = fromLucide(Magnet)

export function IconSnapIncrement({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.5 5.75h11M2.5 10.25h11M5.75 2.5v11M10.25 2.5v11" />
      <Dot cx={10.25} cy={5.75} r={2} />
    </Glyph>
  )
}

export function IconSnapVertex({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 3.25 13.75 13.5H2.25z" />
      <Dot cx={8} cy={3.25} r={1.75} />
    </Glyph>
  )
}

export function IconSnapEdge({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 3.25 13.75 13.5H2.25z" />
      <path d="M8 3.25 2.25 13.5" strokeWidth={2.75} />
      <Dot cx={5.125} cy={8.375} r={1.75} />
    </Glyph>
  )
}

export function IconSnapFace({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 3.25 13.75 13.5H2.25z" />
      <Dot cx={8} cy={10} r={1.75} />
    </Glyph>
  )
}

export function IconSnapVolume({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 1.75 13.75 5v6L8 14.25 2.25 11V5z" />
      <Dot cx={8} cy={8} r={1.75} />
    </Glyph>
  )
}

export function IconProportional({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="6" strokeDasharray="1.6 1.6" />
      <circle cx="8" cy="8" r="3.25" />
      <Dot cx={8} cy={8} r={1.3} />
    </Glyph>
  )
}

/* -------------------------------------------------------------------- modifiers */

export const IconModifier = fromLucide(Wrench)

export function IconSubsurf({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" strokeDasharray="1.5 1.5" />
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="5" />
    </Glyph>
  )
}

export const IconMirror = fromLucide(FlipHorizontal)

export function IconArray({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="1.5" y="4.75" width="3.5" height="6.5" rx="0.75" />
      <rect x="6.25" y="4.75" width="3.5" height="6.5" rx="0.75" />
      <rect x="11" y="4.75" width="3.5" height="6.5" rx="0.75" strokeDasharray="1.5 1.5" />
    </Glyph>
  )
}

export function IconSolidify({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M2 6.5c3.5-3.5 8.5-3.5 12 0" />
      <path d="M2 10.5c3.5-3.5 8.5-3.5 12 0" />
      <path d="M2 6.5v4M14 6.5v4" />
    </Glyph>
  )
}

export function IconBoolean({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="1.5" y="4" width="8" height="8" rx="1" />
      <circle cx="10.5" cy="8" r="4" />
    </Glyph>
  )
}

export function IconDecimate({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 2.5 14 13.5H2z" />
      <path d="M5 8h6" />
      <path d="M8 2.5v11" strokeDasharray="1.5 1.5" />
    </Glyph>
  )
}

export function IconScrew({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M4.5 3.5c0 1.2 7 1.2 7 2.4s-7 1.2-7 2.4 7 1.2 7 2.4-7 1.2-7 2.4" />
    </Glyph>
  )
}

export function IconWireframeModifier({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 2 14 13.5H2z" />
      <path d="M8 5.5 11.5 12h-7z" />
    </Glyph>
  )
}

export function IconDisplace({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M1.5 4.5h13" strokeDasharray="1.5 1.5" />
      <path d="M1.5 10C3 6.5 6.5 6.5 8 10s5 3.5 6.5 0" />
    </Glyph>
  )
}

export function IconSimpleDeform({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M3 13.5V9a6 6 0 0 1 6-6h2.5" />
      <path d="M6.5 13.5V9a2.5 2.5 0 0 1 2.5-2.5h2.5" />
      <path d="M3 13.5h3.5M11.5 3v3.5" />
    </Glyph>
  )
}

export function IconBevelModifier({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.5 13.5V5.5L5.5 2.5h8" />
      <path d="M2.5 5.5h3v-3" strokeDasharray="1.5 1.5" />
    </Glyph>
  )
}

export function IconTriangulate({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="0.75" />
      <path d="M2.25 13.75 13.75 2.25" />
    </Glyph>
  )
}

export function IconWeld({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M2 4.5 6.5 8 2 11.5" />
      <path d="M14 4.5 9.5 8 14 11.5" />
      <Dot cx={8} cy={8} r={1.6} />
    </Glyph>
  )
}

export function IconSmoothModifier({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M1.5 11.5 4 5l2.5 4L9 3.5l2.5 5 3-2" strokeDasharray="1.5 1.5" />
      <path d="M1.5 11.5C4.5 7.5 9.5 6 14.5 7" />
    </Glyph>
  )
}

export function IconCast({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" strokeDasharray="1.5 1.5" />
      <circle cx="8" cy="8" r="4.75" />
    </Glyph>
  )
}

export function IconEdgeSplit({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M2 12.5 7 3.5" />
      <path d="M9 3.5 14 12.5" />
      <path d="M7 7.5h2M6.2 10h3.6" strokeDasharray="1.5 1.5" />
    </Glyph>
  )
}

/** A modifier shown while the mesh is open for editing: the cage, with its points on it. */
export function IconInEditMode({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="3.5" y="3.5" width="9" height="9" />
      <Dot cx={3.5} cy={3.5} r={1.5} />
      <Dot cx={12.5} cy={3.5} r={1.5} />
      <Dot cx={3.5} cy={12.5} r={1.5} />
      <Dot cx={12.5} cy={12.5} r={1.5} />
    </Glyph>
  )
}

/** Editing on the result rather than on the mesh: the points have moved onto the rounded shape. */
export function IconOnCage({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="3.5" y="3.5" width="9" height="9" rx="4.5" />
      <Dot cx={3.5} cy={8} r={1.5} />
      <Dot cx={12.5} cy={8} r={1.5} />
      <Dot cx={8} cy={3.5} r={1.5} />
      <Dot cx={8} cy={12.5} r={1.5} />
    </Glyph>
  )
}

/* -------------------------------------------------------------- properties tabs */

export function IconTabScene({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M5.5 4 8.5 12.5H2.5z" />
      <circle cx="11.5" cy="10" r="2.5" />
      <path d="M1.5 12.5h13" />
    </Glyph>
  )
}

export const IconTabWorld = fromLucide(Globe)

export function IconTabObject({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 1.75 13.75 5v6L8 14.25 2.25 11V5z" />
      <path d="M8 8 13.75 5M8 8v6.25M8 8 2.25 5" />
    </Glyph>
  )
}

/** Blender marks both the modifier and its properties tab with the same wrench; so does this set. */
export const IconTabModifiers = IconModifier

export const IconTabMaterial = fromLucide(SwatchBook)

export function IconTabData({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 2.75 13.5 13.25H2.5z" />
      <path d="M5.25 8h5.5" />
      <Dot cx={8} cy={2.75} r={1.2} />
      <Dot cx={2.5} cy={13.25} r={1.2} />
      <Dot cx={13.5} cy={13.25} r={1.2} />
    </Glyph>
  )
}

/*
 * The UV editor's own mark: the image, with an island laid on it.
 *
 * It is deliberately not a grid — a grid is what the overlay toggle means everywhere else in the
 * editor — and deliberately not a texture, because what the second space shows is the *map*, which
 * is the piece of geometry lying on the picture rather than the picture.
 */
export function IconUvEditor({ className }: SceneIconProps) {
  return (
    <Glyph className={className}>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1" />
      <path d="M5 11.5 8.75 4.75 11.75 9.75z" />
      <Dot cx={5} cy={11.5} r={1.1} />
    </Glyph>
  )
}

export const IconTabControls = fromLucide(SlidersHorizontal)
export const IconTabHistory = fromLucide(History)

/* --------------------------------------------------------------- outliner rows */

export const IconEyeOpen = fromLucide(Eye)
export const IconEyeClosed = fromLucide(EyeOff)
export const IconSelectableOn = fromLucide(MousePointer2)
export const IconSelectableOff = fromLucide(MousePointerBan)
export const IconRenderOn = fromLucide(Camera)
export const IconRenderOff = fromLucide(CameraOff)
