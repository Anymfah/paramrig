# Connected web workspace

The Web workspace opens a running development page. The agent exposes controls;
the user tunes them, selects DOM elements and adds visual feedback. Approved
feedback is written to the project for the agent to read on its next run.

## Local setup

Run all persistent services from the ParamRig repository through Docker Compose.
Check `docker compose ls` first. Follow `AGENTS.md` when another development stack
is running. The UI stays at **http://localhost:5174**; the file service has no
published host port.

For the included Fieldnotes example:

```sh
docker compose --profile web up -d
```

Open `/web`, then **Open project**. The example runs at `127.0.0.1:5174`, a
different browser origin from the workbench at `localhost:5174`. Its two pages
include repeated components, a menu and an internally scrollable notebook.

For an existing project, supply its absolute directory and disable example seeding:

```sh
PARAMRIG_PROJECT_DIR=/absolute/path/to/project PARAMRIG_SEED_MANIFEST= \
  docker compose --profile web up -d
```

The project must contain `.paramrig/manifest.json`. Its development server remains
managed by that project. ParamRig's service only writes inside its `.paramrig`
directory. It does not launch the target application, install dependencies in it,
or modify its source. The connection stays local and single-user. A recent project
can be reopened when its folder is connected to the service again.

The public static demo does not run this file service. Local browser recovery
belongs to the workbench origin; it is not a cloud backup.

A link to `/r/web-<project>` opens on a browser that has never seen the project.
The registry cannot describe it, so the workspace asks the local service: when
the identifier is the connected project the workspace opens and remembers it,
and otherwise the connections page is offered. The library still lists only the
projects this browser has opened.

## Install the SDK

Build the local package from ParamRig:

```sh
docker compose run --rm app npm run build:web-sdk
```

The resulting package is `packages/web-sdk`. Install that local package in the
target project's own development environment, or serve the generated ES module
and its accompanying chunks. No registry publication is needed.

```ts
import { connectWeb, parseManifest } from '@paramrig/web'
import manifestFile from './.paramrig/manifest.json'

const connection = connectWeb({
  manifest: parseManifest(manifestFile),
  hostOrigin: 'http://localhost:5174',
  adapters: {
    headingFont: {
      read: () => initialHeadingFont,
      apply: value => setHeadingFont(String(value)),
      restore: () => setHeadingFont(initialHeadingFont),
    },
  },
})

// On unmount or hot-module replacement:
connection.dispose()
```

Install the connection only in development. For React, create it in an effect and
dispose it in the cleanup. The complete React example lives in
`src/web/example/Demo.tsx`. The SDK itself does not depend on React.

## Pairing

`connectWeb` posts one announcement to the parent as soon as its listeners are
installed: `{ channel: 'paramrig.web', version, type: 'sdk-present', projectId,
instanceId }`. It carries no session ID and is deliberately not an envelope; the
workspace answers it with `hello`, and that reply opens the session every later
message is checked against. Until the reply arrives the SDK does nothing: no
overlay, no selection, no event, and the application's own clicks pass through.

The workspace also greets on its own, at 100, 200, 400 and 800 ms and then every
two seconds, so an integration built before the announcement still pairs. It
posts nothing at the frame before the frame has loaded or spoken, which is what
`postMessage` needs to stop warning about a recipient origin. `WEB_PROTOCOL` is
unchanged: an SDK that never announces itself is greeted by the same `hello` it
always was.

While the preview has not answered, the selection tool, the drawing palette and
the controls are `inert` rather than merely dim, **Review changes** is refused,
and a veil over the preview carries the status. Reconnecting resends the current
mode, targets and values, so a preview that reloads comes back where it was.

`examples/web/manifest.json` is a complete manifest template. Keep its `id` stable,
use the target application's exact HTTP origin, and list its page paths. Increment
`revision` after applying feedback. Update the file-service manifest and the SDK's
manifest together. The workspace waits when their revisions disagree.

Parameters use ParamRig's existing `ParameterDef` contracts. Bindings identify a
parameter, scope (`global`, `page`, `element`) and destination:

- `css-variable`: writes a CSS custom property; prefer this for design tokens.
- `style`: writes a declared CSS property on the selected target family.
- `adapter`: calls a registered `read`/`apply`/`restore` adapter in the application.

Use `unit` for numeric CSS values. Page bindings declare `pageId`; element bindings
declare a target ID and optionally an instance. An omitted instance in a binding
intentionally applies to every instance of that target family. Scope is declared
by the agent and does not change when a user selects a different instance.
Adapters handle composite values; resource controls transfer metadata, not file
bytes. Use project-owned URLs or a project adapter when exposing resources.

Callbacks never travel through manifests, tickets or messages. Each CSS override
preserves the original inline value and priority. **Source result** restores the
source before review; it does not simulate success with old user overrides.

## Target identification

```html
<article data-paramrig-id="card" data-paramrig-instance="coast"
         data-paramrig-source="src/StoryCard.tsx">
  <h2 data-paramrig-id="card-title">Following the coastline</h2>
</article>
```

Instance keys are inherited by descendants. Supply stable semantic IDs for the
elements most likely to receive feedback. The source reference is a hint supplied
by the integration, not an inferred source-map guarantee.

