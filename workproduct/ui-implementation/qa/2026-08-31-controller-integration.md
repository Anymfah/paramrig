# Controller integration QA — 2026-08-31

## Scope

60 focused controller examples, ten families, shared `ParameterField`, local resources,
composite state, safe drivers, presets/actions, timeline curve editor and the
full Controller lab. Existing ParamRig visual tokens and shell are retained.

## Automated verification

Docker Compose one-off: `npm test && npm run lint && npm run build`.
The final consolidated run passes 105 tests across 20 files. The detailed
consolidation decisions are recorded in
`2026-08-31-controller-dedup-audit.md`. ESLint and TypeScript/Vite build pass.
The build retains Vite's chunk-size warning (main approximately 516 kB and
lazy Three.js approximately 887 kB, before gzip); this is not a measured
performance score.

Meaningful new coverage includes:

- All catalog defaults survive validation and draft serialization.
- Malformed vectors, ranges, gradients and resource references are rejected.
- Composite gesture commit/cancel, redo retention, list order and snapshots.
- Expressions reject executable syntax, non-finite results and circular links.
- Deterministic noise, time-driven values, macros, presets and restricted actions.
- Duration scaling, undo and draft restoration.
- Rendering every declared instrument through the shared component.
- XY/range/discrete/logarithmic keyboard controls, searchable radio focus,
  text draft cancellation and list undo.
- Timeline graph edits actual keys; add/remove and undo restore their identity.

## Real in-app browser checks

Local routes at port 5174, desktop viewport 1280 × 720:

- Catalog family/search navigation and rendered custom controls.
- XY keyboard change from `[0,0]` to `[0.01,0]`, undo to `[0,0]`.
- Actual XY pointer drag to approximately `[0.20,0.47]`; a single undo restores
  both coordinates. The point target is 32px around its smaller glyph.
- Discrete slider ArrowRight advances from 4 to 8, then undo restores 4.
- Searchable radio arrow navigation moves both selection and focus; multiselect
  toggles and undo restores it.
- Text commit persists after reload, including its composition preview; test
  content was reset afterward.
- RGBA opacity change serializes to `#b8c5b280`; undo restores the prior alpha.
- List move serializes `[50,25,75]`, then undo restores the initial order.
- Bold preset changes size, color and angle together; one undo restores them.
- Playback changes time, modulation and expression outputs. Pause/rewind work.
- Curve editor changes the real final key from 360 to 356.4; undo restores it.
- Timeline expands in curve mode. Right-clicking an angle key opens its custom
  dial, exact field and easing actions.
- Full Controller lab opens all families in the inspector. Changing the number
  slider creates one visible History entry; Undo restores it.
- Existing Tidal planet loads its WebGL scene, gradient, inspector and tracks.
  Its parameter values were not changed during this pass.

## Limits of verification

The browser tool exposed neither viewport emulation nor file-upload support.
This pass did not repeat mobile/coarse-pointer QA or upload a real file through
the OS chooser. Resource MIME/extension validation and reference serialization
have automated coverage; IndexedDB blob persistence and native file picking
still need an end-to-end manual check. The file selector, limits and local-only
export explanation were inspected in the browser.

JSON file references are intentionally local, not portable asset bundles.
Per-component vector/color animation, model loading into the scene and automatic
font installation are not implemented by the generic controller layer; see
`docs/CONTROLLERS.md` for the supported contracts.

No commit, push or deployment was performed.
