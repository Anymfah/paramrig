import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import example from '../../examples/web/manifest.json'
import { parseManifest } from './contracts'
import { newDraft } from './session'
import { WebRecovery } from './WebRecovery'

const manifest = parseManifest(example)
const context = { pageId: 'home', url: manifest.origin, viewport: { width: 1440, height: 900, dpr: 1 }, scroll: { x: 0, y: 0 }, scrollers: [] }
const draft = (comments: number, moved: string[]) => {
  const document = newDraft(manifest)
  for (let index = 0; index < comments; index += 1) {
    document.tickets.push({ id: `t${index}`, comment: 'x', status: 'draft', revision: manifest.revision, createdAt: '2026-09-06T00:00:00.000Z', context, targets: [], marks: [], captures: [] })
  }
  for (const id of moved) document.values[id] = '#000000'
  return document
}

describe('two drafts of the same project', () => {
  it('says when each was saved and what is in it', () => {
    render(<WebRecovery
      browser={{ document: draft(2, ['accent']), savedAt: '2026-09-06T09:30:00.000Z' }}
      project={{ document: draft(1, ['accent', 'paper']), savedAt: '2026-09-06T08:00:00.000Z' }}
      onChoose={() => {}} />)
    expect(screen.getByText('2 comments · 1 value changed')).toBeInTheDocument()
    expect(screen.getByText('1 comment · 2 values changed')).toBeInTheDocument()
    expect(screen.getAllByText(/^Saved /)).toHaveLength(2)
  })

  it('puts the newest version first, and makes it the obvious choice', () => {
    const choose = vi.fn()
    const { unmount } = render(<WebRecovery
      browser={{ document: draft(1, []), savedAt: '2026-09-06T09:30:00.000Z' }}
      project={{ document: draft(1, []), savedAt: '2026-09-06T08:00:00.000Z' }}
      onChoose={choose} />)
    const first = screen.getAllByRole('button')[0]!
    expect(first.textContent).toBe('Keep this browser')
    expect(first.className).toContain('btn--solid')
    expect(screen.getByRole('button', { name: 'Use the project file' }).className).toContain('btn--quiet')
    fireEvent.click(first)
    expect(choose).toHaveBeenCalledWith(true)
    unmount()

    render(<WebRecovery
      browser={{ document: draft(1, []), savedAt: '2026-09-06T08:00:00.000Z' }}
      project={{ document: draft(1, []), savedAt: '2026-09-06T09:30:00.000Z' }}
      onChoose={choose} />)
    const leading = screen.getAllByRole('button')[0]!
    expect(leading.textContent).toBe('Use the project file')
    expect(leading.className).toContain('btn--solid')
    fireEvent.click(leading)
    expect(choose).toHaveBeenLastCalledWith(false)
  })

  it('says so plainly when a version carries no time of its own', () => {
    render(<WebRecovery browser={{ document: draft(0, []) }} project={{ document: draft(0, []), savedAt: null }} onChoose={() => {}} />)
    expect(screen.getAllByText('Saved at an unknown time')).toHaveLength(2)
  })
})
