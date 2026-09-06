import { Tooltip } from '../ui/Tooltip'
import type { WebContext, WebTarget, WebTicket } from './contracts'
import { markPoints } from './geometry'
import { ticketNumber } from './session'

function visibleBox(target: WebTarget, viewport: { width: number; height: number }) {
  if (target.status === 'missing' || target.status === 'ambiguous') return null
  const clip = target.clip ?? { x: 0, y: 0, ...viewport }
  const x = Math.max(0, clip.x, target.rect.x)
  const y = Math.max(0, clip.y, target.rect.y)
  const right = Math.min(viewport.width, clip.x + clip.width, target.rect.x + target.rect.width)
  const bottom = Math.min(viewport.height, clip.y + clip.height, target.rect.y + target.rect.height)
  return right > x && bottom > y ? { x, y, right, bottom } : null
}

/** The numbered bubbles over the page. Nothing else floats here: a button pinned over the
 * selection covered the very heading a person had just chosen to talk about. */
export function WebAnnotations({ tickets, targets, context, scale, viewport, activeId, onOpen }: {
  tickets: WebTicket[]
  targets: WebTarget[]
  context: WebContext | null
  scale: number
  viewport: { width: number; height: number }
  activeId: string | null
  onOpen: (ticket: WebTicket) => void
}) {
  if (!context) return null
  const occupied: { x: number; y: number }[] = []
  return <div className="web-annotations" aria-label="Page comments">
    {tickets.map(ticket => {
      const index = ticketNumber(tickets, ticket) - 1
      if (ticket.context.pageId !== context.pageId || ticket.status === 'validated') return null
      const note = ticket.marks.find(mark => mark.tool === 'note')
      const mark = note ?? ticket.marks[0]
      const target = targets.find(target => target.key === (note?.targetKey ?? ticket.targets[0]?.key ?? mark?.targetKey))
      const targetBox = target ? visibleBox(target, viewport) : null
      if (target && !targetBox) return null
      const point = note ? markPoints(note, targets, context.scroll)?.[0] : targetBox ? { x: targetBox.right, y: targetBox.y } : mark ? markPoints(mark, targets, context.scroll)?.[0] : null
      if (!point || point.x < 0 || point.x > viewport.width || point.y < 0 || point.y > viewport.height || (targetBox && (point.x < targetBox.x || point.y < targetBox.y || point.x > targetBox.right || point.y > targetBox.bottom))) return null
      let x = Math.max(20, Math.min(viewport.width * scale - 20, point.x * scale))
      const y = Math.max(20, Math.min(viewport.height * scale - 20, point.y * scale))
      while (occupied.some(p => Math.hypot(x - p.x, y - p.y) < 30) && x > 50) x -= 32
      occupied.push({ x, y })
      return <Tooltip key={ticket.id} content={ticket.comment || target?.label || `Comment ${index + 1}`}><button type="button" className="web-comment-pin" style={{ left: x, top: y }} aria-label={`Open comment ${index + 1}`} aria-pressed={activeId === ticket.id} onClick={() => onOpen(ticket)}><span>{index + 1}</span></button></Tooltip>
    })}
  </div>
}
