# Sound Labs discovery SDK

The public headless entry point is `@paramrig/audio-labs`. It extends the audio
engine in `@paramrig/audio`. The application consumes the same implementation;
its palette, spectral visualization and playback interface remain application adapters.
See the [package guide](../packages/audio-labs/README.md) for installation.

## General discovery

Use `DEFAULT_DISCOVERY_CRITERIA` to opt into the general generator. The previous
`DEFAULT_CRITERIA` remains available for callers that need their existing recipes.

```ts
import {
  DEFAULT_DISCOVERY_CRITERIA, createLabBatch, describeLabRecipe,
  labFamilyCatalog, validateLabRequest, type LabCriteria,
} from '@paramrig/audio-labs'

const criteria: LabCriteria = {
  ...DEFAULT_DISCOVERY_CRITERIA, // Any family, material and character
  pool: {
    families: ['water', 'percussion', 'notification', 'pad'],
    materials: ['wood', 'glass', 'liquid'],
    characters: ['acoustic', 'digital', 'ethereal'],
  },
  diversity: 'wild', minMs: 300, maxMs: 1200,
}
const request = { mode: 'create' as const, criteria, seed: 171, count: 1 }
validateLabRequest(request, 48000)
const result = createLabBatch(request, 48000)
if (result.results[0]) {
  const { sound, samples } = result.results[0]
  const resolved = describeLabRecipe(sound.origin.recipe)
}
```

Pools are optional nonempty subsets of concrete IDs. The corresponding scalar
selection must be `any`. Ordering does not affect generation and duplicates do
not add weight. Import preserves display order while intent keys compare sets.
Any-family generation only selects families compatible with the chosen gesture.
Invalid combinations are rejected; stale imported gestures reset to Auto.

### Catalog

The SDK facade's `LAB_TYPES`, `LAB_MATERIALS`, `LAB_CHARACTERS` and `LAB_MOTIONS`
contain the full catalog. The similarly named constants in `model.ts` retain the
compact compatibility lists. Import the SDK facade for the full discovery catalog.

There are 49 concrete families, plus Any:

| Domain | Families |
| --- | --- |
| Effects | Growl, Impact, Transformation, Servo, Glitch, Pulse, Drone, Rise, Fall, Burst, Texture, Explosion |
| Foley | Whoosh, Scrape, Roll, Shake, Crush, Footstep, Engine, Spring, Creak, Tear, Pressure |
| Nature | Wind, Water, Fire, Rain, Ambience |
| Creatures | Creature, Chirp, Breath |
| Interface | Scan, Notification, Confirmation, Error, Alarm |
| Percussion | Kick, Snare, Hi-hat (`hat`), Percussion |
| Music | Bass, Lead, Pad, Pluck, Bell, Keys, Bowed, Wind instrument (`wind-instrument`), Choir |

`labFamilyCatalog()` returns fresh records with IDs, labels, domains, descriptions,
supported constructions and whether a family is pitched. Returned records can be
edited without modifying generation definitions.

Material has 14 concrete choices plus Any: Metal, Glass, Liquid, Air, Electrical,
Wood, Stone, Sand, Ice, Ceramic, Rubber, Fabric, Membrane and Fire. These describe
sonic matter, not a strict physical-material taxonomy.

Character has 12 concrete choices plus Any: Mechanical, Futuristic, Organic,
Alien, Industrial, Acoustic, Analog, Digital, Retro, Ethereal, Corrupted and Clean.
`labMaterialCatalog()` and `labCharacterCatalog()` return their IDs and labels.

Families do not prohibit materials or characters. A digital wood percussion or
organic notification is valid. Material colours a featured voice; character
changes stability, harmonicity, drive, quantisation, unison and spatial treatment.
In discovery, explicit texture uses a secondary voice so an airy bass keeps its
primary body. Every option is connected to synthesis behaviour.

### Subtypes

`subtype?: LabSubtype | 'auto'` targets a construction within a family. It is
independent of material and character: an electric motor can have a wooden body,
and a choir can be digital. `labSubtypeCatalog(family)` returns fresh metadata
with `id`, `family`, `label` and `description`, plus an optional `group` for the
detail collections below. Omit the family or use `any` to list all 78 subtypes.
`LAB_SUBTYPES` exposes their readonly IDs.

