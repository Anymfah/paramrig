import { describe, expect, it } from 'vitest'
import { countedLabel, historyRows, stepDistance, type HistoryStep } from '@/vector/history'
import type { VectorVersion } from '@/vector/types'

const steps: HistoryStep[] = [
  { index: 0, label: 'Opened', at: 1000 },
  { index: 1, label: 'Draw rectangle', at: 2000 },
  { index: 2, label: 'Move 3 objects', at: 3000 },
  { index: 3, label: 'Change fill', at: 4000 },
]

const version = (id: string, name: string, at: number): VectorVersion => ({
  id, name, createdAt: new Date(at).toISOString(), elements: [], guides: [],
})

describe('history rows', () => {
  it('lists the newest step first and marks the current one', () => {
    const rows = historyRows(steps, 2)

    expect(rows.map((row) => row.label)).toEqual(['Change fill', 'Move 3 objects', 'Draw rectangle', 'Opened'])
    expect(rows.filter((row) => row.kind === 'step' && row.current).map((row) => row.label)).toEqual(['Move 3 objects'])
  })

  it('marks the steps that have been undone', () => {
    const rows = historyRows(steps, 1)

    expect(rows.filter((row) => row.kind === 'step' && row.undone).map((row) => row.label)).toEqual(['Change fill', 'Move 3 objects'])
  })

  it('drops a saved version in after the step it was saved on', () => {
    const rows = historyRows(steps, 3, [version('v1', 'First pass', 2500)])

    expect(rows.map((row) => row.label)).toEqual(['Change fill', 'Move 3 objects', 'First pass', 'Draw rectangle', 'Opened'])
    expect(rows.find((row) => row.kind === 'version')).toMatchObject({ id: 'v1', kind: 'version' })
  })

  it('puts a version saved after the last step at the top', () => {
    const rows = historyRows(steps, 3, [version('v2', 'Latest', 9000)])

    expect(rows[0]).toMatchObject({ kind: 'version', label: 'Latest' })
  })

  it('keeps a version older than the whole history at the bottom', () => {
    const rows = historyRows(steps, 3, [version('v0', 'Reloaded', 10)])

    expect(rows[rows.length - 1]).toMatchObject({ kind: 'version', label: 'Reloaded' })
  })

  it('works with nothing but the starting point', () => {
    expect(historyRows([{ index: 0, label: 'Opened', at: 0 }], 0)).toEqual([
      { kind: 'step', index: 0, label: 'Opened', at: 0, current: true, undone: false },
    ])
  })
})

describe('moving through the history', () => {
  it('says how far and which way a jump goes', () => {
    expect(stepDistance(3, 1)).toBe(-2)
    expect(stepDistance(1, 3)).toBe(2)
    expect(stepDistance(2, 2)).toBe(0)
  })
})

describe('labels', () => {
  it('counts objects only when there are several', () => {
    expect(countedLabel('Move', 1)).toBe('Move')
    expect(countedLabel('Move', 3)).toBe('Move 3 objects')
    expect(countedLabel('Move', 2, 'node')).toBe('Move 2 nodes')
  })
})
