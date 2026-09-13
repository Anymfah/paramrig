# Sound Labs

Labs is the research bench beside Instrument and Sounds. Generating, auditioning, keeping and
combining sounds leave the current Instrument patch in place. **Open in Instrument** transfers a
complete editable patch and its macro rig; Instrument's Undo restores the preceding sound.

## The loop

1. In the **Palette**, choose a search section. Search reaches family names, details, materials
   and characters across the catalog; it does not change any setting until a result is selected.
   - **Source** browses 49 families in seven domains and 78 contextual details. Domain tabs only
     change what is being browsed. **Any** explores the whole catalog. **Multiple** builds a pool
     of alternatives, including families in different domains; each generation draws one family.
     Selected family chips stay visible across domains and can be removed directly.
   - **Timbre** offers all 15 material choices, 13 character choices and 12 textures (including
     their Any/Auto choices). Materials and characters also support multiple alternatives.
     **Avoid** steers away from piercing highs, sub bass, reverb or a sharp attack.
   - **Behaviour** offers the source's gestures, all nine movements, and Auto/Cut/Fade/Ring endings.
     Gestures are drawn as sound contours. An unavailable gesture explains its minimum duration.
   - **Pitch** offers register ranges, exact notes C1–C7, scale, chord and voicing. An exact note
     replaces the register range. Chords require a musical family or tuned percussion. If a source
     change invalidates a detail, gesture or chord, the dependent choice resets with an Undo notice.
     A gesture incompatible with a shortened duration stays selected, with an explanation beside
     the disabled generation action.
2. Above the relief, the four **Next sound** summaries open the corresponding palette section,
   including from a collapsed rail or a narrow screen. **Intensity** and **Density** start on Auto;
   drag their dials, use the arrows, or press Delete/double-click to return to Auto. **Mass** has
   three positions and never transposes the sound. **Duration** accepts two handles or millisecond
   fields, from 20 to 4000 ms; equal endpoints request an exact length.
   **Diversity** chooses Focused, Balanced or Wild. These retain explicit filters. New Explore
   generations use discovery recipes even when the source is a legacy family. Recent recipe
   avoidance compares the complete search intent, including pools, harmony and detail.
3. Press **Generate & play** (or `Enter`, or `G`). One sound is made and heard at once. Pressing again while a
   render is in flight replaces the request rather than queueing it, and there is only ever one
   voice: the new sound stops the old one.
4. Changing a criterion prepares the next sound. The sound on the bench stays there, playable,
   until the next one has arrived. Auto settings leave the corresponding choices to the generator. Presets remain accessible in the rail.

The bench shows the current sound: its name, its length, the relief, and — behind the sliders
button beside the bookmark — its four timbre controls. `Space` plays or stops it, `K` keeps it, `R`
makes it the reference, `Escape` stops the voice and cancels a render. ⌘Z / ⌘⇧Z undo and redo Labs
changes while the workspace is open.

## The relief

The relief comes from the rendered stereo samples: 384 time columns and 128 frequency bands,
from 40 Hz up to 20 kHz (or Nyquist). A centred, elevated perspective gives roughly three quarters
of the visible frequency depth to 50 Hz–1 kHz. The surface, axes and control anchors share the
same projection. The upper and right edges have no enclosing frame.

- Analysis runs in the worker. A short FFT window preserves attacks; a second, longer window
  resolves bass harmonics. Their amplitude-calibrated powers blend gradually between 250 Hz and
  1 kHz. Short-window activity prevents the longer window from filling silent gaps. Both stereo
  channels contribute even when their phases oppose.
- Heights cover 80 dB below the strongest spectral bin, on a squared scale. The axis says
  **dB rel.** because this is spectral balance, not output loudness. **Peak … dBFS** in the header
  reports the rendered sample peak; its tooltip also gives RMS and explains the distinction.
- Fine contours and a translucent skin share the measured surface. Highlights follow real
  curvature; subdued cross-filaments and depth occlusion separate crests from valleys. Silent
  bands remain unlit. A narrow display reduces the number of visible lines, not the measured data.
- The camera stays fixed. Playback lights the part being heard; transitions interpolate between
  measured spectra. Reduced-motion preference removes the shape transition.

### Wave controls

Four separate handles sit inside the front edge of the relief, with names and percentages always
visible. Their hit areas are at least 44 px high. Hover or keyboard focus connects a handle to the
surface and lights its region; the rest of the picture stays clear.

| Control | Highlight on the surface |
| --- | --- |
| **Bite** | The filter's frequency band |
| **Grain** | A band of spectral energy |
| **Space** | A slice towards the tail |
| **Motion** | The moment with the most spectral change |

All four drag vertically with the same sensitivity: 200 CSS pixels for the full range,
independent of perspective or viewport size. Hold `Shift` for quarter-speed fine adjustment.
Double-click a handle, or focus it and press `Enter`, to type a percentage. `Enter` applies it;
`Escape` closes it without changing the sound. Blank and out-of-range entries cannot become zero
silently. Arrow keys adjust by one percentage point, `Shift`/Page keys by ten; Home/End select
zero or one hundred.

