import { meshOf } from '@/scene/document'
import { meshCounts } from '@/scene/mesh/data'
import type { EditorMode, SceneDocument, SceneSelection, SceneTool, SelectMode } from '@/scene/types'

/**
 * What the editor says out loud.
 *
 * A 3D viewport is a canvas: a screen reader has nothing to read in it, so everything a sighted
 * person learns by looking — what is selected, where it is, which mode and tool are in force, what
 * an operator just did — has to be said. The sentences are built here, as pure functions of the
 * document, so what is announced can be tested without a browser and cannot drift from what the
 * status bar shows.
 *
 * They are deliberately short and lead with the name: a live region is read from the beginning, and
 * a person who has heard enough moves on.
 */

const MODE_NAMES: Record<EditorMode, string> = {
  object: 'Object mode',
  edit: 'Edit mode',
  sculpt: 'Sculpt mode',
  'vertex-paint': 'Vertex paint mode',
}

const SELECT_MODE_NAMES: Record<SelectMode, string> = {
  vertex: 'Vertex select',
  edge: 'Edge select',
  face: 'Face select',
}

/** One object in full, several by count, none said plainly. */
export function selectionAnnouncement(document: SceneDocument, selection: SceneSelection): string {
  const selected = document.objects.filter((object) => selection.objectIds.includes(object.id))
  if (selected.length === 0) return 'Nothing selected'
  if (selected.length > 1) return `${selected.length} objects selected`
  const object = selected[0]!
  const mesh = meshOf(document, object)
  const size = mesh ? `, ${countPhrase(meshCounts(mesh).vertices, 'vertex', 'vertices')}` : ''
  return `${object.name}${size}, at ${object.transform.position.map(metres).join(', ')}`
}

/** What is selected inside a mesh, which is what edit mode is about. */
export function elementAnnouncement(counts: { vertices: number; edges: number; faces: number }, mode: SelectMode[]): string {
  const first = mode[0] ?? 'vertex'
  const value = first === 'face' ? counts.faces : first === 'edge' ? counts.edges : counts.vertices
  const noun = first === 'face' ? ['face', 'faces'] : first === 'edge' ? ['edge', 'edges'] : ['vertex', 'vertices']
  if (value === 0) return `No ${noun[0]} selected`
  return `${countPhrase(value, noun[0]!, noun[1]!)} selected`
}

export function modeAnnouncement(mode: EditorMode): string {
  return MODE_NAMES[mode]
}

export function selectModeAnnouncement(modes: SelectMode[]): string {
  if (modes.length === 0) return 'No select mode'
  if (modes.length === 1) return SELECT_MODE_NAMES[modes[0]!]
  return `${modes.map((mode) => mode).join(' and ')} select`
}

export function toolAnnouncement(tool: SceneTool): string {
  const words = tool.replace(/-/g, ' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} tool`
}

/** An operator that has just run, named by the step it left in the history. */
export function operatorAnnouncement(label: string, counts?: { objects?: number }): string {
  if (!counts?.objects) return label
  return `${label}, ${countPhrase(counts.objects, 'object', 'objects')}`
}

function countPhrase(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`
}

/** Metres, to the millimetre, without a trailing zero nobody needs to hear. */
function metres(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}
