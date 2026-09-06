# @paramrig/web

Expose a running development page's design decisions as controls, let a person tune
them in the ParamRig workbench, and read back what they approved as a file in your
repository.

This document is written for the agent that maintains the project being tuned. It
is self-contained: everything needed to instrument a project, keep it safe, and
answer the feedback is here. The workbench's own behaviour — selection, drawing,
review — is described in `docs/web-workspace.md` in the ParamRig repository.

The integration is **development only**. It is framework-neutral, depends on
nothing, and does nothing at all unless a workbench is framing the page.

## Install

```sh
npm install --save-dev @paramrig/web
```

The package is not published yet. Until it is, build it from the ParamRig
repository with `docker compose run --rm app npm run build:web-sdk` and install
the resulting `packages/web-sdk` directory as a local dependency.

## 1. Describe the controls

Write `.paramrig/manifest.json` at the root of the project. It is the contract: it
says what can be tuned, where the page runs, and which source revision it describes.

```json
{
  "version": 1,
  "id": "fieldnotes",
  "name": "Fieldnotes",
  "revision": "study-1",
  "origin": "http://localhost:3000",
  "pages": [{ "id": "home", "name": "Home", "path": "/" }],
  "groups": [{ "id": "brand", "label": "Brand" }],
  "parameters": [
    { "id": "accent", "kind": "color", "label": "Accent", "group": "brand", "defaultValue": "#df7757" }
  ],
  "bindings": [
    { "paramId": "accent", "scope": "global", "kind": "css-variable", "property": "--accent" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `version` | Always `1`. |
| `id` | Stable identifier, `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`. Never change it: the workbench's library, its saved drafts and every batch on disk are keyed by it. |
| `name` | What a person sees. |
| `revision` | The source revision this manifest describes: any string — a counter, a date, a short label — as long as each one is new. **Change it whenever you change the code the controls describe.** The workbench waits rather than applying a batch to code it does not match. |
| `origin` | The exact HTTP or HTTPS origin the development server answers on — scheme, host and port, nothing else. |
| `pages` | At least one, at most 100. Each has a unique `id`, a `name` and a `path` starting with `/`. |
| `groups` | Named sections for the controls. Each has an `id` and a `label`. |
| `parameters` | The controls themselves, at most 500, with unique `id`s. |
| `bindings` | What each control writes, and how far it reaches. |

`parseManifest` throws on anything it does not accept, and the message names what
is wrong. Call it yourself so the failure is yours rather than the workbench's.

### Control kinds

Every parameter has `id`, `label`, `group`, `kind` and `defaultValue`.

`number` · `color` · `select` · `curve` · `switch` · `gradient` · `text` ·
`vector` · `range` · `palette` · `points` · `radial` · `group` · `list` ·
`resource` · `gizmo2d` · `gizmo3d` · `camera` · `textureFrame` · `multiselect` ·
`action` · `preset`

Four of them require more:

- `number` requires `min`, `max` and a `step` greater than zero. Its `unit` is
  what a person reads beside the control; the binding's `unit`, below, is what is
  written to CSS. They are usually the same string.
- `select`, `multiselect` and `preset` require `options`, each `{ value, label }`.
- `group` requires `fields`, an array of parameters, nested at most 8 deep.
- `list` requires `item`, one parameter describing an element.

The others carry optional fields of their own — `text` has `maxLength` and
`multiline`, for instance — listed in the package's type declarations,
`dist/rigs/extended-types.d.ts`. All twenty-one exist because the same controls
serve ParamRig's vector and 3D rigs; on a web page, the useful ones are those
whose value maps onto a CSS value or onto an adapter you write.

Start with `number`, `color`, `select`, `switch` and `text`. They cover most of
what a person wants to move, and every one of them reads clearly in a review.

### Bindings

A binding names a `paramId`, a `scope`, a `kind` and a `property`.

**Scope** — how far a change reaches, declared by you and never changed by which
element a person happens to select:

- `global` — the whole application.
- `page` — one page; also declare `pageId`.
- `element` — one instrumented family; also declare `target: { id, instance? }`.
  Leaving `instance` out is deliberate: it applies to every instance of that
  family, and the workbench says so in the review.

**Kind** — where the value goes:

- `css-variable` — writes a CSS custom property. `property` is the property name,
  `--accent`. Prefer this for design tokens: one binding moves everything that
  reads the token.
- `style` — writes one declared CSS property on the target. `property` is the CSS
  property, `font-size`. The original inline value and its priority are preserved
  and restored.
- `adapter` — calls a `read`/`apply`/`restore` adapter you registered in the
  application. `property` is the adapter's key. Use it for anything CSS cannot
  express: copy, state, a canvas, a composite value.

`unit` is appended to numeric CSS values — `"unit": "px"`. Without it a number is
written bare, which is what `line-height` and `opacity` want.

`source` is optional: a file path shown beside the control, the same claim as
`data-paramrig-source` on an element. Nothing reads it as an instruction, and a
stale one is not an error, only a hint that lies.

**How the source value is read.** When the workbench pairs, the SDK reads what
the page shows rather than trusting the manifest: `read()` for an adapter, the
computed style for a CSS property or custom property. `defaultValue` is the
fallback when that read gives nothing. A computed length comes back in pixels
whatever the stylesheet declared, so the SDK converts it into the binding's
`unit` when the two are commensurable — `rem`, `em`, `vw`, `pt` and the other
lengths, `s` and `ms`, `deg` and `turn`. A percentage cannot be read back, nor
can a bare number the browser reports with a unit, such as a unitless
`line-height`; there the `defaultValue` stands, so keep it true.

Callbacks never travel through a manifest, a batch or a message. Resource controls
carry metadata, not file bytes; expose a URL your project owns, or an adapter.

## 2. Name the elements

An element the workbench can talk about carries `data-paramrig-id`. Everything
else is optional.

```html
<article data-paramrig-id="story-card"
         data-paramrig-instance="coast"
         data-paramrig-label="Story card"
         data-paramrig-source="src/StoryCard.tsx">
  <h2 data-paramrig-id="story-title">Following the coastline</h2>