A click without a drag leaves the sound untouched. A drag is one undo step, replays when released,
and can be cancelled with `Escape` or pointer cancellation. Pausing the hand auditions the current
value. A kept sound is copied only when editing actually begins. The previous relief and captured
handle stay mounted while the worker measures the updated sound, so editing a reserve entry
cannot interrupt the gesture. The reserve itself stays unchanged.

**Spectrum**, **Waveform** and **Both** choose what the block shows; the choice is remembered per
browser. The front-edge handles appear in Spectrum and Both. The same macros are always available
in the bench's timbre popover. Where WebGL is unavailable or lost, a 2D canvas draws the spectrum.

## History and reserve

The **history** is automatic: the last twenty sounds generated or brought to the bench, newest
first. Click a row, or use the arrow keys, to bring one back; the one you just passed is one
step back. The **reserve** is deliberate: what you chose to keep, up to 24 immutable snapshots
that stay with the project. Rename them there, use one as the reference, fuse two, save them to
Sounds or open them in Instrument. A full reserve asks for a removal; nothing is evicted
silently, and a removal can be undone.

The four timbre controls — Grain, Bite, Motion and Space — have handles on the relief, and the
same four open as sliders from the button on the bench, where their locks hold a control still for
variations. Adjusting a kept sound puts an editable copy on the bench; the reserve entry does not
change.

## Variations

**Use as reference** (or entering Variations with a sound on the bench) establishes a stable
anchor. Adjust its controls, lock the ones that should stay fixed, choose Subtle, Medium or
Strong, then **Vary & play**. Every variation starts from the reference plus those adjustments;
auditioning other sounds does not move the reference, and the previous references stay
reachable from the strip. The duration stays fixed unless **Vary duration** is on.

Imported Instrument sounds retain their macro rig. Up to four compatible numeric timbre macros
are exposed. Pitch, layer amplitude, envelope timing and master gain mappings are excluded from
automatic timbre variation. A stale mapping is anchored to the audible value on its first move in
the child; the original rig remains in the parent snapshot.

## Guided fusion

Choose a principal and a contributor from the reserve, then choose Texture, Attack, Motion or
Resonance and an influence amount, and **Fuse & play**.

- The principal supplies the body and global effects. Its core layers and their
  phase-modulation dependencies are protected.
- A layer contribution is copied with its dependency group. Its modulation paths are remapped
  to the new layer indices. The donor's active performer scene is retained. Optional principal
  layers are retired together so retained layers cannot point at a replaced source.
- Motion contributes compatible timbre modulation into free slots. It does not replace the
  principal's pitch or amplitude modulation.
- The result fits the standard four-layer engine. A dependency group that cannot fit,
  exhausted modulation slots, unknown layer roles or unresolved recorded gestures produce an
  explanation instead of silently dropping required routes.

The original sounds remain in the reserve and the child records both parent snapshots.
Generated recipes declare layer roles during construction. Imported patches with unknown roles
can be explored with macros but cannot be used for guided fusion until their roles are known
through a Labs-generated design.

## Rendering and persistence

The generator uses the existing DSP engine and twelve recipe entry points. Materials and motion
shape those recipes under explicit parameter constraints. Duration fitting scales offsets,
envelopes, modulation timing, recorded gesture timing and effect tails before the final output
fade. Names are drawn from the seed, so the same recipe carries the same name.

Each operation runs in a Web Worker that is kept warm between presses and terminated when a
press replaces a render in flight. Non-finite, silent, excessive-level and severely
phase-cancelled candidates are rejected and explained. Sounds play at their own level, with no
monitor compensation, so the level heard is the level exported. The voice ends in a guard that is
exactly transparent below −1 dBFS and only rounds a peak that would otherwise clip.

The preview cache is limited to eight sounds and 16 MiB. Persisted research state contains
patches, rigs, seeds, criteria, recipe versions, variation/fusion settings, waveform previews and
bounded parent snapshots; the relief is rendered again on demand. Project export includes custom
wavetables referenced only by Labs or by saved parent sounds. Missing assets are reported
explicitly.

Exclusions are sound-design constraints, not a guarantee of a perfectly empty frequency band.
Automated validation covers signal integrity and state consistency. Sound character, useful
variation and perceived quality still need auditioning at a consistent listening level.

## Starting points

Five reproducible sounds are available under **Presets** in the palette and under **Labs** in
Sounds:

| Preset | Design | Duration |
| --- | --- | --- |
| Iron Colossus | Heavy metallic growl with an industrial edge | 1560 ms |
| Servo Cathedral | Accelerating mechanical transformation | 2180 ms |
| Prism Fracture | Glass impact with a pitched core | 780 ms |
| Neural Stutter | Electrical, stuttering digital texture | 1060 ms |
| Titan Splice | Guided contribution from Servo Cathedral into Iron Colossus | 1560 ms |

Their seeds are retained when loaded into Instrument. All five carry editable macro rigs; Titan
Splice also retains its two source snapshots. The same tab lists the project's saved sounds and
brings the Instrument's current patch to the bench.
