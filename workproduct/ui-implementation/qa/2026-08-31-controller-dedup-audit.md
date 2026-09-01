# Controller consolidation audit — 2026-08-31

## Decision rule

Keep an example only when it introduces a distinct interaction, value contract
or essential ParamRig behavior. Different nouns on the same unchanged widget do
not justify separate cards. Internal driver targets stay in the manifest but do
not appear as editable controllers.

## Consolidation

The public catalog now contains 60 examples instead of 77.

- Numeric ramp, distance falloff and speed profile became one ordered
  **Ramp / falloff profile**. Cubic Bézier and free 2D path remain separate
  because their gestures and constraints differ.
- Six file-extension cards became two behaviors: a previewable
  **Image / texture / SVG** resource and a binary
  **Font / model / environment** resource. Exact accepted formats remain in
  each manifest and visible in the drop zone.
- Standalone font choice was removed because the Typography composite already
  contains it. Variable axes stay separate because they are a distinct
  multi-axis instrument.
- Blend mode was removed from Appearance because it was identical to the
  standard dropdown. Effect stack and corner radii were removed because the
  repeatable composite list and linked four-value control already demonstrate
  those interactions.
- Regenerate was removed because restricted Randomize already covers the same
  action contract, including seed targets.
- The dedicated remap expression was removed; the safe Expression controller
  already resolves parameters and time. Its help and live output make that
  capability explicit.
- Linked, macro and blend target values remain in session/export data, but are
  hidden from the catalog and Inspector. Their live result now appears beside
  the modulation, expression, macro or blend controller that owns it.

## Bugs and density corrections

- Read-only driven outputs now reject imperative `setValue` calls as well as
  having no editable UI.
- Restoring an older snapshot removes parameters that no longer exist in the
  manifest instead of reintroducing stale export keys.
- Nested groups and lists now propagate actions, presets and numeric resolvers
  to their shared `ParameterField` children.
- Material, font and short multiple-choice controls no longer add a redundant
  search input. Search remains for explicitly searchable/object-reference lists.
- Segmented choices use a full-width second row, preventing short labels such
  as “Calm” from being ellipsized in a wide card.
- Shadow, Stroke and HDR use compact embedded color fields; the standalone
  color examples retain the full RGB/HSL channel editor.
- File-format labels are human-readable and deduplicated.
- Controller lab opens Numbers only. The nine other families start collapsed,
  which keeps the full workspace practical while retaining one-click access.
- Action examples state their effect, so four similar buttons communicate four
  different transactions instead of looking like duplicates.

## Verification

- Final Docker run: 105 tests across 20 files, ESLint with zero warnings, and
  TypeScript/Vite production build all pass.
- Declaration audit covers all definitions: unique IDs/options, numeric bounds,
  logarithmic constraints, ordered stops, vector arity, nested child IDs,
  resource formats, action/preset/driver targets and blend pairs.
- All defaults normalize; every declared instrument renders through the shared
  renderer. Read-only rejection, old-snapshot cleanup, gestures, keyboard,
  history, drivers, lists, resources and the timeline have targeted tests.
- Live browser audit covered all ten families in dark mode, the full Controller
  lab, and a light-mode pass. The 60-card view has no empty cards or horizontal
  overflow at 1280 × 720.
- Slider/pad/point handles are at least 32px. Bézier visible glyphs remain 16px
  while their measured interactive rectangles are 50 × 50px in the audited
  desktop rendering.

Native file selection and mobile/coarse-pointer behavior could not be exercised
by the available browser capability in this pass. File acceptance rules have
automated coverage; the CSS retains 44px coarse-pointer targets.
