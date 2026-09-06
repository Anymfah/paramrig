import { Copy, SquareDashed, Unlink } from 'lucide-react'
import { StatusMessage } from '../ui/StatusMessage'
import { statusWord } from './selection'
import type { WebTarget } from './contracts'

/** A target's state in words, with the glyph that goes with it. Resolved targets say nothing. */
export function TargetStatus({ status }: { status: WebTarget['status'] }) {
  const word = statusWord[status]
  if (!word) return null
  const Icon = status === 'missing' ? Unlink : status === 'ambiguous' ? Copy : SquareDashed
  return <small className="web-target-status"><Icon size={12} aria-hidden="true" />{word}</small>
}

const count = (n: number) => n === 1 ? '1 control' : `${n} controls`
/** Repeated components share a name; the instance the integration gave them tells them apart. */
const naming = (target: WebTarget, all: WebTarget[]) =>
  target.stable?.instance && all.some(other => other.key !== target.key && other.label === target.label)
    ? `${target.label} · ${target.stable.instance}` : target.label

/** Instrumented elements, named and counted, each one a way to select and reveal it in the page. */
export function TargetPicks({ targets, label, onPick }: { targets: WebTarget[]; label: string; onPick: (target: WebTarget) => void }) {
  if (!targets.length) return null
  return <div className="web-picks" role="group" aria-label={label}>
    {targets.map(target => <button key={target.key} type="button" onClick={() => onPick(target)}>
      <span>{naming(target, targets)}</span>{target.controls ? <> <small>{count(target.controls)}</small></> : null}
    </button>)}
  </div>
}

/**
 * What the inspector shows for an element that carries no control of its own. An empty panel used
 * to be the whole answer, which left no way of knowing that controls existed anywhere on the page
 * short of clicking every element until one of them filled the inspector.
 */
export function NoControls({ ancestors, page, onPick }: { ancestors: WebTarget[]; page: WebTarget[]; onPick: (target: WebTarget) => void }) {
  return <section className="web-section web-no-controls">
    <StatusMessage>No controls on this element.</StatusMessage>
    {ancestors.length ? <><h2>Around it</h2><TargetPicks targets={ancestors} label="Ancestors with controls" onPick={onPick} /></> : null}
    {page.length ? <><h2>On this page</h2><TargetPicks targets={page} label="Elements with controls" onPick={onPick} /></> : null}
  </section>
}
