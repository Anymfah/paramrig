# ParamRig — UI implementation brief for Cursor

Act as a senior product designer and frontend engineer. Implement ParamRig's
first complete, interactive frontend in the existing local repository:

`/Users/soheil/Documents/repos/paramrig`

The quality target is premium, AAA-level creative software: deliberate,
consistent, responsive, predictable and exceptionally well finished. Treat those
words as requirements to prove through interaction and visual review, not as
permission to add decoration or claim perfection.

## 1. Mandatory first steps

1. Read the repository's `AGENTS.md` and inspect Git status. Preserve all existing
   work, including untracked mockups. Do not clean, reset or replace the repo.
2. **Use the `frontend-design` skill.** Read the entire file at
   `/Users/soheil/.codex/skills/frontend-design/SKILL.md` before UI work. Cursor
   can read this local file even if it does not expose a skill invocation UI.
   Read the relevant Markdown references from its routing table as you reach
   each implementation phase; do not substitute a summary of the skill.
3. For this task, consult at least `ux-principles.md`, `register-and-brand.md`,
   `visual-language.md`, `spacing-and-rhythm.md`, `component-api.md`,
   `controls.md`, `navigation-and-ia.md`, `responsive.md`, `accessibility.md`,
   `motion.md`, `craft-details.md`, and `performance.md` in that skill's
   `references/` directory. This brief is not a replacement for those files.
4. If the skill or visual references cannot be accessed, report the exact
   missing path and ask for it. Do not pretend you used or inspected them.
5. Inspect the existing stack. At brief creation, the repo contains brand work
   and mockups, not an application or package manifest. Verify this rather than
   assuming it is still true. Reuse any architecture already added by the owner.
   If still empty, select a minimal TypeScript frontend setup with a local dev
   server and HMR. Briefly justify the choice; avoid an unnecessary backend or
   large monorepo scaffold. Check official documentation for chosen packages.
6. State the message, primary action and exclusions before the first UI edit,
   following the applicable workspace rules. Work in the phases below and keep
   the owner informed. Ask only when a material unresolved choice blocks you.

## 2. Understand the actual product

ParamRig is an open-source, local-first workbench for fine-tuning visual work
created with coding agents. Its principle is:

**AI builds the tools. The human shapes the result.**

The agent creates arbitrary HTML/components, SVG, shaders, scenes, controls and
bindings around a creative task. The human adjusts the result, then hands a
precise configuration back to the agent for integration into their project.

This is not a chatbot, a fixed preset catalogue, a page builder, or exclusively
a 3D editor. It can support design systems, logos, materials, animation, 3D,
procedural worlds and POCs. The examples prove the workflow; they must never
define the limits of the architecture.

Power must not require a complicated interface. A first-time user should find
the next action without learning a panel of unexplained icons. Experienced
users should retain direct numeric entry, keyboard control and precise tools.
Use progressive disclosure, not arbitrary restrictions on creative capability.

## 3. Visual source of truth

Open and visually inspect these local files, not just their filenames:

- `assets/ui-mockups/01-library.png`
- `assets/ui-mockups/02-svg-editor.png`
- `assets/ui-mockups/03-3d-editor.png`
- `assets/ui-mockups/README.md`
- `workproduct/ui-mockups/design-notes.md`
- `assets/brand/branding-board/paramrig-branding-board.png`

They are design references, not screenshots of an implemented product. Preserve
their visual direction while resolving actual interaction and responsive needs.
Do not rasterize the application into one large image or absolutely position
the whole screen to match a single viewport. Render interface text as real text.

Use the canonical brand geometry unchanged:

- `assets/brand/paramrig-coform-symbol.svg`
- `assets/brand/paramrig-wordmark.svg`
- `assets/brand/paramrig-coform-logo.svg`

Use Public Sans for supporting text, including parameters with tabular numerals.
The existing font and license are under
`workproduct/brand-identity/paramrig/branding-board/fonts/`.
Self-host the production font, preferably WOFF2, retaining the license notice.
The logo lettering is custom vector geometry, not text to recreate with a font.

Palette: Carbon `#1C201C`, Chalk `#F4F3EB`, Stone `#C8CCC0`, with derived semantic
surface, text, border and state tokens. The reference is Apple-like restraint,
not a copy of Apple's UI, proprietary fonts or Liquid Glass.

