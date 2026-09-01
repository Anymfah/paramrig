# Timeline and workspace UX verification — 2026-08-31

## Follow-up: context menus and panel resizing

The initial pass missed keyframe/background context menus and left the resize
handle positioned against a different height from the rendered panel. These
were corrected in the follow-up, rather than treating the first pass as complete.

- Keys: go to key, copy, outgoing easing and delete. A right-click inside an
  existing multi-selection preserves it; an outside key becomes the target.
- Tracks: add at the clicked time, select/copy/paste, hide, reset and delete.
- Groups: select group keys or hide group tracks. Ruler: cursor, In/Out range,
  clear range and paste at the clicked time. Shift+F10 also opens the menus.
- Resize grip now lives on the panel itself, stays at its actual top edge,
  supports pointer cancellation and keyboard control, and works on mobile.
  A visible Expand/Compact button offers an alternative. Height is limited
  by the viewport rather than the previous 360 px cap and persists on reload.
- Browser checks: key deletion/undo; multi-selection context; easing/undo;
  key context copy and ruler paste at 4 s/undo; hide/show track; ruler In at
  4 s; keyboard expansion to 520 px at 1280×720; drag from 280 to 447 px and
  reload retention; mobile expansion to 552 px at 375×812; mobile track menu;
  key drag from 2.400 to 3.167 s and single undo back to 2.400 s.
- Follow-up validation: 63 tests across 11 files, lint, production build and
  diff checks passed. No browser console errors observed. The existing lazy
  Three.js chunk-size warning remains. Mobile checks are browser emulation.

[Expanded timeline with key context menu](2026-08-31-timeline-context-resize.png)

The sections below record the earlier pass.

Verified on the running local Docker app at `http://localhost:5174/`.
The ANYM editor at `http://localhost:3050/editor` was inspected as a read-only
interaction reference. Its repository and saved scene were not modified.
ParamRig's existing identity, compact navigation, controls and intentional
departures from the original mockups were retained.

## Corrections

- Editable grouped timeline with aligned ruler, curves and playhead, sticky
  track labels, horizontal zoom, multi-selection, keyframe dragging, exact
  time/value editing, outgoing easing, copy/paste/delete and track visibility.
- Bounded playback range and loop controls; the last key remains editable
  with looping enabled. Playback ranges persist in drafts and exports.
- One history entry per gesture, cancellation on Escape/interruption,
  undo/redo shortcuts, and a navigable history of the last 100 actions.
- Snapshot naming, removal and restoration, including the active snapshot,
  are undoable. Reference comparison samples both animations at the same time.
- Numeric values are no longer truncated. Gradient stops have individual
  color and position editing, drag support, and add/remove controls.
- Reset stays in the right-click menu. Shift+F10 and touch actions provide
  equivalent access. Documentation is now a direct, correctly labelled link.
- Mobile navigation closes when selecting a rig. Hidden panels are inert.
  Compare controls no longer overlap the preview caption. The planet fits
  narrow views; HTML material plates fit and remain centred.
- SVG/HTML previews update on playback ticks when numeric tracks are added.
  Surface-study controls honour zero values.

## Browser evidence

Desktop checked at 1280×720 in dark and light themes. Mobile layouts checked
at 375×812 and 320×740. The document remained the viewport width; timeline
zoom expands only its own scrolling area.

| Workflow | Observed result |
| --- | --- |
| Drag Rotation Y middle key | Moved from 2.40 s to 3.17 s; one undo restored 2.40 s |
| Exact key time | Editing to 3 s moved the key; undo restored its original time |
| Copy/paste over final key | Value 108 replaced 360 at 8 s; one undo restored 360 |
| Snapshot restore | Seed 5000 restored to 4817; undo recovered 5000 |
| Gradient stop drag | Middle stop moved from 50% to 69%; one undo restored 50% |
| Keyboard reset | Shift+F10 opened Seed actions; reset restored 4900 to 4817 |
| Playback range | In 2 s / Out 4 s looped within that interval and survived reload |
| Mobile navigation | Selecting Surface studies returned to Preview with navigation inert |
| Mobile actions | Seed actions opened Reset Seed, not another control's menu |
| Small previews | Planet, SVG bloom, typography and all three material plates were visible |
| Zoom | Ruler, keys and playhead remained aligned at 225%; Fit returned to 100% |
| Browser errors | No console errors in the checked session |

Captures:

- [Desktop timeline](2026-08-31-timeline-desktop.png)
- [320 px timeline with key editor](2026-08-31-timeline-mobile-320.png)
- [375 px inspector](2026-08-31-inspector-mobile-375.png)

## Automated verification

`docker compose run --rm --no-deps app sh -c 'npm test && npm run lint && npm run build'`

- 55 tests passed across 10 files.
- Lint and production build passed.
- `git diff --check` passed.
- The existing lazy Three.js bundle still triggers Vite's 500 kB chunk warning.

Regression tests cover pointer completion outside the original key/gradient
handle, cancelled gestures, relative paste timing, collisions, snapshots and
reference restoration, history navigation and retention, keyboard/touch menu
entry points, finite numeric input, and clock-driven SVG rendering. Keyboard
clipboard shortcuts are covered in component tests; the browser automation's
virtual clipboard intercepts them, so the real browser copy/paste workflow
was verified through the visible timeline actions.

## Limits

This is local integration, without a commit or deployment. Existing unrelated
working-tree edits were preserved. Mobile checks use resized browser viewports,
not a physical touch device. History resets on reload; drafts and snapshots
use browser storage. Track visibility, selection and the keyframe clipboard
are transient. This does not introduce ANYM's scene-specific tracks, source
file watching, authentication, or a source write-back/export backend.

## Follow-up: row controllers in timeline context panels

Right-clicking a key now opens its parameter controller with the key's time,
value, bounds, step and unit. Right-clicking a track label uses the playhead;
right-clicking a blank track uses the clicked time. Opening alone does not
create a key. Editing the row controller sets a key at that time. Existing
copy, easing, selection and removal actions remain below the controller.

Browser verification on `/r/tidal-planet` confirmed the Rotation Y controller,
editing 108° to 150° at 2.40 s, undo back to 108°, keyboard slider adjustment,
discarding an uncommitted 170° draft with Escape, and the distinct Cloud drift
row controller. No console errors were returned. Native slider pointer input
did not produce a value change through the browser automation in this pass;
pointer transaction grouping and interruption are covered by component tests,
not claimed as browser-verified here.

The complete suite passed 81 tests across 17 files, with lint and production
build passing. New regressions cover editing only the clicked key, copying its
updated value, one undo per slider gesture, cancellation without losing redo,
row insertion time, actions including newly inserted keys, and Escape draft
cancellation. Work remains local, without a commit or deployment.
