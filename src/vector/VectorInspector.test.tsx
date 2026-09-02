import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVectorElement } from '@/vector/document'
import { VectorInspector } from '@/vector/VectorInspector'
import type { VectorDocument, VectorElement, VectorTool } from '@/vector/types'

function documentWith(elements: VectorElement[]): VectorDocument {
  return {
    version: 1,
    id: 'vector-test',
    name: 'Test',
    background: '#151516',
    width: 800,
    height: 600,
    elements,
    guides: [],
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  }
}

const rectangle = () => createVectorElement('rectangle', { x: 10, y: 20, width: 100, height: 80 })

function show(elements: VectorElement[], options: { tool?: VectorTool; tab?: 'design' | 'controls' | 'history'; onTab?: (tab: string) => void; nodes?: string[] } = {}) {
  const onTab = options.onTab ?? vi.fn()
  render(
    <VectorInspector
      document={documentWith(elements)}
      tool={options.tool ?? 'select'}
      tab={options.tab ?? 'design'}
      onTab={onTab as never}
      selectedElements={elements}
      selectedNodeIds={options.nodes ?? []}
      onUpdateDocument={vi.fn()}
      onUpdate={vi.fn()}
      onUpdateElements={vi.fn()}
      onEditElements={vi.fn()}
      onSelectIds={vi.fn()}
      onSelectNodes={vi.fn()}
      historyDepth={0}
      historySteps={[]}
      historyIndex={0}
      onSaveVersion={vi.fn()}
      onRestoreVersion={vi.fn()}
      onDeleteVersion={vi.fn()}
      onGestureStart={vi.fn()}
      onGestureEnd={vi.fn()}
      onGestureCancel={vi.fn()}
    />,
  )
  return { onTab }
}

const sections = () => [...document.querySelectorAll('.vector-section')].map((node) => node.getAttribute('data-section'))

describe('the inspector by context', () => {
  beforeEach(() => localStorage.clear())

  it('describes the page when nothing is selected', () => {
    show([])
    expect(sections()).toEqual(['page', 'guides', 'document-export'])
  })

  it('describes one object without repeating a word', () => {
    show([rectangle()])
    expect(sections()).toEqual(['position', 'layer', 'fill', 'stroke', 'effects', 'network'])
  })

  it('offers align and distribute as their own section for several objects', () => {
    show([rectangle(), { ...rectangle(), id: 'second' }, { ...rectangle(), id: 'third' }])
    expect(sections()).toContain('align')
    expect(screen.getByRole('group', { name: 'Distribute' })).toBeInTheDocument()
  })

  it('replaces Position with Node in node mode', () => {
    show([rectangle()], { tool: 'node' })
    expect(sections()).toEqual(['node', 'network', 'fill', 'stroke', 'effects'])
    expect(sections()).not.toContain('position')
  })

  it('says the word Fill once inside the Fill section', () => {
    show([rectangle()])
    const fill = document.querySelector('[data-section="fill"]')!
    const occurrences = (fill.textContent ?? '').match(/Fill/g) ?? []
    expect(occurrences).toHaveLength(1)
  })

  it('says what an empty section is for', () => {
    show([rectangle()])
    const effects = document.querySelector('[data-section="effects"]')!
    expect(effects.textContent).toContain('No effects. Add one with +')
  })

  it('folds a section and remembers it', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<div />)
    unmount()
    show([rectangle()])
    const head = within(document.querySelector('[data-section="effects"]') as HTMLElement).getByRole('button', { name: 'Effects' })
    expect(head).toHaveAttribute('aria-expanded', 'true')
    await user.click(head)
    expect(head).toHaveAttribute('aria-expanded', 'false')
    expect(JSON.parse(localStorage.getItem('paramrig.vector-inspector.v1')!).collapsed).toContain('effects')
  })

  it('moves between the three tabs', async () => {
    const user = userEvent.setup()
    const { onTab } = show([rectangle()])
    await user.click(screen.getByRole('tab', { name: 'Controls' }))
    expect(onTab).toHaveBeenCalledWith('controls')
    expect(screen.getByRole('tab', { name: 'Design' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the history on its own tab', () => {
    show([rectangle()], { tab: 'history' })
    expect(sections()).toEqual(['history'])
  })

  it('says what the Controls tab is for before anything is exposed', () => {
    show([rectangle()], { tab: 'controls' })
    expect(screen.getByText('No controls yet. Expose a property with ◇')).toBeInTheDocument()
  })
})
