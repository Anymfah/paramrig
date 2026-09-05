import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { FeedbackReview } from './FeedbackReview'
import { parseManifest } from './contracts'
import { WebSession } from './session'
import example from '../../examples/web/manifest.json'

it('keeps excluded tickets available for reselection without changing the prepared batch', () => {
  const session = new WebSession(parseManifest(example))
  const ticketId = session.addTicket({ pageId: 'home', url: example.origin + '/examples/web/index.html', viewport: { width: 1440, height: 900, dpr: 1 }, scroll: { x: 0, y: 0 }, scrollers: [] })
  session.editTicket(ticketId, draft => { draft.comment = 'Reduce the title size.' })
  const batch = session.batch([ticketId])
  const publish = vi.fn()
  render(<FeedbackReview batch={batch} disabled={false} publishing={false} onPublish={publish} onBack={() => {}} />)
  const checkbox = screen.getByRole('checkbox', { name: 'Reduce the title size.' })
  fireEvent.click(checkbox)
  expect(checkbox).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Validate feedback' })).toBeDisabled()
  expect(batch.tickets).toHaveLength(1)
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: 'Validate feedback' }))
  expect(publish).toHaveBeenCalledWith(batch)
})