An element is named by `data-paramrig-label`, else by its `data-paramrig-id` read
as a sentence (`story-card` becomes **Story card**), else by its accessible name,
else by the words on screen, and only then as **Unnamed div**. The outline under
the pointer carries that name and, when the manifest reaches the element, how
many controls it has; the outline's colours travel with `configure` from the
workbench tokens, so it follows the theme. The outline leaves with the pointer.

An element with no controls of its own is not an empty panel: the inspector says
so, then offers the ancestors that do have controls and the other instrumented
elements of the page, each with its count. Choosing one selects and reveals it.
With nothing selected, the same list is a folded **On this page** section in the
project controls. Repeated components are told apart by their instance.

A target's state is shown in words — **Not instrumented**, **Missing on this
page**, **Several matches** — and **Reattach** is offered only for the last two,
which are the ones a person can repair.

Uninstrumented elements can also be selected. Their DOM reference is provisional;
after replacement or reload they must be explicitly reattached. Positional CSS
selectors are recorded as context but never silently resolve a moved target.
Duplicate stable IDs produce an ambiguous target. Closed shadow roots and external
iframes are selected at their host boundary.

The workspace opens at the available width and 100% zoom. The size menu changes
its real viewport independently from display zoom. Project switching lives in
the project menu; the library is not shown while editing.

Browse leaves application interaction intact. Select prevents application clicks;
Shift-click adds another target. Arrow keys navigate parent, child and siblings.
The inspector shows local controls first, followed by inherited controls. Controls
that affect repeated components are identified as applying to all instances.
The hierarchy menu includes unnamed HTML ancestors without filling the inspector.

Choose **Comment** beside the selected element, or press **C**, to start typing.
Numbered bubbles reopen comments without changing the current preview size.
**Draw** opens notes, arrows, rectangles, ellipses, highlights and freehand tools;
**Draw on page** switches from the selected element to document coordinates.
Notes attach to the clicked element. Drag a mark's endpoint to edit it; the hit
radius stays 16 display pixels, or 22 for touch, independently from preview zoom.
Escape cancels the current gesture and returns to browsing. View options contains
Reference/Current comparison, snapshots and reload.

Page marks preserve document coordinates and their original viewport. Element
marks use fractions of the target's live box, so they follow nested scroll and
responsive layout. The original screenshot and context remain in the ticket.

## Feedback files and agent workflow

The service creates the following within the connected project's `.paramrig`:

| File | Owner | Purpose |
| --- | --- | --- |
| `manifest.json` | Agent | Project integration and source revision |
| `draft.json` | ParamRig | Mutable draft with compare-and-save revision |
| `batches/<id>.json` | ParamRig | Immutable, user-approved feedback |
| `responses/<id>.json` | Agent | Implementation results or clarification |
| `captures/<id>.png` | ParamRig | Ticket images |
| `README.md` | ParamRig | Agent handoff instructions |

The user chooses **Review changes**, reviews changed values and included
tickets, then selects **Validate feedback**. Later edits are a new draft. Each
batch includes values, before/after changes, bindings, targets, comment, markup,
page, viewport, scroll context and capture references.

The user then restarts their agent with an instruction such as:

> Read the new approved batch in `.paramrig/batches`, apply its values and
> requested changes to this project, preserve target IDs, and write a response
> following `.paramrig/README.md`.

The agent reads approved batches, modifies source files, updates the revision,
and atomically writes a new response file (temporary file, then rename):

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

Use `needs-info` to request clarification. A response must name its batch, project,
source revision, result revision and valid ticket IDs. Old responses are reported
without silently applying their status to a newer revision. Only the user can
validate a correction. Reopening prepares another draft; original batches remain.

When source changes, already-applied choices stop being overrides. Pending choices
survive an unchanged source value. Divergent values and removed controls stay
visible for resolution. Snapshots from another source revision remain named but
cannot be applied blindly to the new code.

## Captures, recovery and errors

HTML captures are lazy DOM reconstructions with `html-to-image`. They can omit
external assets, media, canvas content or effects and are labelled accordingly.
A failed capture preserves the ticket. Captures retain markup separately in the
batch; the DOM image itself excludes the overlay.

**Capture screen** uses the browser's display-sharing permission. The sharing
stream stops after a frame is acquired. The user previews and crops that frame
before saving it. Rejecting capture leaves existing feedback intact. The browser
must expose `getDisplayMedia`; there is no synthetic replacement for screen capture.

Drafts and unsynced captures are also saved to IndexedDB. A different project draft
or browser recovery copy requires an explicit choice before more writes. API writes
use a local pairing token, same-origin browser requests and atomic files. Symlinks,
path traversal and arbitrary file destinations are refused.

The target development server must allow framing by the workbench in its CSP
`frame-ancestors` and must not send a conflicting `X-Frame-Options`. Keep that
permission scoped to development. Never disable those protections globally. SDK
messages check origin, source window, connection ID, protocol version and payload.

## Verification

```sh
docker compose run --rm app npx vitest run src/web
docker compose run --rm app node --experimental-strip-types --test services/web/server.test.mjs
docker compose run --rm app npm run typecheck
docker compose run --rm app npm run lint
docker compose run --rm app npm run build
docker compose run --rm app npm run build:web-sdk
```

Use the Fieldnotes example for real-browser checks. Chrome desktop is the primary
acceptance target. Check narrow layouts, 200% zoom, both themes, reduced motion,
forced colors, keyboard selection, repeated instances, nested scrolling, capture
failure, reload and a real agent response. Existing drawing and scene routes must
continue to open and edit normally.
