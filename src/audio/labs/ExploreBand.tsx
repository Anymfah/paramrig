import { Activity, Gem, Layers, Music2, ShieldCheck } from 'lucide-react'
import { Tooltip } from '@/ui/Tooltip'
import { DurationRange } from './DurationRange'
import { LabsDial, MassSelect } from './LabsDial'
import { Segment } from './Segment'
import { LAB_DIVERSITIES } from './catalog'
import { PALETTE_SECTIONS, paletteLabel, paletteSummary } from './palette'
import type { LabsHandle } from './useLabs'

const SECTION_ICONS = { source: Layers, timbre: Gem, behaviour: Activity, pitch: Music2 }
const DIVERSITY_HINTS = { focused: 'Stay close to the source', balanced: 'Explore the family', wild: 'More room to explore' }

/** The next search stays separate from the sound being sculpted on the bench. */
export function ExploreBand({ lab }: { lab: LabsHandle }) {
  const { criteria } = lab.session
  const summary = paletteSummary(criteria)
  const diversity = criteria.diversity ?? 'balanced'
  return (
    <div className="labs-search-band">
      <div className="labs-search-summary" aria-label="Next sound selections">
        <span className="labs-eyebrow">Next sound</span>
        <div className="labs-search-summary__choices">
          {PALETTE_SECTIONS.map((section) => {
            const Icon = SECTION_ICONS[section]
            return <Tooltip key={section} content={`Edit ${paletteLabel(section)}: ${summary[section]}`}>
              <button type="button" className="labs-search-summary__choice" aria-label={`Edit ${paletteLabel(section)}: ${summary[section]}`} onClick={() => lab.showPalette(section)}><Icon aria-hidden="true" /><span>{summary[section]}</span></button>
            </Tooltip>
          })}
          {criteria.avoid.length > 0 ? <button type="button" className="labs-search-summary__choice" onClick={() => lab.showPalette('timbre')} aria-label="Edit sound exclusions"><ShieldCheck aria-hidden="true" /><span>{criteria.avoid.length} excluded</span></button> : null}
        </div>
      </div>
      <div className="labs-strip labs-strip--next">
        <LabsDial label="Intensity" value={criteria.intensity ?? null} onBegin={lab.beginEdit} onChange={(intensity, record) => lab.setCriteria({ intensity }, record)} />
        <span className="labs-strip__rule" aria-hidden="true" />
        <LabsDial label="Density" value={criteria.density ?? null} onBegin={lab.beginEdit} onChange={(density, record) => lab.setCriteria({ density }, record)} />
        <span className="labs-strip__rule" aria-hidden="true" />
        <MassSelect value={criteria.mass ?? criteria.weight} onChange={(mass) => lab.setCriteria({ mass })} />
        <span className="labs-strip__rule" aria-hidden="true" />
        <DurationRange min={criteria.minMs} max={criteria.maxMs} onChange={lab.setDuration} />
        <span className="labs-strip__rule" aria-hidden="true" />
        <div className="labs-diversity"><span>Diversity</span><Tooltip content={DIVERSITY_HINTS[diversity]}><Segment label="Diversity" value={diversity} options={LAB_DIVERSITIES} onChange={(diversity) => lab.setCriteria({ diversity })} render={paletteLabel} /></Tooltip></div>
      </div>
      {lab.blocked ? <p className="labs-help" role="status">{lab.blocked}</p> : null}
    </div>
  )
}
