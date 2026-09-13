# Adding a rig

ParamRig loads example rigs from a local registry, not from a live disk scan.
The `.rig.tsx` filename in the library is a convention for agents, not an API
that this build implements.

## 1. Describe the rig

Add a module under `src/rigs/examples/` that exports a `RigManifest`:

- `id` is the URL slug and the export `rigId`
- `title` is the sidebar path, Storybook-style (`Examples/SVG`). Each `/` segment is a foldable folder; `name` is the leaf
- `parameters` list the controls; `id` is the JSON key
- optional `animation.tracks` drive numeric parameters over time

Register it in `src/rigs/registry.ts`.

## 2. Render from values

Add a preview that receives `values` only. Register the component in
`src/workspace/RigPreview.tsx` (`PREVIEWS` for SVG/HTML, lazy import for Three.js).
Do not add `if (rig.name === …)` branches in the shell. Three.js previews must be
lazy-loaded so other rigs survive a WebGL failure.

## 3. Custom controls

Inspector standard fields use the shared `ParameterField` renderer. They cover
numeric variants, color/alpha/channels, curves, radial profiles, gradients, vectors, ranges,
choices, text, resources, lists and composites, plus actions and per-number
value sources.
Live examples with their complete manifests are on `/docs/controls`;
[`CONTROLLERS.md`](CONTROLLERS.md) describes the value contracts. A custom control should:

- read the current value from the session snapshot
- call `session.setValue(id, next)`
- wrap a pointer drag with `beginGesture()` / `endGesture()` so undo records
  one step
- give every grab handle a hit helper of `--hit-target` (32px), `--hit-target-coarse`
  (44px) on touch — the gauge field takes the whole box, never a 12px click box
- offer a non-drag alternative (numeric fields, buttons, or arrow keys)

Do not add `if (rig.name === …)` branches in the shell. Keep renderer and
control choices on the rig module.

## 4. Animation and undo

Numeric parameters can be animated from their actions menu, even when the
manifest has no predefined tracks. SVG/HTML previews receive current values
on playback ticks; Three.js previews can sample `session.previewNumber()`
inside their render loop.

Tracks use `paramId`, `interpolation` (`linear` or `step`), and `keyframes`.
Each key has `time` in seconds and a numeric `value`. Optional per-key
`easing` controls the outgoing segment: `linear`, `ease-in`, `ease-out`,
`ease-in-out`, or `step`. Stable key IDs are assigned when absent; preserve
them when updating keys. Exported animation and saved drafts can include an
optional `loopRange` containing `{ start, end }`; without it, playback uses
the entire timeline.

Use the session's keyframe operations rather than replacing arrays in UI
components. A drag should call `beginGesture('Action label')`, apply updates,
then `endGesture()` once. Escape, pointer cancellation and unmount during a
drag must call `cancelGesture()`. Playback and scrubbing do not enter history.
Snapshot capture, rename, restore, removal, and loop settings do enter history.
Snapshot restore also restores its reference; undo restores the previous one.

## Scene documents

A scene is the second kind of document the workbench stores itself, next to a vector document.
`createSceneDocument()` writes one under `paramrig.scene-documents.v1` and `sceneManifest(document)`
presents it to the rest of the app as a `RigManifest` with `renderer: 'scene'`, so it appears in the
library and in the navigation beside the example rigs with no registry entry to write.

- **New scene** in the library titlebar makes one — a cube, a point light and a camera, the way
  Blender opens — and navigates to `/r/<id>`.
- `/r/<id>` opens the 3D editor while the scene carries no controls, or while it was last left on
  Edit; once it exposes controls, Tune shows it as a rig like any other. The choice is remembered
  per document in `paramrig.scene-inspector.v1`.
- A scene saved to disk is a `.paramrig.json` file marked `"format": "paramrig.scene"`. The library
  accepts one dropped on it, and refuses a vector document by name rather than failing obscurely.
- The mesh a person edits is not a soup of triangles: `MeshData` keeps polygons with stable vertex
  and face ids, so a selection survives an edit that renumbers everything. `src/scene/types.ts` is
  the contract, `sanitizeSceneDocument` is what enforces it on the way in.

## Audio documents

A sound is the third kind of document the workbench stores itself. `createAudioDocument()` writes
one under `paramrig.audio-documents.v1` and `audioManifest(document)` presents it as a
`RigManifest` with `renderer: 'audio'`, so it appears in the library beside the others with no
registry entry to write.

- **New sound** in the library titlebar makes one — a short blip, audible immediately — and
  navigates to `/r/<id>`.
- The engine is a pure function: `renderPatch(patch, sampleRate)` takes a patch and a rate and
  returns two channels. There is no Web Audio in it and no clock, so it runs under Node — which is
  what `scripts/audio-preview.mjs` and `scripts/audio-bench.mjs` use, and why the tests need no
  browser. Playback, the waveform view and the exported file are all consumers of that one buffer,
  so what you hear while tuning and what lands in the file cannot drift apart.
- `src/audio/fields.ts` is the single table four things agree on: the property parser, the
  generated documentation at `/docs/audio-rigs`, the control built when a field is exposed, and the
  clamp applied to a patch read back off disk. A field added there is a documented, bindable,
  bounded field on the same commit. It imports nothing but types and relative `.ts` paths, which is
  what keeps the Node scripts working without a build step.
- A patch carries the `version` it was written in, and `sanitizeAudioPatch` walks it forward
  through `MIGRATIONS`. A rename that moved a field also names its old path in
  `carryAudioProperty`, or the rig of every sound anybody built loses that binding in silence.
- The slots — a modulation slot, an insert slot, a master effect slot — are flat records carrying
  `kind` plus the fields of every kind they could be. The engine reads only the active kind's,
  which is what makes a slot changed to another kind and back the slot it was.
- A sound saved to disk is a `.paramrig.json` file marked `"format": "paramrig.audio"`.