No yellow/lime accent. No Inter, IBM Plex Mono, Manrope, Uncut Sans or Familjen
Grotesk substitution. No monospace aesthetic just because this is a developer
tool. No neon, gratuitous glass, glowing dashboard styling or decorative motion.
Color in the creative preview is content, not a new brand accent.

All UI, example names, docs, errors and code-facing terminology must be English.
Progress reports to the owner can be French.

## 4. Scope: a real frontend, not a backend product

Deliver these three connected views:

### A. Rig library

- Browse and search local example rigs; clear selection and an Open rig action.
- Useful previews, renderer description and source information.
- Deep links to rigs; refresh and browser Back/Forward preserve coherent state.
- Designed empty, no-results, loading and error states with a useful next action.
- Populate the library through a small local registry or file-discovery adapter,
  not hardcoded cards coupled to route components. Real filesystem watching and
  discovery across arbitrary external projects are outside this UI milestone.
- Mark example data as examples. Do not imply a scan or server connection that
  does not exist. `.rig.tsx` in the mockup is a proposed convention, not an API
  already implemented; document whatever minimal local contract is selected.

### B. SVG editor

- Shared workspace shell, open-rig tabs, large preview and grouped inspector.
- A real interactive SVG example, not a static mockup image.
- Sliders and numeric inputs update the same state and actually affect the SVG.
- Include one working custom curve control to prove extension beyond sliders.
- Per-parameter reset, undo/redo, named snapshots and Original/Current comparison.
- Preserve independent state when switching rigs; do not silently discard work.
- A slider drag creates one meaningful undo transaction, not hundreds of steps.

### C. 3D editor with timeline

- Reuse the same shell and inspector components; do not build a second editor.
- Include a bounded, real 3D example with orbit controls and a few meaningful
  material/geometry/atmosphere controls. Visual richness should not require a
  production-scale planetary engine in this phase.
- Play/pause, scrub, duration and loop; a few editable keyframes driving actual
  preview parameters. Displayed time, tracks and inspector values stay in sync.
- Pointer dragging has keyboard or numeric alternatives. The timeline can hide
  when irrelevant and resize when useful.
- Handle renderer failure gracefully; the library and other rigs must survive.

### Shared handoff workflow

Snapshot, preview, inspector and export must use one authoritative parameter state.
Export JSON containing a version, rig identifier and actual current values;
include animation data when relevant. Copy and download must work and report
failures honestly. Provide a fallback when clipboard access is unavailable.
Do not silently apply values back to project source: that agent integration is
later work. Do not claim an export is a production code integration.

Small local persistence is appropriate for panel preferences, snapshots and
drafts. Version it, handle invalid stored data, and provide a recovery path.
Do not place sensitive values in URLs or require any account or network service.

Do NOT add authentication, billing, hosted collaboration, marketing pages,
an AI chat panel, a package publishing pipeline, telemetry or external APIs.
Do not modify ANYM, Stellary or Helios, even to start or fix their editors.

## 5. Component reuse and extensibility

Build one small, coherent design system, not three collections of similar CSS.

- Central semantic tokens for colors, spacing, typography, radii, layering,
  focus, motion and density. Components consume roles, not arbitrary hex values.
- Shared primitives as needed: Button/IconButton, Tooltip, Popover, Menu,
  Select/Combobox, Tabs, Disclosure, Field, NumberField, SliderField, Switch,
  ColorField, CurveField, feedback messages and resizable panels.
- Shared composed parts: WorkspaceShell, RigNavigation, RigPreview, Inspector,
  ParameterSection, Snapshot controls, Export action and Timeline.
- Prefer one mature unstyled/headless accessibility foundation. Own the visual
  layer completely. Do not mix multiple libraries for the same primitive or
  ship a recognisable default component-library skin.
- Separate renderer adapters, rig data, parameter state and shared UI. No rig
  name conditionals scattered through the shell.
- Offer convenient declarative standard controls AND a custom-component/control
  escape hatch sharing the same state, reset, undo and export contract. Do not
  force every future creative instrument through a closed schema or giant switch.
- Prove reuse through actual consumers. Avoid speculative abstractions, a huge
  plugin engine, premature generic APIs and a giant all-purpose component.
