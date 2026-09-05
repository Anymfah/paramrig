import { useState } from 'react'
import { Button } from '../ui/Button'
import type { FeedbackBatch } from './contracts'

const displayValue = (value: unknown) => typeof value === 'object' ? JSON.stringify(value) : String(value)

export function FeedbackReview({ batch, disabled, publishing, onPublish, onBack }: {
  batch: FeedbackBatch
  disabled: boolean
  publishing: boolean
  onPublish: (batch: FeedbackBatch) => void
  onBack: () => void
}) {
  const [excluded, setExcluded] = useState<string[]>([])
  const included = batch.tickets.filter(ticket => !excluded.includes(ticket.id))
  return <section className="web-section web-feedback-review">
    <p>{[batch.changes.length ? `${batch.changes.length} control${batch.changes.length === 1 ? '' : 's'}` : null, included.length ? `${included.length} comment${included.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'No comments selected'}</p>
    {batch.changes.map(change => <div className="web-review-change" key={change.paramId}>
      <strong>{change.label}</strong>
      <p>{displayValue(change.before)} → {displayValue(change.after)}</p>
    </div>)}
    {batch.tickets.map(ticket => <label className="web-check" key={ticket.id}>
      <input type="checkbox" checked={!excluded.includes(ticket.id)} onChange={event => setExcluded(ids => event.target.checked ? ids.filter(id => id !== ticket.id) : [...ids, ticket.id])} />
      <span>{ticket.comment || ticket.targets[0]?.label || `${ticket.marks.length} annotations`}</span>
    </label>)}
    <Button disabled={disabled || publishing || (!included.length && !batch.changes.length)} onClick={() => onPublish({ ...batch, tickets: included })}>{publishing ? 'Saving…' : 'Validate feedback'}</Button>
    <Button variant="quiet" disabled={publishing} onClick={onBack}>Back</Button>
  </section>
}
