import { useDeferredValue, useMemo } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ClipboardCheck } from 'lucide-react'
import { IconButton } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'
import { checkBrand } from '@/vector/brandChecks'
import { useFontMetricsRevision } from '@/vector/fontMetrics'
import type { VectorDocument } from '@/vector/types'

export function BrandReview({ document }: { document: VectorDocument }) {
  const stable = useDeferredValue(document)
  const revision = useFontMetricsRevision()
  // The browser's font metrics are an external input to this calculation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const report = useMemo(() => checkBrand(stable), [stable, revision])
  const label = `Brand checks: ${report.issues.length} ${report.issues.length === 1 ? 'notice' : 'notices'}`
  return <Popover.Root>
    <Tooltip content={label}><Popover.Trigger asChild><IconButton label={label} data-notices={report.issues.length || undefined}><ClipboardCheck size={18} aria-hidden="true" /></IconButton></Popover.Trigger></Tooltip>
    <Popover.Portal><Popover.Content className="popover brand-review" sideOffset={8} collisionPadding={8} align="end" aria-label="Brand checks">
      <h2>Brand checks</h2>
      <p className="field__hint">Advisory checks at artwork size, not a certification. Text boxes and opaque, flat backgrounds only.</p>
      <p role="status">{report.issues.length ? `${report.issues.length} notices` : 'No issues found in the checked content.'}</p>
      <ul className="brand-review__issues">{report.issues.map((issue, index) => <li key={`${issue.elementId}-${index}`}><strong>{issue.kind === 'font' ? 'Font portability' : issue.kind === 'contrast' ? 'Low contrast' : 'Text overflow'}</strong><p>{issue.message}</p><small>{issue.page}</small></li>)}</ul>
      {report.uncheckedContrast > 0 ? <p className="field__hint">{report.uncheckedContrast} text backgrounds need visual review.</p> : null}
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}
