import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Scan } from 'lucide-react'
import { IconButton } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'
import { SelectField } from '@/ui/SelectField'
import { brandElement, symbolMarkup } from '@/vector/brandApplications'
import type { VectorDocument } from '@/vector/types'

export function BrandSpecimens({ document }: { document: VectorDocument }) {
  const [mode, setMode] = useState('brand')
  const color = (id: string) => brandElement(document, `${id}-swatch`).fill
  return <Popover.Root>
    <Tooltip content="Symbol at actual size"><Popover.Trigger asChild><IconButton label="Symbol at actual size"><Scan size={18} aria-hidden="true" /></IconButton></Popover.Trigger></Tooltip>
    <Popover.Portal><Popover.Content className="popover brand-specimens" sideOffset={8} collisionPadding={8} align="end" aria-label="Symbol at actual size">
      <h2>Symbol at actual size</h2>
      <SelectField label="Preview" value={mode} onChange={setMode} options={[{ value: 'brand', label: 'Brand' }, { value: 'mono', label: 'Monochrome' }]} />
      <div className="brand-specimens__sizes"><span /><span>16 px</span><span>24 px</span><span>32 px</span></div>
      {['Light', 'Dark'].map((label, index) => {
        const ground = mode === 'mono' ? index ? '#000000' : '#ffffff' : color(index ? 'field' : 'paper')
        const ink = mode === 'mono' ? index ? '#ffffff' : '#000000' : color(index ? 'paper' : 'ink')
        return <div key={label} className="brand-specimens__row" style={{ background: ground, color: ink }}><span>{label}</span>{[16, 24, 32].map(size => <span key={size}><img alt={`${label} symbol, ${size} pixels`} width={size} height={size} src={`data:image/svg+xml,${encodeURIComponent(symbolMarkup(document, size, ink))}`} /></span>)}</div>
      })}
      <p className="field__hint">CSS pixels · independent of canvas zoom. Check the inner gaps and silhouette at each size.</p>
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}
