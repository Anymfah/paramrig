import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Layers2, Minus, Plus, Search, X } from 'lucide-react'
import { Tooltip } from '@/ui/Tooltip'
import { IconCheck } from '@/ui/icons'
import { AVOID_LABELS } from './labels'
import { LAB_AVOID, type LabCriteria } from './model'
import { FAMILY_DEFINITIONS, LAB_SCALES, SDK_MOTIONS, labCharacterCatalog, labFamilyCatalog, labMaterialCatalog, type LabDomain, type LabMaterial, type SdkFamily } from './catalog'
import { LAB_ENDINGS, LAB_REGISTERS, LAB_TEXTURES, labGestureOptions } from './selections'
import { LAB_CHORDS, LAB_VOICINGS, hasChord } from './harmony-catalog'
import { labSubtypeCatalog, type LabSubtype } from './subtypes'
import { GestureGlyph, MotionGlyph } from './glyphs'
import { PaletteFamilySymbol, PaletteMaterialSymbol } from './PaletteSymbol'
import { PALETTE_DOMAINS, PALETTE_SECTIONS, noteLabel, paletteFamilies, paletteGestures, paletteLabel, paletteSelection, paletteSupportsChord, selectedPaletteValues, type PaletteDimension, type PaletteSection } from './palette'
import type { LabsHandle } from './useLabs'

const FAMILIES = labFamilyCatalog(), MATERIALS = labMaterialCatalog(), CHARACTERS = labCharacterCatalog(), SUBTYPES = labSubtypeCatalog()
const REGISTER_LABELS = { auto: 'Auto', low: 'Low', mid: 'Mid', high: 'High', full: 'Full spectrum' }
const labels = (options: readonly string[]) => options.map((id) => ({ id, label: paletteLabel(id) }))
const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const ALIASES: Record<string, string> = { engine: 'moteur', turbine: 'reacteur avion', water: 'eau liquide', glass: 'verre cristal', metal: 'metallique acier', breath: 'souffle respiration', wood: 'bois', rain: 'pluie', creature: 'monstre animal', percussion: 'batterie rythme', choir: 'choeur voix', fire: 'feu', wind: 'vent', footstep: 'pas marche', spring: 'ressort', notification: 'alerte ui', 'bubble-pop': 'bulle', 'fabric-rustle': 'tissu froissement', 'paper-crumple': 'papier froisse' }
type SearchEntry = { id: string; label: string; kind: PaletteDimension | 'subtype'; context: string; words: string }
const SEARCH: SearchEntry[] = [
  ...FAMILIES.map((f) => ({ id: f.id, label: f.label, kind: 'type' as const, context: PALETTE_DOMAINS.find((d) => d.id === f.domain)!.label, words: f.description })),
  ...SUBTYPES.map((s) => ({ id: s.id, label: s.label, kind: 'subtype' as const, context: FAMILY_DEFINITIONS[s.family].label, words: `${s.description} ${s.group ?? ''}` })),
  ...MATERIALS.filter((m) => m.id !== 'any').map((m) => ({ ...m, kind: 'material' as const, context: 'Material', words: '' })),
  ...CHARACTERS.filter((c) => c.id !== 'any').map((c) => ({ ...c, kind: 'character' as const, context: 'Character', words: '' })),
].map((entry) => ({ ...entry, words: normalize(`${entry.id} ${entry.label} ${entry.context} ${entry.words} ${ALIASES[entry.id] ?? ''}`) }))

