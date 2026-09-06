import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { WebAnnotations } from './WebAnnotations'
import type { WebContext, WebTarget, WebTicket } from './contracts'

it('opens the spatial comment, follows geometry at display scale, and hides clipped or missing targets', () => {
  const target: WebTarget = { key: 'button', pageId: 'home', selector: 'button', fingerprint: 'button', tag: 'button', label: 'Explore', status: 'resolved', rect: { x: 100, y: 100, width: 120, height: 40 }, ancestors: [] }
  const context: WebContext = { pageId: 'home', url: 'http://localhost', viewport: { width: 800, height: 600, dpr: 1 }, scroll: { x: 0, y: 0 }, scrollers: [] }
  const ticket: WebTicket = { id: 'ticket', comment: 'Increase spacing', status: 'draft', targets: [target], marks: [], captures: [], context, revision: '1', createdAt: '2026-09-05T00:00:00Z' }
  const onOpen = vi.fn()
  const props = { tickets: [ticket], targets: [target], context, scale: .5, viewport: { width: 800, height: 600 }, activeId: null, onOpen }
  const { rerender } = render(<WebAnnotations {...props} />)
  const pin = screen.getByRole('button', { name: 'Open comment 1' })
  expect(pin).toHaveStyle({ left: '110px', top: '50px' })
  fireEvent.click(pin)
  expect(onOpen).toHaveBeenCalledWith(ticket)
  rerender(<WebAnnotations {...props} targets={[{ ...target, rect: { ...target.rect, y: 200 } }]} />)
  expect(pin).toHaveStyle({ top: '100px' })
  rerender(<WebAnnotations {...props} targets={[{ ...target, clip: { x: 0, y: 200, width: 800, height: 300 } }]} />)
  expect(screen.queryByRole('button', { name: 'Open comment 1' })).not.toBeInTheDocument()
  rerender(<WebAnnotations {...props} targets={[{ ...target, status: 'missing' }]} />)
  expect(screen.queryByRole('button', { name: 'Open comment 1' })).not.toBeInTheDocument()
})
