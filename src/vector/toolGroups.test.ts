import { describe, expect, it } from 'vitest'
import { DEFAULT_ENTRIES, entryOf, findEntry, groupedTools, groupOfTool, TOOL_GROUPS } from '@/vector/toolGroups'
import type { VectorTool } from '@/vector/types'

const ALL_TOOLS: VectorTool[] = [
  'select', 'transform', 'node', 'pen', 'pencil', 'lasso', 'bucket', 'rectangle', 'ellipse',
  'text', 'frame', 'line', 'polygon', 'scissors', 'scale', 'hand', 'zoom', 'measure', 'width',
]

describe('tool groups', () => {
  it('gathers the bar into six slots', () => {
    expect(TOOL_GROUPS.map((group) => group.id)).toEqual(['select', 'frame', 'shapes', 'draw', 'text', 'navigate'])
  })

  it('leaves no tool out of the bar', () => {
    expect([...groupedTools()].sort()).toEqual([...ALL_TOOLS].sort())
  })

  it('gives every entry a shortcut and a unique id', () => {
    const ids = TOOL_GROUPS.flatMap((group) => group.tools.map((entry) => entry.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(TOOL_GROUPS.every((group) => group.tools.every((entry) => entry.shortcut.length > 0))).toBe(true)
  })

  it('finds the slot a tool lights up', () => {
    expect(groupOfTool('pencil')).toBe('draw')
    expect(groupOfTool('measure')).toBe('navigate')
    expect(groupOfTool('polygon')).toBe('shapes')
  })

  it('starts each slot on its first tool', () => {
    expect(DEFAULT_ENTRIES).toEqual({ select: 'select', frame: 'frame', shapes: 'rectangle', draw: 'pen', text: 'text', navigate: 'hand' })
  })

  it('falls back to the first tool when a slot names one it does not hold', () => {
    expect(entryOf(TOOL_GROUPS[2]!, 'pen').id).toBe('rectangle')
    expect(entryOf(TOOL_GROUPS[2]!, 'star').id).toBe('star')
  })

  it('reads the star as a second way of using the polygon tool', () => {
    expect(findEntry('star')).toMatchObject({ tool: 'polygon', variant: 'star' })
    expect(findEntry('nothing')).toBeNull()
  })
})
