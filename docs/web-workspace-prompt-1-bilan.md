# Web prompt 1 — what was asked, what was delivered

Work carried out on 6 September 2026 against `main`, in nine commits, one per chantier. Every
number below was measured in the browser on the day, not estimated. The pictures it refers to are
in `e2e/reference/web/before/` and `e2e/reference/web/after/`; the browser checks that produce them
are `e2e/web-*.e2e.mjs`, run with `docker compose run --rm app npm run e2e -- web-`.

## The short version

All nine chantiers are delivered. The handshake, which conditioned everything else, went from a
two-second wait to under a tenth of a second. Two readings in the prompt were interpreted rather
than followed literally, and one measurement in the starting diagnostic did not reproduce; both are
set out below under **Where this departs from the prompt**. Nothing was left out for lack of time.

## The handshake, before and after

Measured as the lifetime of `.web-connection-notice` — from the toolbar appearing (or the notice
reappearing) to the notice going away — three passes over each of the three cases, in the same
browser, on the same machine, minutes apart.

| | before | after |
| --- | --- | --- |
| Opening the workspace | 2002 / 1991 / 51 ms · spread **1951 ms** | 75 / 59 / 64 ms · spread **16 ms** |
| Reload preview | 63 / 2003 / 2018 ms · spread **1955 ms** | 47 / 64 / 66 ms · spread **19 ms** |
| Changing page | 1816 / 1873 / 1885 ms · spread **69 ms** | 30 / 28 / 31 ms · spread **3 ms** |

The before column is bimodal because the wait was a two-second retry interval: whether it cost 50 ms
or 2000 ms depended on where in that interval the page happened to finish booting. That is what the
huge spread is. Afterwards the spread is the machine's own noise.

The prompt's target — Connected within 300 ms of the SDK finishing its connection — is measured
separately, from the `sdk-present` frame arriving in the parent to the notice going: **10 to 35 ms
over nine passes**. What remains of the ~65 ms above is the example's own start-up, which fetches
its manifest and mounts React before `connectWeb` is ever called; that belongs to the project, not
to the workspace.

`web-connect.e2e.mjs` re-measures all of this on every run and fails if any case exceeds a second,
or if the SDK-to-Connected gap exceeds 300 ms.

## Chantier by chantier

### A · The handshake — delivered

`connectWeb` posts one announcement (`sdk-present`, with the project and instance IDs) the moment
its listeners are installed; the workspace answers it with `hello` on the spot. Its own greeting now
steps at 100, 200, 400 and 800 ms before settling on the two-second heartbeat, so an integration
built before the announcement still pairs quickly. Nothing is posted at the frame before the frame
has loaded or spoken — the three `postMessage` origin warnings per reload are gone, and
`web-connect` fails if one comes back.

`WEB_PROTOCOL` is unchanged. The announcement is a new frame an old SDK never sends and an old host
ignores, and the reply is the same `hello` that has always been broadcast.

While the preview has not answered, the selection tool, the drawing palette and the controls are
`inert` rather than merely dim, **Review changes** is refused, and a veil over the preview carries
the status in place of the chip in the corner. Before: everything looked ready and nothing answered.

Reconnection resends mode, targets and values — `previewEpoch` already did this, and
`web-connect.e2e.mjs` now proves it rather than assuming it.

Tests: `sdk.test.ts` (announcement at connect, nothing listening before the reply),
`handshake.test.ts` (the greeting queue under fake timers), `WebToolbar.test.tsx` (inert while not
ready), `web-connect.e2e.mjs`.

### B · Deep link and connections page — delivered

`getRig` answers for a well-formed `web-*` identifier with a placeholder, so the route reaches
`WebWorkspace`, which asks `/api/web/state`: a matching identifier opens and is remembered, anything
else falls back to the connections page with a sentence naming the project the service is not
connected to. **The registry was the simplest place** because it already owns the question "what is
this identifier"; `listRigs` is untouched, so the library still lists only the projects this browser
has opened.

`/web` gained a sentence saying what the workspace is for, the page count beside the project's
origin, and a real failure with the command to run in place of a "Looking for the local web service"
that never resolved.

Tests: `projects.test.ts`, `web-deeplink.e2e.mjs`.

### C · Hover, selection and the empty state — delivered

`pointerout` and `pointerleave` on `window` clear the hover and redraw; Escape and a return to
browsing already did, and the test now covers all three. The outline carries a caption — the
element's name and, when the manifest reaches it, its control count — drawn with colours the host
sends through `configure` from its own tokens, so it follows the theme.

