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
  (44px) on touch — same pattern as the slider thumb, never a 12px click box
- offer a non-drag alternative (numeric fields, buttons, or a slider)

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