| Family | Subtype IDs |
| --- | --- |
| Explosion | `blast`, `detonation`, `muffled-blast` |
| Engine | `combustion`, `turbine`, `electric-motor`, `ignition` |
| Spring | `boing`, `twang`, `coil` |
| Creak | `hinge`, `wood-stress`, `hull-stress` |
| Tear | `paper-rip`, `fabric-rip`, `metal-rip` |
| Pressure | `valve`, `steam`, `suction` |
| Bowed | `bowed-string`, `rubbed-glass`, `abrasive-bow` |
| Wind instrument | `flute`, `reed`, `brass` |
| Choir | `vowel-choir`, `robot-choir`, `whisper-choir` |
| Ambience | `thunder`, `insects` |
| Water | `surf`, `stream` |
| Percussion | `clap`, `cymbal`, `gong`, `tom`, `shaker` |
| Pad / Keys / Pluck | `organ` / `electric-piano` / `harp` |
| Transformation / Burst / Texture / Rise | `portal` / `spell` / `enchantment` / `apparition` |

The following 34 additional subtypes extend those families. Groups are discovery
metadata, not extra top-level families or mutually exclusive synthesis engines.

| Group | Subtypes and parent families |
| --- | --- |
| `electricity` | `electrical-arc`, `electric-discharge` (Burst); `short-circuit` (Glitch); `transformer-hum` (Drone) |
| `transmissions` | `radio-tuning`, `radio-squelch`, `coded-transmission` (Scan); `radio-static` (Texture) |
| `mechanisms` | `ticking` (Pulse); `small-ratchet`, `lock-mechanism` (Servo); `zipper` (Scrape); `switch-click` (Impact) |
| `soft-matter` | `paper-crumple` (Crush); `plastic-rustle` (Shake); `fabric-rustle` (Scrape); `leather-flex` (Creak) |
| `viscous` | `slime`, `mud`, `gurgle`, `bubble-pop` (Water); `suction-pop` (Pressure) |
| `animals` | `purr`, `croak`, `bark` (Creature); `wing-flap` (Whoosh) |
| `tuned-percussion` | `marimba`, `vibraphone`, `handpan` (Percussion); `kalimba` (Pluck) |
| `recording-media` | `vinyl`, `tape-hiss`, `cassette-wobble` (Texture); `digital-dropout` (Glitch) |

Each detail has its own excitation and articulation: discharge decays, radio
opening/closing bursts, contact sequences, friction grains, wet cavity motion,
animal pulses, pitched strikes or recording artefacts. These remain seeded,
editable procedural designs. Radio does not generate intelligible messages;
cassette wobble creates an original modulated tone bed, not an effect applied
to an imported recording. Animal and material names denote stylized synthesis.

```ts
const criteria: LabCriteria = {
  ...DEFAULT_DISCOVERY_CRITERIA,
  type: 'engine', subtype: 'turbine',
  material: 'metal', character: 'acoustic',
  motion: 'accelerating', minMs: 900, maxMs: 2200,
}
```

- An explicit subtype with `type: 'any'` resolves to its own family. A family
  pool must contain that family; incompatible gestures are rejected.
- `subtype: 'auto'` explores the available subtypes and avoids recent ones when
  alternatives exist. A family without subtypes keeps its ordinary construction.
- For compatibility, omitting `subtype` preserves existing discovery-v1 draws
  on the original 40 families. The nine new families always draw a subtype.
  Use explicit Auto to explore the new subtypes of Water, Percussion, etc.
- A family change should clear an incompatible subtype. `sanitizeCriteria`
  performs this recovery for imports; direct generation rejects contradictions.
- Subtypes retain multiple primary constructions, random excitation, resonances
  and accompaniment. They are not fixed presets with a pitch randomizer.

Dedicated identity design precedes material and character treatment. Layer 1
remains available for material/texture; another voice supplies defining details
such as exhaust, breath or fibres. Temporal contours shape pressure tails,
starting engines, settling springs and friction events. An explicit gesture
retains its event timing; intensity, mass, endings and exclusions still apply.
The fantasy subtypes combine existing synthesis techniques rather than adding
an undocumented engine. These are designed acoustic interpretations, not
recordings or calibrated physical simulations.

