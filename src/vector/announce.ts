import type { VectorElement, VectorTool } from '@/vector/types'

const TOOL_NAMES: Record<VectorTool, string> = {
  select: 'Select', transform: 'Transform', node: 'Edit nodes', pen: 'Pen', pencil: 'Pencil',
  lasso: 'Lasso', bucket: 'Paint bucket', rectangle: 'Rectangle', ellipse: 'Ellipse', text: 'Text',
  frame: 'Frame', line: 'Line', polygon: 'Polygon', scissors: 'Scissors', scale: 'Scale',
  hand: 'Hand', zoom: 'Zoom', measure: 'Measure', width: 'Width',
}

export function toolAnnouncement(tool: VectorTool): string {
  return `${TOOL_NAMES[tool]} tool`
}

const KIND_NAMES: Record<VectorElement['kind'], string> = {
  rectangle: 'Rectangle', ellipse: 'Ellipse', path: 'Path', group: 'Group', text: 'Text',
  frame: 'Frame', image: 'Image', polygon: 'Polygon', boolean: 'Boolean group',
}

/** What a screen reader is told about the selection: one object in full, several by count. */
export function selectionAnnouncement(elements: VectorElement[], selectedIds: string[]): string {
  const selected = elements.filter((element) => selectedIds.includes(element.id))
  if (selected.length === 0) return 'Nothing selected'
  if (selected.length === 1) {
    const element = selected[0]!
    return `${element.name || KIND_NAMES[element.kind]}, ${round(element.width)} × ${round(element.height)} at ${round(element.x)}, ${round(element.y)}`
  }
  return `${selected.length} objects selected`
}

export function nodeAnnouncement(count: number): string {
  if (count === 0) return 'No node selected'
  return `${count} ${count === 1 ? 'node' : 'nodes'} selected`
}

function round(value: number): number {
  return Math.round(value)
}