- Keep dependencies and licenses documented. Do not choose a license for the
  whole project or publish it without the owner's agreement.

## 6. Zero browser-native visual widgets

**No unstyled browser controls, OS picker appearances or browser-owned UI
popups in the application's visual layer.** This applies to open states too.

- Replace native select dropdowns, date/time/color pickers, progress/meter
  visuals, browser `title` tooltips and `alert`/`confirm`/`prompt` dialogs with
  fully styled, accessible components when those features are needed.
- Do not rely on the native color-picker dialog behind a styled swatch.
- Checkbox, radio and range elements may retain their semantics with
  `appearance: none` and completely custom visuals and states.
- Keep semantic buttons, links, labels, inputs, forms and textareas. Style them
  fully. This rule is NOT permission to replace buttons with clickable divs or
  destroy keyboard, touch, IME, autofill or assistive-technology behavior.
- Remove native numeric spinners if using numeric inputs; provide explicit,
  styled stepping controls where needed. Handle partial numeric input without
  interrupting typing. Commit, cancel and invalid values must be predictable.
- Style scrollbars without replacing native scrolling with a JavaScript engine.
- Browser security, permission and file-download UI outside the app's control
  is not a custom widget and must not be bypassed or spoofed.

Do not build unused widget types just to complete a component inventory.

## 7. Premium UX: concrete requirements

### Layout intelligence

- The preview is the main workspace. Avoid panels within panels or ornamental
  whitespace that shrinks the actual creation area.
- Side panels resize within sensible bounds, collapse explicitly, and reopen
  predictably. Persist valid preferences; clamp them after viewport changes.
- Use grid/flex/container-aware layout, not screenshot coordinates. Nested
  scroll areas have explicit ownership; no accidental page-wide horizontal scroll.
- At smaller widths, simplify the layout shape: dock or switch the inspector
  rather than compressing three columns. Keep the main task accessible.
- Do not clip long labels, values or source paths without an accessible way to
  read them. Never fix overflow with global `overflow-x: hidden`.
- Keep panel headers, primary actions and focus visible at 200% zoom.
- One prominent action per context. Use quieter secondary actions and stable
  placement. Explain technical terms where needed; don't infantilize experts.

### Tooltips and contextual help

- Use one shared tooltip implementation with consistent geometry, typography,
  spacing, arrow treatment, delay and motion.
- Icon-only actions need accessible names and explanatory tooltips. Include
  shortcuts only when implemented. Avoid redundant tips repeating obvious text.
- Show on hover and keyboard focus; dismiss on Escape. Support hoverable,
  persistent content until the pointer/focus leaves, without trapping the user.
- Use collision-aware positioning and appropriate layering/portals. Tooltips
  must not be clipped by an inspector or obscure the parameter being edited.
- Disabled actions explain why they are unavailable through a focusable help
  affordance or nearby text; do not assume a disabled button receives focus.
- Essential instructions must remain available without hover, including touch.
  Interactive help belongs in a popover, not a tooltip containing buttons.

### Precise controls and feedback

- Every parameter has a readable label, current value, unit and meaningful range.
  If the rig allows values beyond the slider's convenient range, support them
  through numeric entry rather than imposing an arbitrary creative limit.
- Dragging is immediate and stable; use pointer capture and clear commit/cancel
  behavior. Do not rerender the entire shell on every frame or pointer movement.
- Provide hover, pressed, focus-visible, disabled, busy and error states from the
  beginning. Do not leave a button that looks enabled but silently does nothing.
- No simulated success messages, fake timers or invented connection statuses.
- Motion communicates state: short, interruptible transitions, no scroll-reveal
  marketing animations. Respect reduced motion and reduced transparency.
- No accidental text selection while manipulating chrome. Preserve selection
  for editable values, code, source paths, exported JSON and meaningful content.

### Accessibility

- Full keyboard operation with logical order, visible focus and correct
  semantics. Follow the chosen primitives' established interaction contracts.
- Focus restoration for overlays, safe dismissal and no focus traps outside
  true modal dialogs. Do not use modals for tasks requiring the preview behind.
- Adequate pointer targets, especially on touch; dense visuals do not require
  tiny hit areas. Resizers and curve/timeline editing need non-drag alternatives.