### Diversity

- `focused`: three core constructions per family, fewer layouts, and typical
  character choices when character is Any.
- `balanced`: all constructions of the selected family and complementary layers.
- `wild`: retains the requested primary family, but permits secondary voices from
  the full construction palette and uses up to four layers.

The ten construction types are subtractive, FM, phase-modulation cascade,
wavetable, vocal/formant, tuned comb, modal resonance, noise, additive partials
and membrane excitation. These use existing DSP primitives; they are not ten
new DSP engines. Layouts include solo with detail, layering, responses, particles,
harmonic stacks, cascades and sustained beds. Additive designs use independent
partial layers. Cascades have real acyclic modulation dependencies.

Structural choices precede continuous parameter variation. Free family searches
draw a domain before a family, so a large domain does not crowd out smaller ones.
Recent recipes avoid the last two primary constructions of a family when possible,
and recent layouts/domains where alternatives exist. There is no global random
state. Identical criteria, seed and ordered recent-recipe context reproduce the
same patch in the same JavaScript runtime. Pool order has no effect; history order does.
Transcendental math can differ in the last floating-point digits across CPU
architectures; regenerated hashes are not portable identifiers. Persist the
returned patch and identity metadata to replay the exact saved values.

`describeLabRecipe()` decodes `discovery-v1` metadata into resolved family,
construction, layout, material, character and gesture. `discovery-v2` adds the
resolved subtype. `discovery-v3` adds an actual chord and voicing, uses the
`chord` layout, and stores `-` when no subtype was resolved. Invalid combinations
or unknown versions return `null`.
The sound's criteria retain the requested Auto/Any/pools; its recipe records
what was actually drawn. Imported patches are never regenerated.

### Musical tuning

`rootNote` is an integer MIDI note from 24 to 96. `scale` accepts `chromatic`,
`major`, `minor` or `pentatonic` (default). For example, use `type: 'bass',
rootNote: 45, scale: 'minor', gesture: 'pluck'` with discovery defaults.
An exact note and a non-Auto register range cannot both be requested. The primary
root is exact without random jitter; intentional sweeps can still move pitch.
Pitched accompaniment and arpeggiated phrases use scale degrees; additive partials
remain harmonics of their root. Chosen materials or characters can contribute
inharmonic partials. Without a root, pitched families
choose a note within their natural range.

### Chords and voicings

```ts
const criteria: LabCriteria = {
  ...DEFAULT_DISCOVERY_CRITERIA,
  type: 'percussion', subtype: 'vibraphone',
  chord: 'minor', voicing: 'open', rootNote: 60,
  material: 'glass', character: 'clean',
  minMs: 1200, maxMs: 1800,
}
```

- `chord`: `none`, `auto`, `major`, `minor`, `sus2`, `sus4`, `dissonant`.
  Omitted or `none` preserves existing single-sound generation.
- `voicing`: `auto`, `close`, `open`. Requires an enabled chord. Omitted means
  Auto when a chord is enabled.
- `labChordCatalog()` returns fresh quality metadata and semitone intervals.
  `chordIntervals(quality, voicing)` returns the three actual note intervals.
  `LAB_CHORDS`, `LAB_VOICINGS` and `supportsChord(family, subtype?)` are public.
- Close triads are major `[0,4,7]`, minor `[0,3,7]`, sus2 `[0,2,7]`, sus4
  `[0,5,7]`, dissonant `[0,1,6]`. Open voicing keeps the root and fifth in place
  and raises the middle note an octave, e.g. C minor becomes C–G–E-flat above.
- All nine Music families support chords, including their subtypes. Percussion
  supports Marimba, Vibraphone and Handpan; omitted/Auto subtype chooses among
  those three. Kalimba belongs to Pluck and also supports chords.
- Any family/pools are filtered to compatible musical candidates. Unsupported
  explicit families/subtypes are rejected. Stale imports drop incompatible
  harmony selections and reset incompatible gestures.
