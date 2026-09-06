import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FeedbackReview } from './FeedbackReview'
import { parseManifest } from './contracts'
import { approved, WebSession } from './session'
import example from '../../examples/web/manifest.json'

const manifest = parseManifest(example)
const context = { pageId: 'home', url: example.origin + '/examples/web/index.html', viewport: { width: 1440, height: 900, dpr: 1 }, scroll: { x: 0, y: 0 }, scrollers: [] }

function prepared() {
  const session = new WebSession(manifest)
  const id = session.addTicket(context, [{ key: 'hero', label: 'Hero title', tag: 'h1', stable: { id: 'hero-title' }, pageId: 'home', selector: 'h1', fingerprint: 'h1', rect: { x: 0, y: 0, width: 10, height: 10 }, ancestors: [], status: 'resolved' }])
  session.editTicket(id, draft => { draft.comment = 'Reduce the title size.' })
  session.setValue('accent', '#123456')
  session.setValue('content-width', 1000)
  return { session, id, batch: session.batch([id]) }
}

const review = (batch: ReturnType<WebSession['batch']>, publish = vi.fn()) => {
  render(<FeedbackReview batch={batch} manifest={manifest} disabled={false} publishing={false} onPublish={publish} onBack={() => {}} />)
  return publish
}

describe('the review before feedback is approved', () => {
  it('keeps excluded tickets available for reselection without changing the prepared batch', () => {
    const { batch } = prepared()
    const publish = review(batch)
    const checkbox = screen.getByRole('checkbox', { name: /Reduce the title size/ })
    fireEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
    expect(batch.tickets).toHaveLength(1)
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Approve feedback' }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ tickets: batch.tickets, changes: batch.changes }))
  })

  it('refuses to approve a batch with nothing left in it', () => {
    const { batch } = prepared()
    review(batch)
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
    expect(screen.getByRole('button', { name: 'Approve feedback' })).toBeDisabled()
    expect(screen.getByText('Nothing selected')).toBeInTheDocument()
  })

  it('puts an excluded control back to its source value instead of dropping it from the batch', () => {
    const { batch } = prepared()
    const publish = review(batch)
    fireEvent.click(screen.getByRole('checkbox', { name: /Primary color/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve feedback' }))
    const sent = publish.mock.calls[0]![0]
    expect(sent.changes.map((c: { paramId: string }) => c.paramId)).toEqual(['content-width'])
    // The batch still describes the whole state the agent should reach, and that state keeps the
    // source colour rather than the one the user took back out.
    expect(sent.values.accent).toBe('#bc593d')
    expect(sent.values['content-width']).toBe(1000)
  })

  it('shows a control change with its colour and its unit, and a comment with where it came from', () => {
    const { batch } = prepared()
    review(batch)
    expect(screen.getByText('Primary color')).toBeInTheDocument()
    expect(screen.getByText('#bc593d')).toBeInTheDocument()
    expect(screen.getByText('1120px')).toBeInTheDocument()
    expect(screen.getByText('1000px')).toBeInTheDocument()
    expect(document.querySelectorAll('.web-swatch')).toHaveLength(2)
    expect(screen.getByText('Home · Hero title')).toBeInTheDocument()
  })
})

describe('the approved batch', () => {
  it('is the prepared one when nothing was taken out', () => {
    const { batch } = prepared()
    expect(approved(batch)).toEqual(batch)
  })

  it('never asks for a change whose value it contradicts', () => {
    const { batch } = prepared()
    const ready = approved(batch, { changes: ['accent', 'content-width'] })
    expect(ready.changes).toEqual([])
    expect(ready.values).toEqual({ ...batch.values, accent: '#bc593d', 'content-width': 1120 })
  })
})