</article>
```

- `data-paramrig-id` — a stable semantic identifier. It is what a binding points
  at, and what survives a refactor. Keep it when you move the markup.
- `data-paramrig-instance` — tells repeated components apart. Descendants inherit
  it, so the title above belongs to `coast` without repeating it.
- `data-paramrig-label` — the name a person reads. Without it the identifier is
  read as a sentence (`story-card` becomes **Story card**), then the accessible
  name, then the words on screen, then `Unnamed article`.
- `data-paramrig-source` — a hint about where this comes from, shown beside the
  element. It is your claim, not an inferred source map; keep it honest or omit it.

Instrument the elements most likely to receive feedback. Uninstrumented ones can
still be selected and commented on, but their reference is provisional and has to
be reattached after a reload.

## 3. Connect, in development only

```ts
import { connectWeb, parseManifest } from '@paramrig/web'
import manifestFile from './.paramrig/manifest.json'

const connection = connectWeb({
  manifest: parseManifest(manifestFile),
  adapters: {
    headings: {
      read: () => currentHeadingFont,
      apply: value => setHeadingFont(String(value)),
      restore: () => setHeadingFont(initialHeadingFont),
    },
  },
})

connection.dispose()
```

React:

```tsx
useEffect(() => {
  if (!import.meta.env.DEV) return
  const connection = connectWeb({ manifest, adapters })
  return () => connection.dispose()
}, [manifest])
```

**Always dispose.** On unmount, and on hot-module replacement — `import.meta.hot`
in Vite, `module.hot` in webpack. A second `connectWeb` without a `dispose` is
handled (it warns and replaces the first, so two overlays never coexist), but the
warning is telling you the cleanup is missing.

**Keep it out of production.** Guard the import so the module is not in the
production bundle at all: `import.meta.env.DEV`, `process.env.NODE_ENV`, or a
dynamic `import()` behind that check.

`hostOrigin` is optional and takes one origin or a list. It defaults to
`['http://localhost:5174', 'http://127.0.0.1:5174']`, the two addresses the
workbench answers on. Name your own only if you run the workbench elsewhere.

### What it does when there is no workbench

`connectWeb` never throws, because a development integration that takes the
application off the screen is worse than one that is unavailable:

- **Not in a frame** — the page opened normally — it installs nothing. No
  listener, no observer, no overlay, and nothing in the console.
- **The manifest's `origin` is not the page's origin**, or `hostOrigin` is not an
  origin: one `console.warn` naming both, then nothing. A development server
  usually answers to both `localhost` and `127.0.0.1`; opening the page by the
  other name should cost a line, not a blank screen. Fix it by opening the page at
  the manifest's origin, or by writing the origin you actually use.

`parseManifest` does throw. An invalid manifest is a programming error, and you
called it.

### Framing, and HTTPS

The workbench opens your page in a cross-origin iframe, so your development server
has to allow it:

```
Content-Security-Policy: frame-ancestors 'self' http://localhost:5174 http://127.0.0.1:5174;
```

and it must not send a conflicting `X-Frame-Options`. Scope that header to the
development configuration. Never relax it in production, and never remove the
production header to make a local session work.

If your development server is HTTPS, the workbench must be reached over HTTPS as
well: a browser will not frame an `https:` page from an `http:` document without
complaint, and mixed content is refused outright.

The pairing itself is checked at every step. The SDK announces itself to its
parent; the workbench answers with `hello`; that reply pins the origin and the
session that every later message, in both directions, is checked against. Nothing
is listening before the reply, and the application's own clicks pass through.

## 4. What to commit in `.paramrig`

| File | Who writes it | Commit it? |
| --- | --- | --- |
| `manifest.json` | You | **Yes.** It is source: it describes your code. |
| `batches/<id>.json` | ParamRig | Your call. They are immutable and they are the record of what was asked. Committing them lets the next agent read the history; they can be large when they carry markup. |
| `responses/<id>.json` | You | Your call, and it should match `batches/`. |
| `draft.json` | ParamRig | **No.** It is rewritten continuously and is not approved instructions. |
| `captures/*.png` | ParamRig | **No.** Large, and reproducible from the batch. |
| `README.md` | ParamRig | Your call. It repeats what is here. |
| `.gitignore` | ParamRig | Yes — it is the two "no" rows above. |

ParamRig writes that `.gitignore` when there is none, covering `draft.json` and
`captures/`, and never writes over it. Everything else is yours to decide.

ParamRig writes nothing outside `.paramrig`. It does not start your application,
install anything, or touch your source.

## 5. The loop

A person tunes controls, comments on elements, draws on the page, then approves.
That writes one immutable file: `.paramrig/batches/<id>.json`. They will hand you
an instruction naming it.

**Read the batch.** It carries `values` (every control's value, not only the ones
that moved), `changes` (each with `before`, `after` and the bindings it writes),
and `tickets` (the comments, each with its targets, marks, page, viewport, scroll
context and captures). A batch restates every difference from your source, so the
newest one alone is the whole picture, and a control present in `values` but
absent from `changes` did not move.

**Apply it in the source.** Move the real values in the real files — the batch is
a request, not a patch. A value behind an adapter usually lives in three places
that move together: the initial state, `read` and `restore`. Preserve every
`data-paramrig-id` and `data-paramrig-instance`. Then, in `manifest.json`, set
each changed control's `defaultValue` to the value you applied, so the manifest
tells the truth even without a page to read, and change `revision`, because the
code the controls describe has changed.

**Write one response**, atomically: a temporary file, then a rename.

```json
{
  "version": 1,
  "id": "response-001",
  "projectId": "fieldnotes",
  "batchId": "the-approved-batch-id",
  "sourceRevision": "study-1",
  "resultRevision": "study-2",
  "createdAt": "2026-09-05T12:00:00.000Z",
  "summary": "Applied the approved palette and adjusted the hero.",
  "tickets": [
    { "id": "the-ticket-id", "status": "implemented", "message": "Check the hero at mobile width." }
  ]
}
```

- `id` must be unique, and the file must be named `<id>.json`.
- `projectId` is the manifest's `id`; `batchId` names the batch you read.
- `sourceRevision` is the batch's own `sourceRevision`. `resultRevision` is the
  new manifest revision. A response naming another revision is reported, not
  applied.
- `tickets` answers the tickets of that batch, each its own way, and only tickets
  that belong to it. `status` is `implemented` or `needs-info`.
- `message` is what a person reads: what changed, and how to check it.

Use `needs-info` when you cannot act. Say precisely what you need — a value, a
choice between two readings, a page you cannot reach. It reopens the ticket for
another round rather than closing it wrongly.

**A response is a claim, not an approval.** Write `summary` and each `message` as
what you did and how to check it, never as a certification. Only the person
validates a correction, in the workbench.

**One round, end to end.** The batch says `accent` moved from `#bc593d` to
`#336b72` through `--accent`, and `heading-font` from `Georgia` to `Public Sans`
through the `headings` adapter; one ticket on the hero asks for the coastal
palette. You change `--accent` in the stylesheet; you change the initial font,
`read` and `restore` in the adapter; you set both `defaultValue`s, move
`revision` from `study-1` to `study-2`, and write `responses/response-001.json`
naming the batch, `study-1` as `sourceRevision`, `study-2` as `resultRevision`,
and the ticket as `implemented` with a message saying where to look. The batch
itself you do not touch.

**What never changes.** Do not edit or delete a batch, `draft.json`, or a capture
file. Batches are immutable, and the workbench refuses a rewrite. A ticket that is
reopened leaves its batch and drops the answer that batch received, so a later
response to a batch a ticket has left does not reach it.

## Schemas

Machine-readable JSON Schema (draft 2020-12) for the three files, shipped with the
package and importable as `@paramrig/web/schemas/<name>.schema.json`:

- `schemas/manifest.schema.json`
- `schemas/batch.schema.json`
- `schemas/response.schema.json`

They are a second expression of the guards in the SDK, and a test in the ParamRig
repository fails the moment the two disagree. Validate against them in your own
checks; the guards remain the authority at runtime.

## Licence

MIT. See `LICENSE` in the ParamRig repository.