- Auto chooses from all five chord qualities when no scale is specified or the
  scale is Chromatic. Explicit Major/Minor restrict Auto to that quality and
  suspended chords; Pentatonic restricts it to Major/Sus2. An explicit quality
  takes precedence over scale. Recent resolved qualities discourage repetition.
- Three independent pitched voices occupy layers 0, 2 and 3 and retain the
  `body` role. Layer 1 carries material/texture. Density cannot remove a chord
  tone; harmonic FM ratios and bounded detuning protect pitch clarity while the
  texture voice can retain inharmonic colour. The root and intervals remain
  stationary through scenario shaping; supported Strum/Arpeggiate gestures
  sequence the requested notes rather than substituting unrelated scale tones.
- `register: 'full'` keeps its low root, but chord voicing takes precedence over
  the ordinary spread of independent layers across registers.
- Variations preserve all three pitches. Fusion protects their body layers;
  a simultaneous chord shares one contour and leaves slots for a contributor.
  A contribution that needs more layers or modulation slots than remain is
  rejected. It never silently replaces a chord note to make room.
- Chords whose upper voices exceed the render rate's oscillator limit are
  rejected, rather than clamped into incorrect intervals. Use 48 kHz for high
  roots and open voicings. Twenty milliseconds is supported as a short fragment,
  not a guarantee that the whole chord quality is perceptible at that duration.

### Runtime scope

This is procedural synthesis. Foley, nature and creatures are synthesized
interpretations. Intelligible speech, exact recorded instruments, sample import
and sample-granular playback are not provided by this extension.

The current patch engine supports four layers and 20–4000 ms per sound. Ambience
and Pad produce segments within this range. Long-form environments, guaranteed
seamless loops and MIDI note-on/note-off playback are separate capabilities.

Seeds must be unsigned 32-bit integers. Sample rates must be integers from 8000 to
192000 Hz. Batches accept one to four candidates. Invalid requests are rejected
before DSP work: `createLabBatch` returns `{ results: [], issue }`; other strict
functions throw. Rendering is synchronous CPU work and belongs in the existing
worker/runner, which handles cancellation.

Each rendered candidate is checked for finite samples, peak limits, minimum
audible level, mono retention and duration. Rejections have bounded retries and
may produce fewer results with an issue. These checks do not certify realism,
artistic quality or perceptual novelty; those need auditioning.
Quiet discovery designs may receive a common layer-level boost when master gain
alone cannot reach the preview level. This preserves layer balance and PM capture,
stays within editable gain limits, and is stored in the returned patch. Variations
do not receive this boost. Returned samples always correspond to the returned patch.

## Original selection API

```ts
import {
  DEFAULT_CRITERIA, createLabBatch, labGestureOptions, labCriteriaKey,
  sanitizeCriteria, validateLabCriteria, type LabCriteria,
} from '@paramrig/audio-labs'

const criteria: LabCriteria = {
  ...DEFAULT_CRITERIA,
  type: 'transformation', material: 'metal', character: 'mechanical',
  gesture: 'assemble-lock', register: 'low', texture: 'friction',
  intensity: 0.65, density: 0.75, mass: 'heavy', ending: 'cut',
  minMs: 700, maxMs: 1200,
}
validateLabCriteria(criteria)
const gestures = labGestureOptions(criteria.type)
const intent = labCriteriaKey(criteria)
// CPU work: call in the existing Labs worker, not on the browser's main thread.
const batch = createLabBatch({ mode: 'create', criteria, seed: 171, count: 1 }, 48000)
// batch.results contains the actual stereo samples and the measured visualisation.
// A nonempty issue describes an unsupported request or an unsuccessful audio check.
```

## Selections

