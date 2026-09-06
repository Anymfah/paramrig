# ParamRig

ParamRig is an open-source workbench for human-tuning AI-built visual systems.

Instead of asking AI to own the finished creative result, ParamRig asks it to build the tools. The AI creates a purpose-built rig around a component, design system, SVG, animation, 3D scene, or procedural world. A human shapes the result in a live preview, then the AI applies the validated choices back to the product.

ParamRig also supports rapid proofs of concept: uncertain ideas become manipulable prototypes whose approved parameters can be carried into production.

> Let AI build the tools. Keep creation human.

Official website: [paramrig.com](https://paramrig.com) — planned, not yet launched.

## Status

A local frontend is available for the library and SVG, HTML and 3D editors,
with editable animation tracks, snapshots and action history. Discovery notes still apply to product strategy; they are not
the application itself.

## Run locally

The workbench runs as the Docker Compose project `paramrig`. Do not start
Vite on the host.

```bash
docker compose up -d
```

Then open [http://localhost:5174/](http://localhost:5174/).

See [`docs/local-docker-development.md`](docs/local-docker-development.md)
for stop/start, rebuilds, and one-off commands.

- Library: `/`
- Example rig: `/r/contour-bloom`, `/r/tidal-planet`
- Docs: `/docs`
- Controllers: `/docs/controls`
- Full controller lab: `/r/controller-lab`
- QA fixtures: `/?fixture=empty`, `/?fixture=error`, `/?fixture=loading` (holds the skeleton), `/?fixture=long`

```bash
docker compose run --rm app npm test
docker compose run --rm app npm run lint
docker compose run --rm app npm run build
```

Example rigs come from `src/rigs/registry.ts`. See
[`docs/ADDING-A-RIG.md`](docs/ADDING-A-RIG.md) to add another study without
editing the workspace shell.

QA captures from the implementation pass live in
[`workproduct/ui-implementation/qa/`](workproduct/ui-implementation/qa/).

## Workspace UI

Shared controls live in `src/ui/`: `Button`, `NumberField`, `SliderField`,
`ColorField`, `CurveField`, `GradientField`, `SelectField`, `SwitchField`,
`Tooltip`. The workspace shell (`Inspector`, `Timeline`, `ExportAction`,
`RigPreview`) binds them through `RigSession` — do not branch on a rig name
in the chrome.

`ParameterField` is the shared manifest-to-control renderer. The searchable
catalog now contains 62 focused examples in 10 families: numbers, spatial controls,
appearance, choices, typography, curves, resources, actions, collections and
value sources. The same definitions run in the full Controller lab with
the inspector, history, snapshots, export and timeline. See
[`docs/CONTROLLERS.md`](docs/CONTROLLERS.md) for contracts and limits.

The timeline supports grouped tracks, zoom, keyframe selection and dragging,
copy/paste/delete, precise time/value/easing controls, and a playback range.
Undo/redo records a complete drag as one action. The History tab keeps the
last 100 actions for the current session. Snapshots can be named, restored
(including the active reference), and removed; these actions are undoable too.
Reference and Current sample animated values at the same playhead position.

Right-click a control to reset it or add numeric animation. Shift+F10 opens
the same actions from the keyboard; small screens expose an actions button.
Timeline keys, track labels, track backgrounds, group headers and the ruler
also have context menus. Right-clicking an already selected key keeps the
multi-selection. Drag the grip above the timeline to resize it, or use Expand
timeline. The grip supports arrow keys, End to expand, Home to collapse and
Escape to cancel a drag. Its height is saved and bounded by the viewport.
Drafts and snapshots use browser storage. History, selection, track visibility
and the keyframe clipboard are session state, not permanent project data.

The key/track context panel uses the parameter's numeric instrument (including
knobs, logarithmic sliders and discrete stops). Curve editor switches to an
editable graph of the selected track, with real keys and their interpolation.

Known limits of this build: bundled examples only (no disk watch), export
does not write back to source, 3D is a bounded study, and there is no auth,
AI chat, or telemetry. The current UI includes intentional departures from
[`assets/ui-mockups/`](assets/ui-mockups/); those mockups are not a pixel-perfect
acceptance target.

## Connected web projects

The local Web workspace opens a running project through a development SDK. It
supports exposed controls, DOM selection, visual markup, snapshots, approved
feedback batches and agent responses saved in the connected project. Start the
optional Compose `web` profile and open `/web`. See
[`docs/web-workspace.md`](docs/web-workspace.md) for setup, the React example,
the SDK build, source revisions and the file handoff contract.

## Initial audience

The working hypothesis is creative developers, vibecoders, and technical artists who use coding agents to build complex visual systems and lose time translating perceptual feedback into precise code changes. This hypothesis has not yet been validated as the final target segment.

## Language policy

English is the canonical language for the application, APIs, rig definitions, documentation, and error messages. Future translations must derive from the English source rather than introducing parallel product terminology.

## Product framing

Internal product-discovery sessions are kept locally and are not published.
The local UI uses Vite, React, and TypeScript. See `package.json`.

## Brand

The approved Coform logo and the current branding study are available in
[`assets/brand/`](assets/brand/). The application self-hosts Public Sans
(WOFF2) from `public/fonts/`. The custom wordmark is vector geometry, not a
font.

## Contributions

How to run the checks, open a pull request and where things live is in
[`CONTRIBUTING.md`](CONTRIBUTING.md); repository conventions, including the
prohibition on AI signatures in commit messages, are in [`AGENTS.md`](AGENTS.md).
To report a vulnerability, see [`SECURITY.md`](SECURITY.md).

## Licensing

ParamRig is MIT licensed. The terms are in `LICENSE`, and both `package.json`
files declare it. `packages/web-sdk` carries its own copy so the published
package travels with it.

That covers ParamRig's own code. Runtime dependencies keep their own licences,
listed in `package.json`, and the bundled Public Sans keeps the SIL Open Font
License that ships beside it in `public/fonts/PublicSans-OFL.txt`.
