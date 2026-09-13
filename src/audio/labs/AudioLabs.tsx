import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Anchor, ArrowUpRight, Bookmark, BookmarkCheck, ChevronDown, EllipsisVertical, GitMerge, History, LoaderCircle, Plus, RefreshCw, Save, X } from 'lucide-react'
import { Button, IconButton } from '@/ui/Button'
import { Tooltip } from '@/ui/Tooltip'
import { SelectField } from '@/ui/SelectField'
import { moveSoundFocus } from '../sound-keys'
import { DurationRange } from './DurationRange'
import { ExploreBand } from './ExploreBand'
import { soundClassification } from './labels'
import { SoundWave } from './SoundWave'
import { Relief } from './Relief'
import type { GripHandlers } from './ReliefGrips'
import { Segment } from './Segment'
import { TimbreControls } from './TimbreControls'
import { CONTRIBUTIONS, LAB_AMOUNTS, LAB_MODES, MAX_HISTORY, MAX_RESERVE, RELIEF_VIEWS, titleCase, type LabMode, type LabSound, type ReliefView } from './model'
import type { LabsHandle } from './useLabs'
import { useReserveThumbnails } from './useReserveThumbnails'
import '@/styles/audio-labs.css'

const MODE_LABELS: Record<LabMode, string> = { create: 'Explore', vary: 'Variations', fuse: 'Fusion' }
const GENERATE_LABELS: Record<LabMode, string> = { create: 'Generate & play', vary: 'Vary & play', fuse: 'Fuse & play' }
const VIEW_KEY = 'paramrig.labs-view.v1'
const ms = (sound: LabSound) => Math.round(sound.patch.duration * 1000)
function readView(): ReliefView {
  try { const stored = localStorage.getItem(VIEW_KEY); return RELIEF_VIEWS.includes(stored as ReliefView) ? stored as ReliefView : 'spectrum' } catch { return 'spectrum' }
}

