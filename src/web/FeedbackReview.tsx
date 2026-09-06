import { useState } from 'react'
import { Button } from '../ui/Button'
import { approved } from './session'
import type { ParameterDef } from '../rigs/types'
import { valuesEqual } from '../state/values'
import type { FeedbackBatch, Values, WebProjectManifest } from './contracts'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A value as the person set it: a colour keeps its swatch, a number keeps its unit. */
function Value({ param, value }: { param?: ParameterDef; value: unknown }) {
  const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
  if (param?.kind === 'color' && typeof value === 'string') {
    return <span className="web-value"><span className="web-swatch" style={{ background: value }} />{value}</span>
  }
  const unit = param?.kind === 'number' ? param.unit ?? '' : ''
  return <span className="web-value">{text}{unit}</span>
}

export function FeedbackReview({ batch, manifest, sent, disabled, publishing, onPublish, onBack }: {
  batch: FeedbackBatch
  manifest: WebProjectManifest
  /** The values of the last approved batch, so a change already handed over says so. */
  sent?: Values
  disabled: boolean
  publishing: boolean
  onPublish: (batch: FeedbackBatch) => void
  onBack: () => void
}) {
  const [excluded, setExcluded] = useState<string[]>([])
  const [dropped, setDropped] = useState<string[]>([])
  const toggle = (list: string[], id: string, keep: boolean) => keep ? list.filter(item => item !== id) : [...list, id]
  const ready = approved(batch, { changes: dropped, tickets: excluded })
  const param = (id: string) => manifest.parameters.find(p => p.id === id)
  const pageName = (id: string) => manifest.pages.find(page => page.id === id)?.name ?? id
  /*
   * A batch always carries every difference from the project source, so the agent reading the
   * newest one alone still sees the whole picture. Some of those differences were in the previous
   * batch too; saying so is what keeps this list honest against a button that counts only what is
   * new.
   */
  const already = (paramId: string, after: unknown) => sent?.[paramId] !== undefined && valuesEqual(sent[paramId], after as never)

  return <section className="web-section web-feedback-review">
    <p>{[ready.changes.length ? plural(ready.changes.length, 'control') : null, ready.tickets.length ? plural(ready.tickets.length, 'comment') : null].filter(Boolean).join(' · ') || 'Nothing selected'}</p>
    {batch.changes.map(change => <label className="web-check web-review-change" key={change.paramId}>
      <input type="checkbox" checked={!dropped.includes(change.paramId)} onChange={event => setDropped(list => toggle(list, change.paramId, event.target.checked))} />
      <span>
        <strong>{change.label}</strong>
        <span className="web-review-move"><Value param={param(change.paramId)} value={change.before} /> → <Value param={param(change.paramId)} value={change.after} />{already(change.paramId, change.after) ? <small className="web-already">Already sent</small> : null}</span>
      </span>
    </label>)}
    {batch.tickets.map(ticket => {
      const capture = ticket.captures.filter(c => c.status === 'ready' && (c.file || c.dataUrl)).at(-1)
      const context = [pageName(ticket.context.pageId), ticket.targets[0]?.label, ticket.marks.length ? plural(ticket.marks.length, 'mark') : null].filter(Boolean).join(' · ')
      return <label className="web-check web-review-ticket" key={ticket.id}>
        <input type="checkbox" checked={!excluded.includes(ticket.id)} onChange={event => setExcluded(list => toggle(list, ticket.id, event.target.checked))} />
        <span>
          {ticket.comment || ticket.targets[0]?.label || plural(ticket.marks.length, 'annotation')}
          <small>{context}</small>
        </span>
        {capture ? <img className="web-review-thumb" alt="" src={capture.dataUrl ?? `/api/web/${capture.file}`} /> : null}
      </label>
    })}
    <Button disabled={disabled || publishing || (!ready.tickets.length && !ready.changes.length)} onClick={() => onPublish(ready)}>{publishing ? 'Saving…' : 'Approve feedback'}</Button>
    <Button variant="quiet" disabled={publishing} onClick={onBack}>Back</Button>
  </section>
}
