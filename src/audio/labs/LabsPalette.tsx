import { useId, useMemo } from 'react'
import { Activity, Gem, Layers, Library, Music2 } from 'lucide-react'
import { NavRailHead } from '@/shell/NavRailHead'
import { Tooltip } from '@/ui/Tooltip'
import type { AudioSnapshot } from '@/audio/document'
import { LAB_DEMOS, labDemo } from './demos'
import { soundOfSnapshot } from './labels'
import { PaletteControls } from './PaletteControls'
import { PALETTE_SECTIONS, paletteLabel } from './palette'
import type { LabsHandle } from './useLabs'

const SECTION_ICONS = { source: Layers, timbre: Gem, behaviour: Activity, pitch: Music2, presets: Library }

export function LabsPalette({ lab, compact, inert, onNavigate, snapshots, instrumentName }: {
  lab: LabsHandle
  compact: boolean
  inert: boolean
  onNavigate: () => void
  snapshots: AudioSnapshot[]
  instrumentName: string
}) {
  const id = useId()
  const tab = lab.paletteView === 'presets' ? 'presets' : 'palette'
  const demos = useMemo(() => LAB_DEMOS.map((demo) => ({ ...demo, ms: Math.round(labDemo(demo.id).patch.duration * 1000) })), [])
  const selectTab = (entry: 'palette' | 'presets') => lab.setPaletteView(entry === 'presets' ? 'presets' : 'source')
  return (
    <nav className="nav-rail labs-palette" aria-label="Sound palette" data-compact={compact || undefined} inert={inert} onKeyDown={(event) => {
      if (event.key === 'Escape' && window.matchMedia('(width < 1024px)').matches) {
        event.stopPropagation(); onNavigate()
      }
    }}>
      <NavRailHead compact={compact} noun="palette" onNavigate={onNavigate} />
      {compact ? (
        <div className="labs-palette__compact scroll-area">
          {[...PALETTE_SECTIONS, 'presets' as const].map((section) => {
            const Icon = SECTION_ICONS[section]
            return <Tooltip key={section} content={paletteLabel(section)} side="right"><button type="button" className="icon-btn icon-btn--ghost" aria-label={`Open ${paletteLabel(section)}`} aria-pressed={lab.paletteView === section} onClick={() => lab.showPalette(section)}><Icon /></button></Tooltip>
          })}
        </div>
      ) : (
        <>
          <div className="labs-palette__tabs" role="tablist" aria-label="Palette sections">
            {(['palette', 'presets'] as const).map((entry) => (
              <button key={entry} type="button" role="tab" id={`${id}-tab-${entry}`} aria-selected={tab === entry} aria-controls={`${id}-panel`} tabIndex={tab === entry ? 0 : -1}
                onClick={() => selectTab(entry)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault(); event.stopPropagation()
                  const next = event.key === 'Home' ? 'palette' : event.key === 'End' ? 'presets' : entry === 'palette' ? 'presets' : 'palette'
                  selectTab(next)
                  document.getElementById(`${id}-tab-${next}`)?.focus()
                }}>
                {entry === 'palette' ? 'Palette' : 'Presets'}
              </button>
            ))}
          </div>
          <div className={tab === 'palette' ? 'labs-palette__panel' : 'labs-palette__scroll scroll-area'} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
            {tab === 'palette' ? <PaletteControls key={lab.paletteRevision} lab={lab} /> : (
              <div className="labs-presets">
                <section className="labs-group">
                  <h3 className="labs-group__title">Starting points</h3>
                  <ul className="labs-preset-list">
                    {demos.map((demo) => (
                      <li key={demo.id}><button type="button" className="labs-preset" onClick={() => { lab.loadDemo(demo.id); onNavigate() }}>
                        <span className="labs-preset__name">{demo.name}</span><span className="labs-preset__meta">{demo.ms} ms</span>
                      </button></li>
                    ))}
                  </ul>
                </section>
                <section className="labs-group">
                  <h3 className="labs-group__title">Saved</h3>
                  {snapshots.length ? (
                    <ul className="labs-preset-list">
                      {snapshots.map((snapshot) => (
                        <li key={snapshot.id}><button type="button" className="labs-preset" onClick={() => { lab.bench(soundOfSnapshot(snapshot)); onNavigate() }}>
                          <span className="labs-preset__name">{snapshot.name}</span><span className="labs-preset__meta">{Math.round(snapshot.patch.duration * 1000)} ms</span>
                        </button></li>
                      ))}
                    </ul>
                  ) : <p className="labs-palette__note">Sounds you save, here or in Instrument, appear in this list.</p>}
                </section>
                <section className="labs-group">
                  <h3 className="labs-group__title">Instrument</h3>
                  <button type="button" className="labs-preset" onClick={() => { lab.fromInstrument(); onNavigate() }}>
                    <span className="labs-preset__name">{instrumentName.trim() || 'Current patch'}</span><span className="labs-preset__meta">Bring to bench</span>
                  </button>
                </section>
              </div>
            )}
          </div>
        </>
      )}
    </nav>
  )
}