| Field | Values | Meaning |
| --- | --- | --- |
| `gesture` | `auto` or an ID from `labGestureOptions(type)` | Macro event structure: assembling and locking, charging and hitting, rebounds, etc. |
| `register` | `auto`, `low`, `mid`, `high`, `full` | Pitch and spectral anchors; `full` distributes voices across registers. |
| `texture` | `auto`, `vocal`, `buzz`, `friction`, `crackle`, `resonant`, `pure`, `airy`, `gritty`, `hollow`, `shimmer`, `rasp` | A featured texture voice, retaining the rest of the recipe's source graph. |
| `intensity` | `null` for Auto, or 0–1 | Gentle to aggressive attack, harmonic drive and timbral motion. Does not increase master gain. |
| `density` | `null` for Auto, or 0–1 | Sparse to dense events, detail balance and modulation activity. |
| `ending` | `auto`, `cut`, `fade`, `ring` | Short clean cutoff, progressive fade, or resonant decay. The entire tail is inside the requested duration. |
| `mass` | `light`, `balanced`, `heavy`, or omitted | Body/detail balance and persistence, independent of musical pitch. |
| `chord` | `none`, `auto`, `major`, `minor`, `sus2`, `sus4`, `dissonant` | Three musical notes, with a separate voice for material and texture. |
| `voicing` | `auto`, `close`, `open` | Compact or spread chord intervals, preserving the root. Requires a chord. |

These gesture, register, texture, ending and amount fields are optional. Missing
categorical fields equal `auto`; missing intensity/density equal `null`. Zero is
an explicit choice, never Auto. For legacy inputs without discovery selections
(diversity, subtype, pools or tuning), automatic gesture controls and no explicit
mass preserve the previous v3 recipes, including their random draw sequence.
Curated signature demos continue using their frozen generation path.

`weight` remains required for old callers and saved documents. When neither mass
nor register is selected, it retains its old pitch-weighting behaviour. New UI
controls should set `mass` explicitly (including `balanced`) and keep `weight`
at `balanced`. Explicit register also separates weight from transposition.

## Family and duration compatibility

`labGestureOptions(type)` returns fresh `{ id, label, minMs }` records. It covers
all 49 families, with 34 concrete gestures and Auto. New gestures include Rub,
Roll, Shake, Breathe, Flutter, Drip, Rattle, Strum, Pluck, Arpeggiate and Crumble.
Movement also includes Decelerating, Irregular and Alternating.
Disable choices whose minimum duration exceeds `maxMs` and
show the reason. On a family change, `sanitizeCriteria` can reset an incompatible
old gesture to Auto. Do not silently replace an explicitly requested gesture at
the generation boundary: `validateLabCriteria` and generation reject it.

Durations use whole milliseconds, 20–4000. When only the lower bound is below a
gesture's useful minimum, generation samples between that minimum and `maxMs`;
the user's stored range remains unchanged. An unsupported entire range is an
error. Auto retains the existing short-click path.

An explicit Gesture owns the large event structure, including layer timing.
Movement changes event spacing inside repetitive gestures without multiplying
them by a second pulse train. Single hits and charge/impact landmarks retain
their timing; subtype articulation cannot overwrite their amplitude contour.
With Gesture on Auto, a selected Movement owns the temporal contour: Accelerating
shortens event intervals, Decelerating lengthens them, Pulsed keeps regular
spacing, and Collapsing decays and darkens continuously. Continuous retains a
sustained body; Stuttering clusters events, Irregular varies their spacing, and
Alternating exchanges layer activity across the stereo field. Chords retain
their simultaneous notes and move their filters together.

Density adjusts event count/activity within that structure rather than inventing
a new phrase on Auto/Natural. Layer offsets and slow gain modulation cannot
reintroduce an unrelated rhythm after movement selection. Resonator excitation
is compensated after duration fitting when movement sustains an originally
percussive source. Saved patches are replayed as stored, without regeneration.
Intensity changes timbre
and attack, not output volume. Existing exclusions have final precedence over
texture and ending; for example, resonant decay uses a short feedback delay
when reverb is excluded. Exclusions can constrain the strength of a requested
texture. These controls are synthesis directions, not guarantees that every
listener will assign the same perceptual label to every result.

## Persistence, variation and history

`sanitizeCriteria`, `sanitizeLabSound` and `sanitizeLabSession` preserve the new
fields through project, history, reserve, reference and snapshot round trips.
Storage remains additive version 1; imported patches are not regenerated.
Malformed stored amounts are clamped or reset to Auto. The strict request API
instead reports invalid values.