An element with no controls of its own no longer answers with an empty panel: the inspector says so,
then offers the ancestors that do have controls and the other instrumented elements of the page,
each named and counted, each a click away from being selected and revealed. With nothing selected
the same list is a folded **On this page** section. Repeated components are told apart by their
instance (`Story card · coast`).

Names: `data-paramrig-label`, then the identifier read as a sentence, then the accessible name, then
the words on screen, then `Unnamed <tag>`. Statuses are words — **Not instrumented**, **Missing on
this page**, **Several matches** — with a glyph, and **Reattach** appears only for the last two.

The selection tooltip reads `Select element · Esc to leave` while the tool is on.

Tests: `sdk.test.ts` (naming, hover caption, pointer leaving), `selection.test.ts` (counts, status
words, the overlay colours), `WebTargets.test.tsx` (the empty state), `web-select.e2e.mjs`.

### D · Sections, scope and quick comment — delivered

A section is named after its group again; how far it reaches is a badge beside that name, dropped
once several sections on screen agree on it. The floating **Comment** button left the page for an
icon in the inspector header, tooltip `Comment · C`; the **C** key is untouched and the numbered
bubbles stay. The ancestors read as a path — `Page › Stories › Story card` — with the two nearest in
the row and the rest in the menu they already had.

Tests: `WebControls.test.tsx`, `web-scope.e2e.mjs`.

### E · Marks, drawing and comments — delivered

Only the open comment's marks can be grabbed; the others are drawn at reduced opacity and ignore the
pointer, and the workspace refuses a mark belonging to another comment even if one reached it.
Entering review, snapshots or a screen capture returns the preview to browsing and lets go of the
selection tool; leaving them does not put it back on. A comment keeps its number from beginning to
end — the number is stored rather than counted from a position, so removing one comment no longer
renumbers the others. **Draw on page** has a glyph of its own and a tooltip that says what it
changes.

