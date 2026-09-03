import type { SceneTool } from '@/scene/types'

/**
 * Which operator each edit-mode tool is the interactive half of.
 *
 * One table, read in two places that must agree: the viewport, which opens the gesture when a drag
 * begins, and the sidebar's Tool tab, which shows that operator's own settings. Two tables would
 * mean a tool whose panel described something other than what it did.
 *
 * The tools that draw a line rather than drag a number — the knife, bisect, poly build — are not
 * here: a press of theirs places a point rather than opening a gesture, and the viewport handles
 * them itself.
 */
export const TOOL_OPERATORS: Partial<Record<SceneTool, string>> = {
  extrude: 'mesh.extrudeRegion',
  inset: 'mesh.inset',
  bevel: 'mesh.bevelEdges',
  'loop-cut': 'mesh.loopCut',
  spin: 'mesh.spin',
  smooth: 'mesh.smoothVertices',
  'edge-slide': 'mesh.edgeSlide',
  'shrink-fatten': 'mesh.shrinkFatten',
  shear: 'mesh.shear',
  rip: 'mesh.rip',
}
