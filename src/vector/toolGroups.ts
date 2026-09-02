import type { VectorTool } from '@/vector/types'

/**
 * The toolbar's six slots. Each one holds the tools that do the same kind of work, shows whichever
 * of them was used last, and offers the rest in a menu. The order is the order of the bar.
 */
export type ToolGroupId = 'select' | 'frame' | 'shapes' | 'draw' | 'text' | 'navigate'

/**
 * One entry of a group's menu. `variant` names a tool used in a second way: `star` draws with the
 * polygon tool but pulls its inner points in, which is what makes it a star.
 */
export type ToolEntry = {
  id: string
  tool: VectorTool
  label: string
  shortcut: string
  variant?: 'star'
}

export type ToolGroupDef = {
  id: ToolGroupId
  /** Names the menu: "Select tools", "Shape tools"… */
  label: string
  tools: ToolEntry[]
}

export const TOOL_GROUPS: ToolGroupDef[] = [
  {
    id: 'select',
    label: 'Select tools',
    tools: [
      { id: 'select', tool: 'select', label: 'Select', shortcut: 'V' },
      { id: 'transform', tool: 'transform', label: 'Transform', shortcut: 'G / R / S' },
      { id: 'scale', tool: 'scale', label: 'Scale', shortcut: 'K' },
      { id: 'lasso', tool: 'lasso', label: 'Lasso', shortcut: 'Q' },
    ],
  },
  {
    id: 'frame',
    label: 'Frame',
    tools: [{ id: 'frame', tool: 'frame', label: 'Frame', shortcut: 'F' }],
  },
  {
    id: 'shapes',
    label: 'Shape tools',
    tools: [
      { id: 'rectangle', tool: 'rectangle', label: 'Rectangle', shortcut: 'R' },
      { id: 'ellipse', tool: 'ellipse', label: 'Ellipse', shortcut: 'O' },
      { id: 'line', tool: 'line', label: 'Line', shortcut: 'L' },
      { id: 'polygon', tool: 'polygon', label: 'Polygon', shortcut: '⌥P' },
      { id: 'star', tool: 'polygon', label: 'Star', shortcut: '⌥P', variant: 'star' },
    ],
  },
  {
    id: 'draw',
    label: 'Draw tools',
    tools: [
      { id: 'pen', tool: 'pen', label: 'Pen', shortcut: 'P' },
      { id: 'pencil', tool: 'pencil', label: 'Pencil', shortcut: '⇧P' },
      { id: 'node', tool: 'node', label: 'Edit nodes', shortcut: '↵' },
      { id: 'scissors', tool: 'scissors', label: 'Scissors', shortcut: 'C' },
      { id: 'width', tool: 'width', label: 'Width', shortcut: '⇧W' },
      { id: 'bucket', tool: 'bucket', label: 'Paint bucket', shortcut: 'B' },
    ],
  },
  {
    id: 'text',
    label: 'Text',
    tools: [{ id: 'text', tool: 'text', label: 'Text', shortcut: 'T' }],
  },
  {
    id: 'navigate',
    label: 'Navigate tools',
    tools: [
      { id: 'hand', tool: 'hand', label: 'Hand', shortcut: 'H' },
      { id: 'zoom', tool: 'zoom', label: 'Zoom', shortcut: 'Z' },
      { id: 'measure', tool: 'measure', label: 'Measure', shortcut: '⇧M' },
    ],
  },
]

/** The entry each group shows first, before anything has been picked in it. */
export const DEFAULT_ENTRIES: Record<ToolGroupId, string> = Object.fromEntries(
  TOOL_GROUPS.map((group) => [group.id, group.tools[0]!.id]),
) as Record<ToolGroupId, string>

/** The group a tool belongs to, so picking it with a shortcut lights the right slot. */
export function groupOfTool(tool: VectorTool): ToolGroupId | null {
  return TOOL_GROUPS.find((group) => group.tools.some((entry) => entry.tool === tool))?.id ?? null
}

/** The entry a group is showing, falling back to its first tool. */
export function entryOf(group: ToolGroupDef, entryId: string | undefined): ToolEntry {
  return group.tools.find((entry) => entry.id === entryId) ?? group.tools[0]!
}

export function findEntry(id: string): ToolEntry | null {
  for (const group of TOOL_GROUPS) {
    const entry = group.tools.find((item) => item.id === id)
    if (entry) return entry
  }
  return null
}

/** Every tool the toolbar can reach, for the check that none was left behind. */
export function groupedTools(): VectorTool[] {
  return [...new Set(TOOL_GROUPS.flatMap((group) => group.tools.map((entry) => entry.tool)))]
}
