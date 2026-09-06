import { Button } from '../ui/Button'
import { valuesEqual } from '../state/values'
import type { WebDraft } from './contracts'

export type RecoveryVersion = { document: WebDraft; savedAt?: string | null }

const when = (savedAt?: string | null) => {
  if (!savedAt) return 'Saved at an unknown time'
  const date = new Date(savedAt)
  return Number.isNaN(date.getTime()) ? 'Saved at an unknown time' : `Saved ${date.toLocaleString()}`
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
/** What is in a version: what it says, and how far it has moved the project's own values. */
function summary(document: WebDraft) {
  const moved = Object.keys(document.values).filter(id => document.sourceValues[id] !== undefined && !valuesEqual(document.values[id]!, document.sourceValues[id]!))
  return [plural(document.tickets.length, 'comment'), `${plural(moved.length, 'value')} changed`].join(' · ')
}

/**
 * Two drafts of the same project, and the choice between them.
 *
 * The dialog used to offer two buttons and nothing to choose with — no date, no idea what either
 * version held. Both are described here, and the newest one is the one the eye lands on.
 */
export function WebRecovery({ browser, project, onChoose }: {
  browser: RecoveryVersion
  project: RecoveryVersion
  onChoose: (useBrowser: boolean) => void
}) {
  const time = (version: RecoveryVersion) => version.savedAt ? new Date(version.savedAt).getTime() : 0
  const browserIsNewer = time(browser) >= time(project)
  const choice = (label: string, version: RecoveryVersion, useBrowser: boolean, primary: boolean) => (
    <div className="web-version">
      <div>
        <strong>{label}</strong>
        <small>{when(version.savedAt)}</small>
        <small>{summary(version.document)}</small>
      </div>
      <Button variant={primary ? 'solid' : 'quiet'} size="sm" onClick={() => onChoose(useBrowser)}>{useBrowser ? 'Keep this browser' : 'Use the project file'}</Button>
    </div>
  )
  return <section className="web-section web-recovery">
    <h2>Draft changed elsewhere</h2>
    <p>Two versions of this draft exist. Choose the one to keep working in; the other is left as it is.</p>
    {browserIsNewer
      ? <>{choice('This browser', browser, true, true)}{choice('Project file', project, false, false)}</>
      : <>{choice('Project file', project, false, true)}{choice('This browser', browser, true, false)}</>}
  </section>
}