function Action({ label, children, side, ...props }: { label: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; onClick: () => void; disabled?: boolean; 'aria-pressed'?: boolean; className?: string; variant?: 'solid' | 'ghost' | 'quiet' }) {
  return <Tooltip content={label} side={side}><IconButton label={label} {...props}>{children}</IconButton></Tooltip>
}
/** Everything that can be done to a sound that is not playing or keeping it. */
function SoundMenu({ sound, lab, inReserve, side = 'bottom' }: { sound: LabSound; lab: LabsHandle; inReserve?: boolean; side?: 'bottom' | 'left' }) {
  const kept = lab.kept(sound)
  const isReference = lab.session.reference?.id === sound.id
  const item = (label: string, icon: ReactNode, onSelect: () => void, disabled = false) => (
    <DropdownMenu.Item className="menu__item" disabled={disabled} onSelect={onSelect}>{icon}<span>{label}</span></DropdownMenu.Item>
  )
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip content={`More for ${sound.name}`}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="icon-btn icon-btn--ghost" aria-label={`More for ${sound.name}`}><EllipsisVertical /></button>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" side={side} align="end" sideOffset={6} collisionPadding={8} aria-label={`Actions for ${sound.name}`}>
          {item(isReference ? 'Is the reference' : 'Use as reference', <Anchor />, () => lab.adoptReference(sound), isReference)}
          {inReserve ? null : item(kept ? 'In the reserve' : 'Keep in the reserve', kept ? <BookmarkCheck /> : <Bookmark />, () => lab.keep(sound), kept)}
          {inReserve && lab.session.mode === 'fuse' ? <>
            <DropdownMenu.Separator className="menu__sep" />
            {item(lab.session.principal === sound.id ? 'Is the principal' : 'Fuse as principal', <GitMerge />, () => lab.setPrincipal(sound.id), lab.session.principal === sound.id)}
            {item(lab.session.contributor === sound.id ? 'Is the contributor' : 'Fuse as contributor', <GitMerge />, () => lab.setContributor(sound.id), lab.session.contributor === sound.id)}
          </> : null}
          <DropdownMenu.Separator className="menu__sep" />
          {item('Save to Sounds', <Save />, () => lab.save(sound))}
          {item('Open in Instrument', <ArrowUpRight />, () => lab.open(sound))}
          {inReserve ? <>
            <DropdownMenu.Separator className="menu__sep" />
            {item('Remove from the reserve', <X />, () => lab.remove(sound.id))}
          </> : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** Solid transport glyphs: an outline triangle at twelve pixels reads as a sketch, not a control. */
const PlayGlyph = () => <svg className="labs-glyph-solid" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 3.1c0-.6.66-.97 1.17-.65l7.1 4.4c.48.3.48 1 0 1.3l-7.1 4.4c-.51.32-1.17-.05-1.17-.65z" /></svg>
const PauseGlyph = () => <svg className="labs-glyph-solid" viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="2.8" height="10" rx="0.9" /><rect x="9.2" y="3" width="2.8" height="10" rx="0.9" /></svg>

function PlayButton({ sound, lab, big = false }: { sound: LabSound; lab: LabsHandle; big?: boolean }) {
  const playing = lab.playing?.fingerprint === sound.fingerprint
  const loading = lab.loading === sound.fingerprint && !playing
  const label = playing ? `Stop ${sound.name}` : loading ? `Rendering ${sound.name}` : `Play ${sound.name}`
  return (
    <Tooltip content={playing ? 'Stop (Space)' : loading ? 'Rendering…' : 'Play (Space)'}>
      <button type="button" className={`labs-play${big ? ' labs-play--big' : ''}`} aria-label={label} aria-pressed={playing} data-loading={loading || undefined} onClick={() => lab.toggle(sound)}>
        {playing ? <PauseGlyph /> : loading ? <LoaderCircle className="labs-spin" /> : <PlayGlyph />}
      </button>
    </Tooltip>
  )
}

/**
 * The bench: one sound at a time, made from the palette, heard the moment it exists.
 *
 * The middle column is arranged around the loop the whole workspace is for — set what you want,
 * press once, listen, press again. The sound on the bench is the last one made or the one brought
 * back from the history or the reserve; the relief above the controls is the same audio the ear
 * just got, so what is seen and what is heard are one thing.
 */
export function AudioLabs({ lab }: { lab: LabsHandle }) {
  const { session, sound, render, busy, playing, loading, message, blocked } = lab
  const [view, setView] = useState<ReliefView>(readView)
  const [reserveOpen, setReserveOpen] = useState(false)
  const id = useId()
  const historyList = useRef<HTMLOListElement>(null)
  const thumbnailRoot = useRef<HTMLElement>(null)
  const thumbnailSounds = useMemo(() => [...session.reserve, ...session.history], [session.reserve, session.history])
  useReserveThumbnails(thumbnailRoot, thumbnailSounds, busy || !!loading || !!playing || !!lab.sculpting, lab.rate, lab.storePreview)
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view) } catch { /* A view that cannot be remembered is still shown. */ } }, [view])
  // A notice floats over the page instead of pushing it, and leaves on its own.
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(lab.dismiss, message.undo ? 9000 : 6000)
    return () => clearTimeout(timer)
  }, [message, lab.dismiss])
  const reference = session.reference
  const at = sound ? session.history.findIndex((entry) => entry.id === sound.id) : -1
  const where = !sound ? '' : at >= 0 ? `Current sound · ${String(at + 1).padStart(2, '0')}` : session.reserve.some((entry) => entry.id === sound.id) ? 'From the reserve' : 'Reference'
  const benchPlaying = sound && playing?.fingerprint === sound.fingerprint ? playing : null
  // The hand on the relief: the sound's own controls, each moved where it is lit.
  const values = sound ? lab.valuesOf(sound) : []
  const moved = (control: number, value: number) => values.map((entry, i) => (i === control ? value : entry))
  const grips: GripHandlers = {
    begin: lab.beginGesture, end: lab.endGesture, cancel: lab.cancelGesture, hear: lab.hearCurrent,
    change: (control, value) => lab.adjust(moved(control, value)),
    step: (control, value) => lab.adjust(moved(control, value)),
  }
  const modeKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = LAB_MODES.indexOf(session.mode)
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const next = event.key === 'Home' ? LAB_MODES[0]! : event.key === 'End' ? LAB_MODES[LAB_MODES.length - 1]! : LAB_MODES[(index + step + LAB_MODES.length) % LAB_MODES.length]!
    lab.setMode(next)
    queueMicrotask(() => document.getElementById(`${id}-mode-${next}`)?.focus())
  }
  const historyKeys = (event: KeyboardEvent<HTMLElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('.labs-row__main')]
    const next = moveSoundFocus(event.nativeEvent, items, 1)
    if (next === null) return
    const entry = [...session.history].reverse()[next]
    if (!entry) return
    lab.select(entry)
    items[next]?.focus()
    items[next]?.scrollIntoView?.({ block: 'nearest' })
  }
  const fixedDuration = session.mode === 'vary' && !session.varyDuration && reference ? ms(reference) : null
  const generateLabel = GENERATE_LABELS[session.mode]

  const generate = (
    <Tooltip content={blocked ?? (busy ? 'Rendering… press again to start over' : `${generateLabel} (Enter or G)`)}>
      <button type="button" className="labs-generate" aria-disabled={blocked ? true : undefined} aria-busy={busy || undefined} onClick={lab.generate}>
        {busy ? <LoaderCircle className="labs-spin" /> : <RefreshCw />}
        <span className="labs-generate__label">{busy ? 'Rendering…' : generateLabel}</span>
        <span className="labs-generate__play" aria-hidden="true"><PlayGlyph /></span>
      </button>
    </Tooltip>
  )

  return (
    <section className="audio-labs" aria-label="Sound Labs" ref={thumbnailRoot}>
      <div className="labs-main">
        <header className="labs-head">
          <h2>Sound Labs</h2>
          {generate}
          <div className="labs-modes" role="tablist" aria-label="Research mode">
            {LAB_MODES.map((mode) => (
              <button key={mode} type="button" role="tab" id={`${id}-mode-${mode}`} aria-selected={session.mode === mode} aria-controls={`${id}-band`} tabIndex={session.mode === mode ? 0 : -1} onClick={() => lab.setMode(mode)} onKeyDown={modeKeys}>
                {MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </header>

        <div className="labs-band" role="tabpanel" id={`${id}-band`} aria-labelledby={`${id}-mode-${session.mode}`} data-mode={session.mode}>
          {session.mode === 'create' ? (
            <ExploreBand lab={lab} />
          ) : session.mode === 'vary' ? (
            <>
              {reference ? (
                <div className="labs-panel labs-reference">
                  <div className="labs-reference__who">
                    <span className="labs-eyebrow">Reference</span>
                    <strong>{reference.name}</strong>
                    <span className="labs-reference__meta">{ms(reference)} ms · {reference.controls.length} controls</span>
                  </div>
                  <div className="labs-reference__actions">
                    <PlayButton sound={reference} lab={lab} />
                    {sound && sound.id !== reference.id ? <Button size="sm" variant="ghost" icon={<Anchor />} onClick={() => lab.adoptReference(sound)}>Use current sound</Button> : <span className="labs-tag">On the bench</span>}
                    {sound && sound.id !== reference.id ? <Button size="sm" variant="quiet" onClick={() => lab.select(reference, false)}>Show</Button> : null}
                    {session.references.length ? (
                      <DropdownMenu.Root modal={false}>
                        <Tooltip content="Previous references"><DropdownMenu.Trigger asChild><button type="button" className="icon-btn icon-btn--ghost" aria-label="Previous references"><History /></button></DropdownMenu.Trigger></Tooltip>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content className="menu" align="end" sideOffset={6} collisionPadding={8} aria-label="Previous references">
                            {session.references.map((entry, i) => <DropdownMenu.Item key={`${entry.id}-${i}`} className="menu__item" onSelect={() => lab.adoptReference(entry)}><Anchor /><span>{entry.name}</span><span className="menu__meta">{ms(entry)} ms</span></DropdownMenu.Item>)}
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    ) : null}
                  </div>
                </div>
              ) : <p className="labs-help">Generate or pick a sound, then use it as the reference. Variations stay anchored to it.</p>}
              <div className="labs-band__row">
                <div className="labs-field labs-field--inline">
                  <span className="labs-field__title">Amount</span>
                  <Segment label="Variation amount" value={session.amount} options={LAB_AMOUNTS} onChange={lab.setAmount} render={(amount) => <span>{titleCase(amount)}</span>} />
                </div>
                <label className="labs-switch">
                  <input type="checkbox" role="switch" checked={session.varyDuration} onChange={(event) => lab.setVaryDuration(event.target.checked)} />
                  <span className="labs-switch__track"><span className="labs-switch__thumb" /></span>
                  <span>Vary duration</span>
                </label>
                <DurationRange min={fixedDuration ?? session.criteria.minMs} max={fixedDuration ?? session.criteria.maxMs} disabled={!session.varyDuration} onChange={lab.setDuration} />
              </div>
            </>
          ) : (
            <>
              <div className="labs-panel labs-fusion">
                <SelectField label="Principal" value={session.principal ?? 'none'} presentation="menu" options={[{ value: 'none', label: 'Choose from the reserve' }, ...session.reserve.map((entry) => ({ value: entry.id, label: entry.name }))]} onChange={(value) => lab.setPrincipal(value === 'none' ? null : value)} />
                <GitMerge aria-hidden="true" className="labs-fusion__mark" />
                <SelectField label="Contributor" value={session.contributor ?? 'none'} presentation="menu" options={[{ value: 'none', label: 'Choose from the reserve' }, ...session.reserve.map((entry) => ({ value: entry.id, label: entry.name }))]} onChange={(value) => lab.setContributor(value === 'none' ? null : value)} />
              </div>
              <div className="labs-band__row">
                <div className="labs-field labs-field--inline">
                  <span className="labs-field__title">Contribution</span>
                  <Segment label="Contribution" value={session.contribution} options={CONTRIBUTIONS} onChange={lab.setContribution} render={(part) => <span>{titleCase(part)}</span>} />
                </div>
                <label className="labs-influence">
                  <span className="labs-field__title">Influence <output>{Math.round(session.influence * 100)}%</output></span>
                  <input type="range" aria-label="Influence" aria-valuetext={`${Math.round(session.influence * 100)} percent`} min={5} max={85} value={Math.round(session.influence * 100)} onChange={(event) => lab.setInfluence(Number(event.target.value) / 100)} />
                </label>
                <DurationRange min={session.criteria.minMs} max={session.criteria.maxMs} onChange={lab.setDuration} />
                <p className="labs-help labs-band__note" role={blocked ? 'status' : undefined}>{blocked ?? 'The principal keeps its body and effects. One contribution comes in from the second sound.'}</p>
              </div>
            </>
          )}
        </div>

        <article className="labs-bench" aria-label="Current sound" data-playing={benchPlaying ? '' : undefined}>
          <div className="labs-stage">
            <Relief render={render} playing={benchPlaying} loading={!!sound && loading === sound.fingerprint && !render} view={view} onView={setView} durationMs={sound ? ms(sound) : 0} empty={!sound} name={sound?.name ?? ''} sound={sound} grips={grips} />
            <header className="labs-bench__head">
              <div className="labs-bench__title">
                <h2>{sound?.name ?? 'Nothing on the bench yet'}</h2>
                <Tooltip content={sound ? soundClassification(sound) : null}><p className="labs-bench__meta">{sound ? `${where}${sound.origin.kind === 'variation' || sound.origin.kind === 'fusion' ? ` · ${titleCase(sound.origin.kind)}` : ''}` : 'Choose a family and a material, then generate.'}{sound ? ` · ${soundClassification(sound)}` : ''}</p></Tooltip>
              </div>
              {sound ? <div className="labs-bench__levels">
                <span className="labs-bench__ms">{ms(sound)} ms</span>
                {render ? <Tooltip content={`Output peak: ${render.peak > 0 ? (20 * Math.log10(render.peak)).toFixed(1) : '−∞'} dBFS · RMS: ${render.rms > 0 ? (20 * Math.log10(render.rms)).toFixed(1) : '−∞'} dBFS. The relief is relative to its strongest spectral bin, not the output level.`}>
                  <span className="labs-bench__peak" tabIndex={0}>Peak {render.peak > 0 ? (20 * Math.log10(render.peak)).toFixed(1) : '−∞'} dBFS</span>
                </Tooltip> : null}
              </div> : null}
              {sound ? (
                <div className="labs-bench__actions">
                  <PlayButton sound={sound} lab={lab} big />
                  <Action label={lab.kept(sound) ? 'In the reserve' : 'Keep in the reserve (K)'} aria-pressed={lab.kept(sound)} onClick={() => lab.keep(sound)}><Bookmark className={lab.kept(sound) ? 'labs-filled' : undefined} /></Action>
                  <TimbreControls lab={lab} sound={sound} />
                  <SoundMenu sound={sound} lab={lab} />
                </div>
              ) : null}
            </header>
          </div>
        </article>

        <section className="labs-history" aria-label="History">
          <header className="labs-history__head">
            <h2>History</h2>
            <span>Last {MAX_HISTORY}</span>
          </header>
          {session.history.length ? (
            <ol className="labs-rows" ref={historyList} onKeyDown={historyKeys}>
              {[...session.history].map((entry, i) => ({ entry, index: i + 1 })).reverse().map(({ entry, index }) => {
                const isCurrent = sound?.id === entry.id
                const isPlaying = playing?.fingerprint === entry.fingerprint
                return (
                  <li key={entry.id} className="labs-row" data-current={isCurrent || undefined} data-playing={isPlaying || undefined}>
                    <PlayButton sound={entry} lab={lab} />
                    <button type="button" className="labs-row__main" aria-current={isCurrent ? 'true' : undefined} aria-label={`${entry.name}, ${ms(entry)} milliseconds${isCurrent ? ', on the bench' : ''}`} onClick={() => lab.select(entry)}>
                      <span className="labs-row__index">{String(index).padStart(2, '0')}</span>
                      <span className="labs-row__name">{entry.name}</span>
                      <SoundWave sound={entry} />
                      <span className="labs-row__ms">{ms(entry)} ms</span>
                    </button>
                    <Action label={lab.kept(entry) ? 'In the reserve' : `Keep ${entry.name}`} aria-pressed={lab.kept(entry)} onClick={() => lab.keep(entry)}>{lab.kept(entry) ? <BookmarkCheck /> : <Bookmark />}</Action>
                  </li>
                )
              })}
            </ol>
          ) : <p className="labs-help">Every sound you generate or bring to the bench is listed here, newest first, so the one you just passed is one click back.</p>}
        </section>
        <div className="labs-toast" role="status" aria-label="Labs notice" aria-live="polite" data-open={message ? '' : undefined}>
          {message ? <>
            <span className="labs-toast__text">{message.text}</span>
            {message.undo ? <Button size="sm" variant="quiet" onClick={lab.undo}>Undo</Button> : null}
            <button type="button" className="labs-toast__close" aria-label="Dismiss" onClick={lab.dismiss}><X /></button>
          </> : null}
        </div>
      </div>

      <aside className="labs-reserve" aria-label="Sound reserve" data-open={reserveOpen || undefined}>
        <header className="labs-reserve__head">
          <h2>Reserve <span>{session.reserve.length} / {MAX_RESERVE}</span></h2>
          <div className="labs-reserve__tools">
            {sound ? <Action label={lab.kept(sound) ? 'The current sound is already kept' : `Keep ${sound.name}`} disabled={lab.kept(sound)} onClick={() => lab.keep(sound)}><Plus /></Action> : null}
            <button type="button" className="icon-btn icon-btn--ghost labs-reserve__toggle" aria-label={reserveOpen ? 'Hide the reserve' : 'Show the reserve'} aria-expanded={reserveOpen} onClick={() => setReserveOpen(!reserveOpen)}><ChevronDown /></button>
          </div>
        </header>
        <div className="labs-reserve__body">
          {!session.reserve.length ? <p className="labs-help">Keep promising sounds here to compare, vary or fuse.</p> : null}
          {session.reserve.map((entry, i) => {
            const isCurrent = sound?.id === entry.id
            return (
              <article key={entry.id} className="labs-card" aria-label={`${entry.name}, kept sound ${i + 1}`} data-current={isCurrent || undefined} data-playing={playing?.fingerprint === entry.fingerprint || undefined}>
                <header className="labs-card__head">
                  <input className="labs-card__name" aria-label={`Reserve sound ${i + 1} name`} value={entry.name} maxLength={80} spellCheck={false}
                    onChange={(event) => lab.rename(entry.id, event.target.value)} onBlur={(event) => lab.rename(entry.id, event.target.value, true)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
                  <span className="labs-card__ms">{ms(entry)} ms</span>
                  <SoundMenu sound={entry} lab={lab} inReserve side="left" />
                </header>
                <button type="button" className="labs-card__wave" aria-label={`Show ${entry.name} on the bench`} aria-pressed={isCurrent} onClick={() => lab.select(entry, false)}><SoundWave sound={entry} /></button>
                <footer className="labs-card__foot">
                  <PlayButton sound={entry} lab={lab} />
                  <Action label={reference?.id === entry.id ? `${entry.name} is the reference` : `Use ${entry.name} as reference`} aria-pressed={reference?.id === entry.id} onClick={() => lab.adoptReference(entry)}><Anchor /></Action>
                  <Tooltip content={soundClassification(entry)}><span className="labs-card__tags">{soundClassification(entry)}</span></Tooltip>
                  <Action label={`Remove ${entry.name} from the reserve`} onClick={() => lab.remove(entry.id)}><X /></Action>
                </footer>
              </article>
            )
          })}
        </div>
      </aside>
    </section>
  )
}