- Verify text and meaningful control contrast. Respect forced-colors and
  increased-contrast preferences; don't communicate state through color alone.

## 8. Work in reviewable phases

1. **Inventory and plan.** Read skills and references, inspect screenshots,
   confirm assets, state scope and select the minimal stack. Record an initial
   route/state test matrix and a short component map.
2. **Foundation and representative slice.** Implement tokens, Public Sans,
   shared primitives and the responsive shell. Prove one slider + number field
   changing the SVG preview, including reset and keyboard use, before expanding.
3. **Library and SVG workflow.** Add registry, routes, library states, tabs,
   inspector groups, custom curve, snapshots, undo/redo and real JSON handoff.
4. **3D and timeline.** Add the isolated 3D adapter and bounded example, then
   wire time, keyframes and inspector values through the same contracts.
5. **Dedicated craft pass.** Review hierarchy, optical alignment, actual text
   spacing, panel density, tooltip behavior, overlays, motion and narrow layouts.
   Inspect the running application and fix issues, not just the source code.
6. **Acceptance and handoff.** Run the tests below, capture current served views,
   document the setup and explain remaining limitations precisely.

Do not label phase 2 "done" for the whole task. Do not perform a large visual
redesign in the final phase. Preserve the direction and refine its execution.

## 9. Acceptance: demonstrate, do not self-certify

Run the actual local dev server on an available port without killing other
projects. Use browser automation when available and inspect the rendered result.
A passing build or an attractive screenshot alone does not establish completion.

Required checks:

- Type checking, linting and production build pass; no runtime console errors.
- Automated tests cover shared parameter state, reset, undo transaction grouping,
  snapshot isolation, export contents and timeline interpolation.
- Open a rig by URL, reload, use Back/Forward, switch rigs and return: edits and
  navigation remain coherent.
- Search the library, clear the search, test empty/no-results/error states and
  long names. Exercise larger local fixtures without inventing product metrics.
- Change a slider, enter an exact value, edit the curve, reset and undo: the
  displayed value, preview, snapshot and exported JSON agree.
- Create a snapshot, change values, compare, restore and export. Confirm copied
  and downloaded data match the actual state, not hardcoded example values.
- Play, pause, scrub and edit a keyframe in the 3D example. Check the scene and
  inspector correspond to the timeline and switching rigs stops unused loops.
- Resize/collapse panels; test at 1600, 1440, 1280, 768, 375 and 320 CSS-pixel
  widths, plus 200% zoom. Small screens must reflow, not miniaturize the desktop.
- Test keyboard-only navigation, tooltip focus/Escape, open selects/popovers,
  scroll boundaries, touch/coarse-pointer behavior and reduced-motion/forced-color
  modes. Include non-drag ways to adjust timeline and curve values.
- Verify there are no browser-native visual widgets in closed OR open states.
  A styled select trigger with an OS dropdown still fails.
- Inspect selected, empty, loading, error and overlay states, not only the happy
  path. Calibrate any audit script on a known example before trusting its results.
- Profile a slider drag and timeline playback; seek immediate feedback and stable
  frame pacing. Record the device, viewport and throttling used rather than
  claiming universal performance from a development laptop. Pause hidden scenes,
  release renderer resources and keep font/layout shifts under control.
- Visually compare current browser captures against the local mockups. Preserve
  the actual logo masters and verify their hashes did not change.

Save concise QA evidence and screenshots inside ParamRig. Report separately:
implemented and verified; implemented but unverified; intentionally deferred.
If browser testing is unavailable, state that limitation instead of saying AAA
quality or full accessibility has been proven. Human visual acceptance is still
required after technical checks.

## 10. Final delivery

Provide the launch command and local URLs, the key reusable components, tests
actually run, screenshots, known limits and the next useful review step.
Document how to add an example rig and a custom control without editing the shell.

No commits, pushes, deployments, package publication or external writes unless
separately requested. If commits are later authorized, follow `AGENTS.md`:
no AI signatures, "Generated by" footers or AI `Co-authored-by` trailers.

The desired outcome is a frontend that feels considered in every interaction:
easy to approach, capable of deep work, and built from components that can grow
with arbitrary creative rigs. Do not sacrifice simplicity for feature count,
or extensibility for a quick hardcoded demo.