Variations and fusion use the reference/principal's new search selections.
Changing them in those modes is rejected instead of relabelling an unchanged
body. Generate a new reference to change the intent. Existing macro locks,
variation strength and duration-variation semantics remain in effect.

The Labs UI builds variation/fusion requests from the selected reference's intent,
with the visible duration range and allowed exclusions. The last Explore search
does not leak into these requests. `fusionCompatibility` runs the same layer and
modulation allocation as fusion, so missing contributions and capacity limits can
be shown before rendering. The planner tries alternative compatible groups,
retains PM dependencies, and shares identical modulation drivers when possible.
Attack can extract a short onset from a body-only contributor.

On reload, role validation checks the stored patch before normalization adds
defaults or changes property order. Known legacy Labs sounds with lost roles are
classified from their saved layers without regenerating audio. Actual snapshot
edits carry `rolesInvalidated` through subsequent reloads; imported instruments
remain unclassified.

When wiring the UI, filter recent generation metadata using `labCriteriaKey`.
It includes all new selections, duration and exclusions, unlike the earlier
six-field comparison. Pass the matched `recentRecipes` to the existing worker;
engine avoidance remains active under selected intent. Identical criteria,
seed and recent-recipe context reproduce the same patch within the same runtime.

## UI integration still to do

- Bind new controls to these fields and use the catalog's IDs, not display labels.
- Use the complete intent key when collecting recent recipes.
- Keep the criteria for the next generation separate from current-sound edits.
- Verify real interaction and auditioning once the UI is ready.

The proposed Shape view's length/stereo/level manipulation is a separate
current-sound editing contract. This SDK addition does not implement those
Three.js gestures or their playback behaviour.

## Verification

- 122 SDK/audio/project/UI tests pass across seventeen suites, covering legacy
  fingerprints, rendering, gesture compatibility, macros, protected references,
  persistence, project storage, subtype diversity and musical harmony.
- All 735 family/material pairs render without first-pass rejection at 16 kHz,
  with crossed character, gesture, texture, movement and ending settings.
- All 49 families cross all nine movements (441 renders), and all 78 subtypes
  cross Accelerating and Collapsing (156 renders), without first-pass rejection.
  Known synthetic pulses calibrate the audio onset probe before it checks
  accelerating/decelerating intervals, regular pulses and continuous decays at
  minimum, medium, maximum and automatic density. Explicit event landmarks,
  subtype contour precedence and saved/varied timing are checked separately.
- All five chord qualities cross all nine movements (45 renders), including
  preservation of continuous filter movement and collapse darkening on every note.
- All 49 families pass at 20 ms and 4000 ms with all exclusions enabled.
- All 78 subtypes pass four crossed seed/material/character/control scenarios
  (312 renders), plus one duration endpoint each with all exclusions enabled.
- Every family produces at least three primary constructions and ten distinct
  source graphs in 24 history-aware draws. Subtype audio differences are checked
  with a fixed root and pitch travel removed, using gain-invariant spectral and
  temporal probes calibrated on known tones.
- The eight new detail groups remain distinct under that fixed-pitch probe;
  each of their 34 subtypes produces at least three distinct source graphs in
  sixteen draws with pitch and material fixed.
- All five chord qualities and both voicings render across nine Music families
  and three tuned percussion subtypes (120 crossed cases), plus both duration
  endpoints with all exclusions (24 cases). A calibrated spectral test measures
  the contribution of all three notes in generated chord audio. MIDI roots
  24, 60 and 96 retain exact intervals under the requested controls.
- Nine new-family representatives replay saved patches sample-for-sample at
  48 kHz. A separate Vite SSR smoke run confirms operation without browser globals
  and writes optional local WAV/patch examples to `.local/sdk-subtypes-audio/`.
- Thirteen further SSR examples (one per new detail group and five chords)
  also replay sample-for-sample at 48 kHz. Their local WAVs, saved sounds and
  report are in `.local/sdk-details-harmony-audio/`.
- Fusion keeps the principal subtype and pitch; incompatible search changes are
  rejected. Variations keep their reference's subtype and exact musical root.
- TypeScript and targeted ESLint pass. UI interaction and listening acceptance
  remain separate: these tests do not certify physical realism or artistic quality.
