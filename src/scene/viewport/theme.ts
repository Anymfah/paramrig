/**
 * The viewport's colours come from the stylesheet, not from a table in the code.
 *
 * `scene.css` defines every `--scene-*` role for both themes and for the Blender preset; the
 * viewport reads them off the element it is mounted in. One consequence matters: changing a colour
 * is a change to one file, and the light theme, the dark theme and the preset cannot drift apart
 * from what three.js draws, because there is only one place a colour is written down.
 */

export type SceneTheme = {
  viewport: string
  viewportGradient: string
  selected: string
  active: string
  hover: string
  vertex: string
  vertexSelected: string
  edge: string
  edgeSelected: string
  faceSelected: string
  faceActive: string
  /** The casing the selection outline is drawn against, so it reads on any ground. */
  outlineHalo: string
  axisX: string
  axisY: string
  axisZ: string
  grid: string
  gridMajor: string
  floor: string
  cursorRing: string
  cursorGround: string
  gizmoView: string
  gizmoPlane: string
  snap: string
  proportional: string
  loopCut: string
  knife: string
  knifeSnap: string
  measure: string
  faceFront: string
  faceBack: string
  normal: string
  seam: string
  sharp: string
  crease: string
}

const TOKENS: Record<keyof SceneTheme, string> = {
  viewport: '--scene-viewport',
  viewportGradient: '--scene-viewport-gradient',
  selected: '--scene-selected',
  active: '--scene-active',
  hover: '--scene-hover',
  vertex: '--scene-vertex',
  vertexSelected: '--scene-vertex-selected',
  edge: '--scene-edge',
  edgeSelected: '--scene-edge-selected',
  faceSelected: '--scene-face-selected',
  faceActive: '--scene-face-active',
  outlineHalo: '--scene-outline-halo',
  axisX: '--scene-axis-x',
  axisY: '--scene-axis-y',
  axisZ: '--scene-axis-z',
  grid: '--scene-grid',
  gridMajor: '--scene-grid-major',
  floor: '--scene-floor',
  cursorRing: '--scene-cursor-ring',
  cursorGround: '--scene-cursor-ground',
  gizmoView: '--scene-gizmo-view',
  gizmoPlane: '--scene-gizmo-plane',
  snap: '--scene-snap',
  proportional: '--scene-proportional',
  loopCut: '--scene-loop-cut',
  knife: '--scene-knife',
  knifeSnap: '--scene-knife-snap',
  measure: '--scene-measure',
  faceFront: '--scene-face-front',
  faceBack: '--scene-face-back',
  normal: '--scene-normal',
  seam: '--scene-seam',
  sharp: '--scene-sharp',
  crease: '--scene-crease',
}

/** What the viewport falls back to where there is no stylesheet at all, as in a jsdom test. */
export const FALLBACK_THEME: SceneTheme = {
  viewport: '#1b1f1e',
  viewportGradient: '#141817',
  selected: '#f0a02e',
  active: '#ffce6a',
  hover: '#f0a02e80',
  vertex: '#101211',
  vertexSelected: '#f0a02e',
  edge: '#14171680',
  edgeSelected: '#f0a02e',
  faceSelected: '#f0a02e4d',
  faceActive: '#ffce6a66',
  outlineHalo: '#0b0e0e',
  axisX: '#d1495b',
  axisY: '#77b255',
  axisZ: '#4a86c8',
  grid: '#ffffff14',
  gridMajor: '#ffffff26',
  floor: '#ffffff0f',
  cursorRing: '#e04c4c',
  cursorGround: '#f2f4f3',
  gizmoView: '#f2f4f3',
  gizmoPlane: '#ffffff2e',
  snap: '#c8e05a',
  proportional: '#dfe6e3',
  loopCut: '#f2d34a',
  knife: '#f7f9f8',
  knifeSnap: '#7fd67f',
  measure: '#7fd6c8',
  faceFront: '#3a6ea5',
  faceBack: '#a53a3a',
  normal: '#5ad2e0',
  seam: '#e05a5a',
  sharp: '#5ad2e0',
  crease: '#d45ad2',
}

export function readSceneTheme(element: Element | null): SceneTheme {
  if (!element || typeof getComputedStyle !== 'function') return { ...FALLBACK_THEME }
  const style = getComputedStyle(element)
  const theme = { ...FALLBACK_THEME }
  for (const [role, token] of Object.entries(TOKENS) as Array<[keyof SceneTheme, string]>) {
    const value = style.getPropertyValue(token).trim()
    if (value) theme[role] = value
  }
  return theme
}

/** An `#rrggbbaa` colour split into the part three.js understands and the alpha it does not. */
export function splitAlpha(colour: string): { colour: string; alpha: number } {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(colour.trim())
  if (!match) return { colour, alpha: 1 }
  return { colour: `#${match[1]}`, alpha: parseInt(match[2]!, 16) / 255 }
}
