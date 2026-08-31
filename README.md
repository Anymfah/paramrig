# ParamRig

ParamRig is an open-source workbench for human-tuning AI-built visual systems.

Instead of asking AI to own the finished creative result, ParamRig asks it to build the tools. The AI creates a purpose-built rig around a component, design system, SVG, animation, 3D scene, or procedural world. A human shapes the result in a live preview, then the AI applies the validated choices back to the product.

ParamRig also supports rapid proofs of concept: uncertain ideas become manipulable prototypes whose approved parameters can be carried into production.

> Let AI build the tools. Keep creation human.

Official website: [paramrig.com](https://paramrig.com) — planned, not yet launched.

## Status

A local frontend is available for the library, SVG editor, and 3D editor
with timeline. Discovery notes still apply to product strategy; they are not
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

Known limits of this build: bundled examples only (no disk watch), export
does not write back to source, 3D is a bounded study, and there is no auth,
AI chat, or telemetry. Human visual review against
[`assets/ui-mockups/`](assets/ui-mockups/) is the next useful step.

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

Repository conventions, including the prohibition on AI signatures in commit
messages, are documented in [`AGENTS.md`](AGENTS.md).

## Licensing status

No project license has been selected yet; public repository access alone does
not grant an open-source license. Runtime dependencies and their licenses are
listed in `package.json`. Bundled third-party fonts retain their accompanying
license notices.
