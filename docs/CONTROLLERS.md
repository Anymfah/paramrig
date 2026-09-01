# Controller contracts

The catalog at `/docs/controls` contains 62 interactive examples across ten
families. `/r/controller-lab` opens the same manifest in the full workspace.
Both use `src/ui/ParameterField.tsx`; catalog controls are not separate demos.
Individual examples expose their current JSON value and complete declaration
from the code icon in the card header, which opens a full-height inspector.

## Available instruments

| Family | Instruments |
| --- | --- |
| Numbers | Exact field with convertible display units, stepper, slider, bipolar/logarithmic/discrete scales, knob, angle, minimum/maximum range, seed |
| Position & dimensions | Vectors 2D/3D, XY pad, dimensions with proportional lock, directions 2D/3D, rotation, anchor presets, transform |
| Color & appearance | RGB/HSL and hexadecimal color, alpha, palette, gradient stops, opacity ramp, gradient geometry, HDR color plus intensity, visual material choice, shadow |
| Choices | Switch, tri-state choice, segmented choices, dropdown, searchable options, multiple selection, object reference |
| Text & typography | Single/multiline text, font choice, typography group, variable font axes |
| Curves & profiles | Cubic Bézier, ordered ramp/falloff profile, editable 2D path, overlapping radial profiles |
| Resources | Previewable image/texture/SVG, binary font/model/environment asset, parameter preset |
| Actions | Apply values, trigger counter, restricted randomization (including seeds), reset selected parameters |
| Collections | Value list, repeatable layers, linked box values and stroke |
| Value sources & animation | Duration/playhead, local, parameter, expression, timeline, macro, modulation and blend value sources |

These are instruments and combinations, not 60 unrelated storage formats.
The primitive and composite types live in `src/rigs/types.ts` and
`src/rigs/extended-types.ts`. Declarations live in `src/rigs/controller-catalog.ts`.

## Values and composition

- Every parameter has a stable `id`, `label`, `group` and `defaultValue`.
- Numbers can declare `view`, `scale`, `stops`, units and display bounds.
  Logarithmic scales require positive bounds; discrete stops should be sorted
  and inside the numeric bounds.
- Convertible display units declare a positive conversion factor from their
  displayed unit to the manifest's base unit. Sessions, drafts, snapshots and
  exported values always keep the normalized base number.
- A vector is an array with one number per declared axis; a range is an ordered
  pair. Spatial pads edit both coordinates in a single history transaction.
- Colors use `#RRGGBB` or `#RRGGBBAA`. HDR is a color/intensity composite, not a
  claim that the browser color picker displays HDR gamut.
- Multipoint profiles use `{ x, y }[]`. Profile positions stay ordered; path
  points preserve their explicit order. These profiles use straight segments.
  Use the separate cubic Bézier control for Bézier handles.
- A radial profile stores an array of layers `{ name, color, enabled, points }`.
  X is radius (0–1), Y is value (0–1). Overlapping layers share one graph; the
  curve between points uses the same tangent-based Bézier as Helios Ray.
  Optional `zones` are display-only radius bands. Sample a layer with
  `sampleRadialAt` from `src/ui/radial-curve.ts`.
- Groups store an object keyed by child ID. Lists store an array of values
  described by their `item` definition; entries can be added, removed or moved.
  Declare actions and presets at the top level. Value sources belong to their
  top-level numeric parameter. Nested groups/lists are intended for value fields.
- Object references and font choices resolve against options supplied by the
  rig. They do not discover scene objects or installed system fonts.

`normalizeValue` validates saved drafts and all session edits, including nested
groups and lists. Unsupported options, malformed shapes and non-finite numbers
fall back to defaults; bounded numeric data is clamped.

## History and keyboard

Use `session.setValue(id, next)` for edits. Pointer controls wrap a complete
gesture in `beginGesture` / `endGesture`; Escape, cancellation, lost capture,
window blur or unmount cancel the active gesture. Text commits on blur/Enter
(Cmd/Ctrl+Enter for multiline); Escape discards its draft. Composition through
an input method does not commit prematurely.

Pads, points, dials, sliders and ranges expose keyboard alternatives and exact
number fields. Radio choices support arrow navigation; lists expose move
buttons. Grab handles keep a small visible glyph with 32px targets, or 44px
with a coarse pointer.

Draft values and snapshots persist locally. Undo history lasts for the current
session; it is not restored after a page reload. Catalog data is isolated from
the full lab and from existing rigs.

## Drivers and actions

Every top-level numeric parameter owns one persistent `ValueSource`, stored in
drafts, snapshots and exports. Its mode is `local`, `parameter`, `expression`,
`animation`, `macro`, `modulation` or `blend`; changing modes replaces the
previous source instead of stacking drivers. Parameter and macro sources read
another editable number; macro maps that input into a declared output range.
Expression sources support parameter names, `t`, `pi`, arithmetic and a small
allowlist of math functions; they never run JavaScript. Modulation samples time
without rewriting the local value. Noise is seeded; envelopes have attack, hold
and release phases. Blend interpolates numeric endpoints from either a fixed
amount or another numeric parameter.

Actions can set declared values, randomize explicitly allowed numeric targets,
reset selected parameters or increment a trigger counter. A rig renderer can
observe the counter to implement its own impulse. Presets and actions form a
single undo transaction.

Invalid sources and circular references leave the stored target value usable and
report an error on that parameter's value-source control.

## Animation

Duration and playhead roles control the actual session. Duration changes scale
key times and the playback range; they are undoable and persist in drafts and
snapshots. Scrubbing/playing does not fill history. Duration/playhead and
read-only outputs cannot acquire manual tracks.

The timeline curve editor edits the selected track (the first track when no key
is selected), including adding/removing points. Its line samples actual easing.
Right-click keys in track mode to change easing or use the parameter's own
numeric instrument. The resizable panel applies to both timeline views.

Tracks currently animate **top-level numeric values**. Composite/vector/color
fields are editable, saved, exported and undoable but do not yet acquire
per-component animation tracks. Generic profile controls do not automatically
become timeline easing; the rig decides how to consume their data.

## Local files and exports

## Scene instruments

Controller Lab includes isolated visual instruments for 2D and 3D transforms,
texture framing, and camera orbit. Their values are normalized before storage:
positions are bounded, transform scale cannot reach zero, texture frames retain
a minimum visible area, and camera distance and field of view remain usable.
Handles use the shared 32px target (44px on coarse pointers); the visible
marker remains smaller. Every drag is one undoable gesture.

The 3D transform instrument renders a local Three.js mesh with transform
handles for translation, rotation, and scale. Its preview orbit control is
disabled while a handle is active, so it cannot compete with object editing.

These composite values are persistent and exportable. A rig that needs
animation for an individual transform or camera channel should expose that
channel as a top-level numeric parameter.

File controls validate accepted MIME types/extensions and size before writing
blobs into IndexedDB (25 MB per file by default). Image/texture/SVG controls
preview the file; other controls expose its name and a download. Missing blobs
and storage failures are surfaced in the field. Removed blobs are retained so
undo and snapshots can restore their references.

JSON exports contain file metadata and a local resource ID, **not embedded
binary files**. Files are not portable across browsers/devices through JSON
alone. A renderer can call `loadResource(id)` to consume a blob; selection does
not automatically install fonts, import models or change a 3D environment.
External dependencies referenced by a `.gltf` file are not bundled.

The composition preview demonstrates amount, angle, XY position, ink, material
shape and title, plus the 2D transform, texture frame and camera values from
the scene instruments. Rig authors connect the same serialized values to their
own renderer.
