# ParamRig UI implementation — QA notes

Device: Playwright CLI Chromium, Vite `http://localhost:5173/`.
Playback profile (unthrottled): viewport 1440×900, no CPU throttle, no network throttle.
Playback profile (throttled): viewport 1440×900, CPU 4×, Slow 4G (CDP).

## Automated (2026-08-31)

- `npx vitest run` — 11 tests passed (includes keyframe edit dirty + snapshot restore of tracks)
- `npx eslint src --max-warnings 0` — pass
- `npx tsc -b --noEmit` — pass
- `npx vite build` — pass. Main 394 kB / 128 kB gzip; Three.js lazy chunk 885 kB / 237 kB gzip.

## Logo masters (unchanged)

- `paramrig-coform-symbol.svg` `60881480cf56de25c2acb3833d13f95b61b5862d18231d2616f22878670e3e22`
- `paramrig-wordmark.svg` `93ec13f12e1905aa1f9cd616858e4d6fdb04a598b5a084c24b3d549744c7ee78`
- `paramrig-coform-logo.svg` `ee76542210ebbc3f797bc95c025c2d64d521f53c41f439ee9b8fd885decb88f9`

## Implemented and verified

- Library, fixtures (empty / error / loading / long), Open rig, search. Loading fixture holds the skeleton (`/?fixture=loading` never resolves). Empty copy is a single fixture sentence (the grid note is omitted). Long-name cards reuse the Contour bloom thumb and wrap. Search count is hidden while loading so it does not flash “0 rigs”
- Unknown rig `/r/missing-rig` keeps the light library shell, the rig rail, and Back to library (a missing `RigNavigation` import had blanked the page)
- Inspector Snapshots: empty panel uses one filled “Snapshot current values”; a list shows English stamps (`31 Aug, 03:25`), Active vs Restore, and Restore moves `aria-current`
- SVG: exact numeric entry, curve coordinates, undo one gesture, export JSON matches live state
- No native `<select>` / `input[type=color]` / `title=` in closed or open states (Interpolation listbox = Linear / Step)
- Workspace `h1`; preview chrome is status (`SVG preview` / `Fit to stage` / `HTML preview` / `Live layout` / `Perspective · Lit`)
- Back/Forward preserves theme (library light, editor dark)
- Viewports 1600 / 1280 / 768 / 375 / 320; zoom 200%; forced-colors; reduced-motion
- Keyboard: first Tab shows Skip to preview; Undo tooltip + 2px Stone `:focus-visible`; Escape dismisses tooltip; Export popover + Escape restore
- Inspector tabs: roving tabindex, Arrow / Home / End; ArrowRight on Controls opens Bindings; `key={rigId}` so Controls resets when switching rigs
- Full Tab order, SVG editor (recount 2026-08-31 after Exact coordinates + Original/Current): **53** in-page stops. First is Skip to preview. Stone `rgb(200, 204, 192)` 2px outline on chrome and inspector controls including curve handles and the Exact coordinates disclosure. Export uses the separated ring (`box-shadow` surface + Stone). Bindings/Snapshots are arrow keys, not extra Tab stops. Playwright then reports `BODY` once at the end of the cycle (focus leaving the page), which is not an extra in-page control
- Full Tab order, 3D editor: **82** in-page stops with two editor tabs open (Contour bloom + Tidal planet, including Close). Includes Play, Loop, Playhead, nine keyframes, Interpolation, Elevation palette stops, Hide timeline, and three resize handles. A session with only Tidal planet open is fewer stops (no Close / extra tab)
- Type specimen preview is Carbon `rgb(28, 32, 28)` on Chalk canvas `rgb(244, 243, 235)` — previously inherited chalk-on-chalk and was invisible
- Gradient and select fields have per-parameter reset (Elevation palette, Interpolation)
- **Playback clock lives on the session, not in React.** Playhead advanced 0.23s → 1.07s over 800 ms (lockstep). rAF: 92 frames / 800 ms, median 8.3 ms, p95 9.1 ms, max 50 ms. Inspector Rotation Y reached 47°. Header/nav do not re-render on clock ticks. Displayed time snaps to 30 fps; interpolation uses full-resolution time so 8 ms frames are not eaten by rounding
- Keyframe at 2.40 s snaps Rotation Y to 108° and pauses. Displayed time is `02.40 / 08.00 s`
- Slider drag on Lobes: 6 → 13 in 12 pointer samples; the numeric field matched. Viewport 1440×900, no throttle
- Export download `tidal-planet.paramrig.json` contained `animation.playhead: 2.4` and live `rotationY` / `lightAngle`, not hardcoded examples
- Hidden tab pauses playback (`visibilitychange`)
- Orbit controls share the Three.js frame loop instead of a second `requestAnimationFrame`
- Docs page keeps the rig navigation; in-page link is Carbon (`rgb(28, 32, 28)`), not browser blue
- Inspector Reset on animated parameters uses stored values, so a later playhead does not look dirty
- Inspector keyboard resize: arrows change width; Home collapses to 0px (`visibility: hidden`); Show inspector restores the stored width
- Timeline Hide is a quiet text control next to the title (not a chevron beside `30 fps`). Show timeline stub still restores the panel
- Track values use each parameter’s `unit`, not rig-id conditionals in the shell
- **Playback 4× CPU + Slow 4G** (Playwright CDP, viewport 1440×900): playhead 0 → 1.10 s over an 800 ms wait (wall-clock deltas). 41 frames, median 18.6 ms, p95 52 ms, max 276 ms. Pause control present. Unthrottled earlier: 92 frames / 800 ms, median 8.3 ms. Do not treat either as universal 60 fps
- Switching rigs stops playback (workspace unmount). Console: 0 errors after Surface studies → Tidal planet (session `emit` is deferred off the render path)
- Snapshot → edit Lobes 6→15 → Original preview has 6 radial peaks, inspector stays at 15 → Current has 15 peaks → Restore returns “No changes since the current snapshot”
- Switch “Hairline edge” has a reset control and a filled on-state; toggling it marks one value changed
- Export copy reports “Copied the current parameter JSON.” without a fallback textarea (clipboard write succeeded). Download was verified earlier. Popover width is `--inspector-width`, not an inline 320px
- Number fields use `cursor: text` on the padded box; stepper buttons keep `pointer`
- Workspace shell is viewport-locked (`height: 100dvh`). At 1440×900 the SVG and 3D editors report `scrollHeight === 900` with no horizontal overflow. At 320×640 the 3D editor also reports 320×640 with the mobile dock present
- Original / Current sits on the preview stage (bottom center) for SVG and HTML. After Snapshot → Lobes 15, Original is pressed, inspector stays at 15, status still reads “1 value changed”
- `previewNumber` follows Original/Current; `liveNumber` stays on the interpolated current value so inspector sliders do not snap back
- 3D stage frames a full globe plus two thin rings (camera `[0.18, 0.26, 5.7]`, fov 26). Hemisphere + directional light. Screen-space XYZ overlay is orientation chrome, not a manipulator. Terrain is ridged spherical FBM with elevation contour lines; color/bump textures skip mipmaps so the lines stay sharp
- Type specimen, canvas-calibrated: Carbon `rgb(28, 32, 28)` on Chalk `rgb(244, 243, 235)`, contrast **14.82:1**
- Editor chrome no longer uses the browser’s default `button` padding (that was the 6px off-scale hit). Header crumbs `margin: 0` (was UA 13px)
- SVG canvas labels: name top-left, `800 × 600` bottom-right. Original/Current stays on the SVG/HTML stage
- 3D Original/Current lives in the status row, not on the globe. Caption is bottom-left (`Tidal planet / Surface, atmosphere and orbit`). XYZ overlay is 32×32 at the canvas corner (a prior `preview-stage > svg { width/height: 100% }` rule had stretched it over the planet)
- Editing Rotation Y at 2.40 s writes the keyframe (108 → 120). Snapshots now store tracks; dirty state and Restore include them. Playhead-only motion still does not mark dirty
- Spacing audit on SVG editor at 1440×900: 7 padding values, 4 gaps, 3 line-heights. Remaining off-scale rows are 1px hairline padding, auto-centering margins, and −1px optical icon shifts
- Viewports 1600 / 1280 / 768 / 375 / 320 recaptured on Tidal planet after the mobile clamp: no horizontal overflow. Dock is `none` at 1600/1280, `flex` at 768/375/320. At 768 the timeline still shows title / fps / ruler (breakpoint is `< 48em`). Library at 320 uses placeholder “Find a rig” (the longer mockup string clipped). Logo hashes unchanged. Production build pass (main 397 kB / 128 kB gzip; Three.js lazy 886 kB / 238 kB gzip). Docs recaptured. Bindings lists export keys. Ink picker is a custom SV plane (`input[type=color]` = 0). Interpolation listbox is Radix. `prefers-reduced-motion` sets `--duration-fast` to `0.01ms`
- 3D terrain uses spherical ridged FBM + bump (384²) with elevation contour lines; color/bump skip mipmaps. Two thin rings. Atmosphere Density is in view at 1440×900 without scrolling the inspector
- Elevation palette: handles sit on the bar; Stop 1–3 sit in a three-column row (not a stacked stack of ColorFields)
- Inspector density at 1440×900: number field and slider share a row. SVG Surface **Ink** is fully on screen; the Edge softness curve graph fits above the footer (`curveFits: true`). Exact coordinates are behind a disclosure. Touch (`any-pointer: coarse`) stacks the slider under the number field again
- Interpolation Select uses `sideOffset={8}` (on-scale), not 6px. Open state is a Radix `listbox` with Linear / Step — `document.querySelectorAll('select').length === 0`
- 3D inspector at 1440×900 without scrolling the panel: Stop 1–3, Density, and Light direction are in the inspector body (`Light direction` bottom 788 / inspector 868). Animation (Rotation Y / Interpolation) stays below the fold — the timeline is the editing surface for those
- Library / SVG / 3D / type specimen recaptured at 1440×900; Tidal planet recaptured at 320×640 and 375×812 (`scrollWidth` matches the viewport). At 320 the preview stage is ~205px tall: timeline height is clamped in the shell (not written to prefs), the ruler / “Timeline” word / `30 fps` hide below 48em so Rotation Y and Cloud drift stay on screen (Light direction scrolls). Export shortens to “Export”. Disabled Reset is omitted so the snapshot sentence can ellipsis. Caption is two lines on the globe. 200% CSS zoom: header, Export, and Inspector head stay in view. Forced-colors recaptured on the SVG editor