Tests: `sdk.test.ts` (grabbing limited to the open comment), `session.test.ts` (stable numbers),
`web-marks.e2e.mjs` (two comments, an arrow each, one drawn over the other's endpoint).

### F · The review and the handoff — delivered

Each control change has its own checkbox, its colour as a swatch and its number with its unit; each
comment shows its page, its main target, how many marks it carries and its last capture. Dropping a
control puts its source value back into the batch's `values` and takes it out of `changes`, so a
batch never asks for something the values beside it contradict — stated in `approved()` in
`session.ts`, and pinned by a test.

The button reads **Approve feedback**; the `todo` status reads **Sent to agent** in the interface
while the contract value is unchanged. After approving, the inspector names the file it wrote
(`.paramrig/batches/<id>.json`) and gives the instruction to hand the agent in a block that can be
selected, with a way back to comments.

Tests: `FeedbackReview.test.tsx`, `web-review.e2e.mjs` (a comment approved end to end and the batch
read back from `/api/web/state`).

### G · Size, zoom and toolbar — delivered

A preset wider than the stage switches to **Fit width** and the size button's tooltip says what it
is fitted to; **Available width** puts it back at 100%. The zoom ladder is 50, 75, 100, 150, 200 and
Fit. **Review changes** is quiet and countless while there is nothing to send, solid with a count
otherwise, and its tooltip splits controls from comments. The page picker is as wide as the page it
names, chevron against the label (74 px rather than 112, gap 4 px rather than the width of the
button). The state dot is 8 px with an immediate tooltip, and the project menu carries the state in
words — the only place it is legible at 390 px, where the dot is not on screen at all.

The `Preview size` tooltip no longer opens when Escape hands focus back to its trigger: a focus that
arrives within 400 ms of an Escape is not treated as a keyboard arrival. That fix is in the shared
`src/ui/Tooltip.tsx`, so the drawing editor was re-run in full — **277 checks across 19
`chantier-*` scripts, all passing**.

Tests: `WebToolbar.test.tsx` (the button at rest and with a count), `web-viewport.e2e.mjs`.

### H · Cropping and recovery — delivered

The crop rectangle is the control: drag it whole, drag any of its eight grips, nudge it with the
arrow keys. Each grip's visible mark stays small while its hit box is the full `--hit-target`, 44 px
on a coarse pointer, per the repository's handle rule. The four numeric fields moved into an **Exact
crop** fold. The pixels a given frame saves are unchanged, which a test on a stubbed canvas pins
down (`800 × 600` cut at 25 / 10 / 50 / 40 % is still `drawImage(…, 200, 60, 400, 240, 0, 0, 400,
240)`).

**Draft changed elsewhere** describes both versions — when each was saved, how many comments it
holds, how many values it has moved from the project's own — and offers the newer one first. The
file service now reports the draft file's `savedAt`, because before this neither side had a date to
compare.

Tests: `ScreenCapture.test.tsx`, `WebRecovery.test.tsx`.

### I · Documentation and this report — delivered

`docs/web-workspace.md` follows every behaviour change: pairing, the deep link, naming and the empty
state, section badges and the path, marks, the review and the handoff, the zoom ladder, cropping and
recovery. `e2e/README.md` gained a **web scripts** section with the eight scripts and the traps that
cost the most time here — the order of the two waits, `networkidle` against an open EventSource, the
cross-origin pointer, the closed shadow root, the toggling popover and the shared draft.

## Where this departs from the prompt

Two readings, and one measurement that did not reproduce. None of them was silent.

1. **The scope badge on a lone section.** The prompt says the badge "does not appear when all the
   visible sections share the same scope", and its own chantier D test expects a card selection to
   show a **Selected element** section with an **All instances** badge — which is a single section,
   trivially sharing its scope with itself. The rule is implemented as: drop the badge once *several*
   sections agree on it, keep it on a lone one. The complaint the diagnostic actually recorded was
   "Global repeated on every section", which is repetition; and on a repeated component the badge is
   the warning that the other cards change too, which is worth a line.

2. **The accessible name in the naming order.** The prompt gives four sources —
   `data-paramrig-label`, the formatted identifier, the text content, `Unnamed <tag>` — and does not
   mention `aria-label`, which the old code treated as a declared label. Dropping it would have made
   an instrumented `<nav aria-label="Fieldnotes navigation">` read as its whole subtree of link text.
   It sits third, after the identifier and before the text content, so the three sources the prompt
   names keep their order.

3. **"Review changes is active during the handshake"**, in the starting diagnostic, did not
   reproduce: the button was already disabled while connecting, because it is gated on a context the
   SDK has not sent yet. Everything else in the diagnostic reproduced exactly, and the before/ record
   holds the measurement.

There is also one behaviour the prompt asked for that is deliberately narrower than it sounds.
**"Review changes returns to its resting state" after approving** is true of everything that was
approved, and not of a control the person deliberately withheld in the review — that is still a
local override the agent has not been told about, so it is still waiting. `web-review.e2e.mjs`
checks exactly that, and the review labels the rows already carried by the previous batch
**Already sent** so the list and the count never disagree without explanation.

## Beyond what was asked

Three things were fixed in passing because they got in the way of the work:

- A preview reloaded during a DOM capture left `pendingCapture` stuck true, which disabled **Review
  changes** for good. The captures are dropped with the frame that was asked for them.
- Pressing **Review** on a workspace whose only differences had already been approved prepared a
  duplicate of the batch the agent was already holding. What is waiting no longer counts a value the
  last approved batch carries.
- `e2e/lib.mjs` waits out an in-flight navigation before probing the page it borrows. Without it the
  first script of a run failed with "execution context was destroyed" whenever the previous run's
  goto was still settling.
- A killed run leaves a recovery copy in IndexedDB ahead of the file on disk, and the workspace then
  refuses every write until a person chooses between the two versions — correct behaviour that
  silently broke any script that met it. `e2e/web-lib.mjs` opens the workspace, takes the project's
  own file when that choice is offered, and clears the comments a script leaves behind; the eight
  web scripts share it.

## What was left aside, and closed afterwards

A second pass went back to the list below and closed all of it but two items. It is
recorded here rather than in a separate document, so the list and its answer stay
together; the work is in the commits after `The exact count the last verification
reported`.

| Left aside in prompt 1 | What happened |
| --- | --- |
| A real agent response | Driven end to end by `web-response.e2e.mjs`, which writes response files exactly as an agent would. **Found one defect**: reopening a comment kept the agent's previous answer on it and carried it into the next batch. |
| Screen capture | Driven by `web-capture.e2e.mjs`, which replaces `getDisplayMedia` and only that with a real `MediaStream` from a canvas. **Found two**: an action's failure was written into the project's connection status, which the next successful save clears; and the fold the kept image lands in was closed. |
| Forced colours | Driven by `web-a11y.e2e.mjs` through `emulateMedia`. **Found two**: a review swatch was painted the system colour, so every colour looked the same; the crop rectangle had no forced-colours treatment at all. |
| Touch | Driven by real touch events over CDP. **Found one**: the page picker stopped at 32 px, Review changes at 36, the folds at 40 and the inspector's icons were 28 wide. All 47 controls the workspace owns are now at least 44. |
| 200% browser zoom | Zoom itself is not a CDP surface. What it leaves — 720 CSS pixels in a 1440 window — is measured, and nothing overflows. |
| Reduced motion | Measured: nothing in the workspace animates. |
| A real mouse below the fold of the frame | **The note was wrong, and the limit is gone.** It was never intermittent and never about scrolling: input aimed at an out-of-process iframe is hit-tested against the real browser window rather than the emulated viewport, and the QA browser opened 1500 × 600 against an emulated 1440 × 900. `--window-size` cannot change it — this build pins the height at 600 — but `Browser.setWindowBounds` can, so `run()` sizes the window before it starts. The same walk down the frame goes from 10 points heard to 20, and `web-select.e2e.mjs` clicks an element 803 px down the page with a real mouse. |

Two things are still out of reach, and will stay there: the browser's own
screen-sharing picker, and browser zoom as a setting. Both need a person.

The 12 shared inspector widgets under 44 px were fixed afterwards, on request. They
belong to the drawing and scene editors as much as to this one, so the changes are
all inside `@media (any-pointer: coarse)` — nothing moves for a mouse — and the two
other editors were re-run: 277 checks across the 19 drawing scripts, 49 across the
scene editor's touch and panel scripts, all passing.

What had to give: a section head is 44 px tall under a finger rather than 16, and
the strip a control row reserves for its context trigger widens from 32 px to 48,
because the panel clips at its own edge and a trigger hanging past it is hit-tested
nowhere. The reset mark keeps its 6 px dot inside a 44 px button. A colour row could
not hold a 44 px chip, a 44 px reset, eight characters at 16 px, a 44 px button and
its own name, so under a finger the name takes a line of its own — squeezing it
instead had produced "Prim…". `web-a11y.e2e.mjs` measures what answers a tap rather
than what is drawn, since several of these keep a small mark in a larger box, and it
is now a check rather than a report.

## What could not be verified (as written at the end of prompt 1)

The list the second pass then went through. Headless, on this machine, with the
harness available:

- **Screen capture.** `getDisplayMedia` has no headless equivalent and no synthetic replacement. The
  cropping is covered by a component test on a stubbed canvas; acquiring the frame, the permission
  prompt and the stream stopping after one frame are untested here and need a person at a real
  browser.
- **A real mouse below the fold of the cross-origin frame.** A pointer driven over CDP arrives at the
  top of the frame and then goes astray after a scroll: the parent receives the `pointerdown` with
  the `<iframe>` as its target and the frame sees nothing. Every pointer check therefore dispatches
  its events inside the frame, which exercises the SDK's handlers exactly but not the browser's own
  hit-testing through the frame boundary. Hovering, selecting and drawing with a real mouse below
  the fold want a person.
- **A real agent response.** `session.response()` and the review of a correction are covered by unit
  tests with a synthetic response; no agent actually read a batch and wrote one back during this
  work.
- **Forced colours.** `forced-colors: active` cannot be emulated through the CDP harness in use here.
  The rules in `web.css` are unchanged and untested.
- **Touch.** No coarse-pointer pass was made. The 44 px targets are declared in CSS and were not
  measured under a finger.
- **200% browser zoom** and **reduced motion** were not swept; they are in the acceptance list of
  `docs/web-workspace.md` and remain a person's job.

Everything else was checked in a real browser: 1440, 1024 and 390 px in both themes, with a check
that nothing overflows sideways in any of the six combinations, and zero console errors in all eight
scripts.

## Verification at the last commit

```sh
docker compose run --rm app npm run typecheck      # clean
docker compose run --rm app npm run lint           # clean
docker compose run --rm app npm test               # 239 files, 3411 tests
docker compose run --rm app npm run test:web-service
docker compose run --rm app npm run build:web-sdk
docker compose run --rm app npm run e2e -- web-    # 8 scripts
docker compose run --rm app npm run e2e -- chantier-   # the drawing editor, for the shared Tooltip
git diff --check
```

The final pass on the shared QA Chrome at 9223: **94 checks across 8 scripts, none failing**.

A note on that browser: it is shared, and another agent was driving it through the scene campaign
for most of this session. Runs that collided with it failed with "execution context was destroyed",
"page crashed" or a socket hang-up — never with a check. The web scripts were therefore developed
against a second headless Chrome on 9224, started with its own profile and stopped afterwards, and
the final passes were made on 9223, where the whole suite is green.