function Choices<T extends string>({ label, value, options, onChange, disabled, columns = 3, pictures = false }: {
  label: string; value: T; options: readonly { id: T; label: string; picture?: ReactNode; reason?: string }[]; onChange: (id: T) => void; disabled: boolean; columns?: number; pictures?: boolean
}) {
  const id = useId()
  return <fieldset className="labs-catalog-group" disabled={disabled}>
    <legend className="labs-catalog-group__title">{label}</legend>
    <div className={`labs-catalog-grid labs-catalog-grid--${columns}`} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const tile = <label className={pictures ? 'labs-tile labs-catalog-tile' : 'labs-chip labs-catalog-chip'} data-checked={option.id === value || undefined} data-unavailable={!!option.reason || undefined}>
          <input type="radio" name={id} value={option.id} checked={option.id === value} disabled={disabled || !!option.reason} aria-label={option.label} onChange={() => onChange(option.id)} />
          {option.picture}<span>{option.label}</span>{pictures ? <IconCheck className="labs-tile__check" /> : null}
        </label>
        return option.reason ? <Tooltip key={option.id} content={option.reason}>{tile}</Tooltip> : <span className="labs-catalog-cell" key={option.id}>{tile}</span>
      })}
    </div>
  </fieldset>
}

export function PaletteControls({ lab }: { lab: LabsHandle }) {
  const id = useId(), { criteria, mode } = lab.session
  const section: PaletteSection = lab.paletteView === 'presets' ? 'source' : lab.paletteView
  const [query, setQuery] = useState('')
  const [domain, setDomain] = useState<LabDomain>(() => FAMILY_DEFINITIONS[paletteFamilies(criteria)[0] ?? 'growl'].domain)
  const [multiple, setMultiple] = useState({ type: false, material: false, character: false })
  const [octave, setOctave] = useState(criteria.rootNote === undefined ? 3 : Math.floor(criteria.rootNote / 12) - 1)
  const disabled = mode !== 'create'
  const results = useMemo(() => SEARCH.filter((entry) => entry.words.includes(normalize(query.trim()))), [query])
  const familyValues = selectedPaletteValues(criteria, 'type')
  const subtypeOptions = SUBTYPES.filter((s) => criteria.type === 'any' ? !!criteria.pool?.families?.includes(s.family) : s.family === criteria.type)
  const showSubtypes = subtypeOptions.length > 0 && familyValues.length <= 1
  const gestures = paletteGestures(criteria)
  const families = paletteFamilies(criteria)
  const eligible = families.filter((family) => (!hasChord(criteria) || paletteSupportsChord({ ...criteria, type: family, pool: undefined })) && labGestureOptions(family).some((g) => g.id === (criteria.gesture ?? 'auto')))
  useEffect(() => {
    if (lab.paletteRevision > 0) document.getElementById(`${id}-${lab.paletteView}`)?.focus()
  }, [id, lab.paletteRevision, lab.paletteView])
  const change = (update: Partial<LabCriteria>) => lab.setCriteria(update)
  const isMultiple = (dimension: PaletteDimension) => multiple[dimension] || selectedPaletteValues(criteria, dimension).length > 1
  const pick = (dimension: PaletteDimension, value: string) => {
    const selected = selectedPaletteValues(criteria, dimension)
    const values = value === 'any' ? [] : isMultiple(dimension) ? selected.includes(value) ? selected.filter((id) => id !== value) : [...selected, value] : [value]
    change(paletteSelection(criteria, dimension, values))
  }
  const toggleMultiple = (dimension: PaletteDimension) => {
    const next = !isMultiple(dimension)
    setMultiple({ ...multiple, [dimension]: next })
    const selected = selectedPaletteValues(criteria, dimension)
    if (!next && selected.length > 1) change(paletteSelection(criteria, dimension, selected.slice(0, 1)))
  }
  const chooseSearch = (entry: SearchEntry) => {
    if (entry.kind === 'subtype') {
      const subtype = SUBTYPES.find((s) => s.id === entry.id)!
      change({ ...paletteSelection(criteria, 'type', [subtype.family]), subtype: subtype.id }); setDomain(FAMILY_DEFINITIONS[subtype.family].domain); lab.setPaletteView('source')
    } else {
      pick(entry.kind, entry.id)
      if (entry.kind === 'type') { setDomain(FAMILY_DEFINITIONS[entry.id as keyof typeof FAMILY_DEFINITIONS].domain); lab.setPaletteView('source') }
      else lab.setPaletteView('timbre')
    }
    setQuery('')
  }
  const group = (dimension: PaletteDimension, label: string, options: { id: string; label: string }[], kind: 'family' | 'material' | 'character') => {
    const selected = selectedPaletteValues(criteria, dimension), multi = isMultiple(dimension)
    return <fieldset className="labs-catalog-group" disabled={disabled}>
      <legend className="labs-catalog-group__title"><span>{label}</span><Tooltip content={`Select several ${dimension === 'type' ? 'families' : label.toLowerCase() + 's'}. Each generation draws one alternative.`}><button type="button" className="labs-catalog-multiple" aria-label={`Select multiple ${dimension === 'type' ? 'families' : label.toLowerCase() + 's'}`} aria-pressed={multi} disabled={disabled} onClick={() => toggleMultiple(dimension)}><Layers2 aria-hidden="true" /><span>Multiple</span></button></Tooltip></legend>
      {dimension === 'type' && multi && selected.length ? <div className="labs-catalog-selection" aria-label="Selected families">{selected.map((value) => <Tooltip key={value} content={`Remove ${FAMILY_DEFINITIONS[value as keyof typeof FAMILY_DEFINITIONS].label} from this selection`}><button type="button" disabled={disabled} aria-label={`Remove ${FAMILY_DEFINITIONS[value as keyof typeof FAMILY_DEFINITIONS].label} from family choices`} onClick={() => pick('type', value)}>{FAMILY_DEFINITIONS[value as keyof typeof FAMILY_DEFINITIONS].label}<X aria-hidden="true" /></button></Tooltip>)}</div> : null}
      <div className="labs-catalog-grid labs-catalog-grid--3" role={multi ? 'group' : 'radiogroup'} aria-label={label}>
        {options.map((option) => {
          const checked = option.id === 'any' ? !selected.length : selected.includes(option.id)
          return <label key={option.id} className={kind === 'character' ? 'labs-chip labs-catalog-chip' : `labs-tile labs-catalog-tile labs-catalog-tile--${kind}`} data-checked={checked || undefined}>
            <input type={multi ? 'checkbox' : 'radio'} name={`${id}-${dimension}`} value={option.id} checked={checked} disabled={disabled} onChange={() => pick(dimension, option.id)} aria-label={option.label} />
            {kind === 'family' ? <PaletteFamilySymbol family={option.id as SdkFamily} /> : kind === 'material' ? <PaletteMaterialSymbol material={option.id as LabMaterial} /> : null}
            <span>{option.label}</span>{kind !== 'character' ? <IconCheck className="labs-tile__check" /> : null}
          </label>
        })}
      </div>
      {multi ? <p className="labs-catalog-caption">{selected.length || 'All'} {dimension === 'type' ? selected.length === 1 ? 'source' : 'sources' : label.toLowerCase() + (selected.length === 1 ? '' : 's')} · one drawn per generation.</p> : null}
    </fieldset>
  }
  return <div className="labs-catalog">
    <div className="labs-catalog-search">
      <Search aria-hidden="true" /><input type="search" aria-label="Find a sound, material or character" placeholder="Find a sound, a material…" value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.stopPropagation(); setQuery('') } }} />
      {query ? <Tooltip content="Clear search"><button type="button" className="icon-btn icon-btn--ghost" aria-label="Clear search" onClick={() => setQuery('')}><X /></button></Tooltip> : null}
    </div>
    <div className="labs-catalog-tabs" role="tablist" aria-label="Search sections">
      {PALETTE_SECTIONS.map((value, index) => <button key={value} type="button" role="tab" id={`${id}-${value}`} aria-controls={`${id}-panel`} aria-selected={section === value} tabIndex={section === value ? 0 : -1} onClick={() => { lab.setPaletteView(value); setQuery('') }} onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        const next = PALETTE_SECTIONS[event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index + (event.key === 'ArrowRight' ? 1 : 3)) % 4]!
        lab.setPaletteView(next); setQuery(''); document.getElementById(`${id}-${next}`)?.focus()
      }}>{paletteLabel(value)}</button>)}
    </div>
    <div className="labs-catalog-content scroll-area" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${section}`}>
      {disabled ? <p className="labs-palette__note">{mode === 'vary' ? 'Variations stay with the reference.' : 'Fusion uses the two kept sounds.'} <button type="button" className="labs-link" onClick={() => lab.setMode('create')}>Back to Explore</button></p> : null}
      {query.trim() ? <div className="labs-catalog-results"><span className="labs-catalog-caption" role="status">{results.length} results</span>{results.map((entry) => <button type="button" className="labs-catalog-result" aria-label={`${entry.label} ${entry.context}`} key={`${entry.kind}-${entry.id}`} onClick={() => chooseSearch(entry)} disabled={disabled}><span>{entry.label}</span><small>{entry.context}</small></button>)}{!results.length ? <p className="labs-help">No match. Try “engine”, “glass” or “breath”.</p> : null}</div> : section === 'source' ? <>
        <div className="labs-catalog-domains" role="group" aria-label="Browse sound domains">{PALETTE_DOMAINS.map((entry) => <button type="button" key={entry.id} aria-pressed={domain === entry.id} onClick={() => setDomain(entry.id)}>{entry.label}</button>)}</div>
        {group('type', 'Family', [{ id: 'any', label: 'Any' }, ...FAMILIES.filter((f) => f.domain === domain).map((f) => ({ id: f.id, label: f.id === 'transformation' ? 'Transform' : f.label }))], 'family')}
        {criteria.type === 'any' && eligible.length < families.length ? <p className="labs-catalog-caption">This gesture and harmony narrow the draw to {eligible.map((family) => FAMILY_DEFINITIONS[family].label).join(', ')}.</p> : null}
        {showSubtypes ? <Choices label="Detail" value={criteria.subtype ?? 'auto'} options={[{ id: 'auto', label: 'Auto' }, ...subtypeOptions]} onChange={(subtype) => change({ subtype: subtype as LabSubtype | 'auto' })} disabled={disabled} columns={2} /> : null}
        {criteria.subtype && criteria.subtype !== 'auto' ? <p className="labs-catalog-caption">{SUBTYPES.find((s) => s.id === criteria.subtype)?.description}</p> : criteria.type !== 'any' ? <p className="labs-catalog-caption">{FAMILY_DEFINITIONS[criteria.type].description}</p> : <p className="labs-catalog-caption">{familyValues.length ? `${familyValues.length} selected families. Details are chosen automatically.` : eligible.length < families.length ? 'Remove the chord or choose another gesture to broaden the search.' : 'Any explores every domain. Choose a family to narrow the search.'}</p>}
      </> : section === 'timbre' ? <>
        {group('material', 'Material', MATERIALS, 'material')}{group('character', 'Character', CHARACTERS, 'character')}
        <Choices label="Texture" value={criteria.texture ?? 'auto'} options={labels(LAB_TEXTURES)} onChange={(texture) => change({ texture: texture as LabCriteria['texture'] })} disabled={disabled} />
        <fieldset className="labs-catalog-group" disabled={mode === 'vary'}><legend className="labs-catalog-group__title">Avoid</legend><div className="labs-checks">{LAB_AVOID.map((key) => <label key={key} className="labs-check" data-checked={criteria.avoid.includes(key) || undefined}><input type="checkbox" checked={criteria.avoid.includes(key)} onChange={(event) => change({ avoid: event.target.checked ? [...criteria.avoid, key] : criteria.avoid.filter((id) => id !== key) })} /><span className="labs-check__box"><IconCheck /></span><span>{AVOID_LABELS[key]}</span></label>)}</div></fieldset>
      </> : section === 'behaviour' ? <>
        <Choices label="Gesture" value={criteria.gesture ?? 'auto'} options={gestures.map((g) => ({ ...g, picture: <GestureGlyph gesture={g.id} />, reason: g.minMs > criteria.maxMs ? `Needs at least ${g.minMs} ms. Raise the maximum duration.` : undefined }))} onChange={(gesture) => change({ gesture })} disabled={disabled} columns={2} pictures />
        <Choices label="Movement" value={criteria.motion} options={SDK_MOTIONS.map((motion) => ({ id: motion, label: paletteLabel(motion), picture: <MotionGlyph motion={motion} /> }))} onChange={(motion) => change({ motion })} disabled={disabled} columns={2} pictures />
        <Choices label="Ending" value={criteria.ending ?? 'auto'} options={labels(LAB_ENDINGS)} onChange={(ending) => change({ ending: ending as LabCriteria['ending'] })} disabled={disabled} columns={2} />
      </> : <>
        <Choices label="Register" value={criteria.register ?? 'auto'} options={LAB_REGISTERS.map((value) => ({ id: value, label: REGISTER_LABELS[value] }))} onChange={(register) => change({ register })} disabled={disabled} />
        <fieldset className="labs-catalog-group" disabled={disabled}><legend className="labs-catalog-group__title">Root note</legend>
          <div className="labs-pitch-octave"><label className="labs-chip labs-catalog-chip" data-checked={criteria.rootNote === undefined || undefined}><input type="radio" checked={criteria.rootNote === undefined} name={`${id}-root`} aria-label="Auto root note" onChange={() => change({ rootNote: undefined })} /><span>Auto</span></label><span>Octave {octave}</span><div><Tooltip content="Lower octave"><button type="button" className="icon-btn icon-btn--ghost" disabled={disabled || octave <= 1} aria-label="Lower octave" onClick={() => setOctave(octave - 1)}><Minus /></button></Tooltip><Tooltip content="Higher octave"><button type="button" className="icon-btn icon-btn--ghost" disabled={disabled || octave >= 7} aria-label="Higher octave" onClick={() => setOctave(octave + 1)}><Plus /></button></Tooltip></div></div>
          <div className="labs-pitch-keys" role="radiogroup" aria-label="Root note">{[0, 2, 4, 5, 7, 9, 11, 1, 3, 6, 8, 10].map((semitone) => {
            const note = (octave + 1) * 12 + semitone, accidental = [1, 3, 6, 8, 10].includes(semitone)
            return <label key={semitone} className="labs-pitch-key" data-accidental={accidental || undefined} data-checked={criteria.rootNote === note || undefined} data-unavailable={note > 96 || undefined}><input type="radio" name={`${id}-root`} checked={criteria.rootNote === note} disabled={disabled || note > 96} aria-label={noteLabel(note)} onChange={() => change({ rootNote: note })} /><span>{noteLabel(note).replace(/\d+$/, '')}</span></label>
          })}</div>
          <p className="labs-catalog-caption">{criteria.rootNote === undefined ? 'An exact note replaces the register range.' : `Root: ${noteLabel(criteria.rootNote)}`}</p>
        </fieldset>
        <Choices label="Scale" value={criteria.scale ?? 'auto'} options={labels(['auto', ...LAB_SCALES])} onChange={(scale) => change({ scale: scale === 'auto' ? undefined : scale as LabCriteria['scale'] })} disabled={disabled} columns={2} />
        <Choices label="Chord" value={criteria.chord ?? 'none'} options={LAB_CHORDS.map((chord) => ({ id: chord, label: chord === 'none' ? 'Single note' : chord === 'sus2' ? 'Sus2' : chord === 'sus4' ? 'Sus4' : paletteLabel(chord), reason: chord !== 'none' && !paletteSupportsChord(criteria) ? 'Choose a Music family or tuned percussion.' : undefined }))} onChange={(chord) => change({ chord })} disabled={disabled} columns={2} />
        {hasChord(criteria) ? <Choices label="Voicing" value={criteria.voicing ?? 'auto'} options={labels(LAB_VOICINGS)} onChange={(voicing) => change({ voicing: voicing as LabCriteria['voicing'] })} disabled={disabled} /> : null}
        {!paletteSupportsChord(criteria) ? <p className="labs-catalog-caption">Chords are available for Music families and tuned percussion.</p> : null}
      </>}
    </div>
  </div>
}