## Implemented, only partly verified

- Touch / `any-pointer: coarse` on a physical device (CSS 44px targets exist; CDP `any-pointer: coarse` did not flip `matchMedia`). Mobile dock is `flex` at 375px
- Range *pointer-drag* (HTML5 `draggable` is absent by design); +/- , track clicks, and Home/End work
- **Human visual acceptance** against `assets/ui-mockups/` is still required. Known honest differences: preview chrome is status text, not fake Preview/SVG tabs; animated-parameter counts are per inspector group; the XYZ overlay is a static orientation mark, not an interactive gizmo; library Contour bloom is 7 parameters / no tracks (the mockup showed 18 / 3); 3D inspector puts sliders beside numbers so Surface + Atmosphere fit; at 320 the Export label is “Export”, the timeline hides its title / fps / ruler, and the third track scrolls; library search placeholder is “Find a rig” so it is not clipped

## Intentional limits

- Bundled registry, not a filesystem watch
- Export does not write back to project source
- 3D is a bounded study
- No auth, AI chat, telemetry, marketing
- Do not treat this file as AAA or a11y certification

## Screenshots

- `01-library-1440.png` / `library-320.png`
- `library-no-results.png` / `library-loading.png` / `library-long-names.png` / `library-empty.png` / `library-error.png`
- `02-svg-editor-1440.png` / `02-svg-editor-color.png` / `02-svg-editor-after-theme-fix.png` / `02-svg-editor-honest-toolbar.png`
- `html-surface-studies.png` / `html-hairline-off.png` / `html-type-specimen.png`
- `docs-1440.png` / `unknown-rig.png` / `inspector-bindings.png` / `inspector-snapshots-empty.png` / `inspector-snapshots.png`
- `keyboard-undo-focus.png`
- `03-tidal-planet-2.4s.png` / `tidal-planet-keyframe-2.4s.png` / `interpolation-open.png`
- `tidal-planet-1600.png` / `1280` / `768` / `375` / `320` / `zoom-200`
- `contour-bloom-320.png`
- `forced-colors-svg-editor.png`
