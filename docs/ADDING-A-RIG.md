# Adding a rig

ParamRig loads example rigs from a local registry, not from a live disk scan.
The `.rig.tsx` filename in the library is a convention for agents, not an API
that this build implements.

## 1. Describe the rig

Add a module under `src/rigs/examples/` that exports a `RigManifest`:

- `id` is the URL slug and the export `rigId`
- `parameters` list the controls; `id` is the JSON key
- optional `animation.tracks` drive numeric parameters over time

Register it in `src/rigs/registry.ts`.

## 2. Render from values

Add a preview that receives `values` only. Register the component in
`src/workspace/RigPreview.tsx` (`PREVIEWS` for SVG/HTML, lazy import for Three.js).
Do not add `if (rig.name === …)` branches in the shell. Three.js previews must be
lazy-loaded so other rigs survive a WebGL failure.

## 3. Custom controls

Inspector standard fields cover number, color, curve, switch, select and
gradient. A custom control should:

- read the current value from the session snapshot
- call `session.setValue(id, next)`
- wrap a pointer drag with `beginGesture()` / `endGesture()` so undo records
  one step
- offer a non-drag alternative (numeric fields, buttons, or a slider)

Do not add `if (rig.name === …)` branches in the shell. Keep renderer and
control choices on the rig module.
