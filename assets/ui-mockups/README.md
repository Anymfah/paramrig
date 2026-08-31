# ParamRig — desktop UI concepts

Three static, English-language proposals using the approved Coform masters,
Public Sans, and Carbon / Chalk / Stone identity. These are review artwork,
not application screenshots or a working prototype. Sample names, filenames,
parameter counts and values illustrate the intended workflow; the `.rig.tsx`
extension is a proposal, not an implemented API.

1. **Rig library** — browse project-discovered rigs; inspect a selected rig and
   open it. The selection panel explains its renderer, controls and source.
2. **SVG editor** — large live-preview concept with grouped controls, explicit
   values, snapshot comparison and a custom curve control.
3. **3D editor** — the same shell with an illustrative procedural planet,
   elevation gradient, atmosphere controls and a keyframe timeline.

The library is light; the two editor concepts use dark chrome. This is a visual
comparison, not a final theme-switching policy. The planet's colors belong to
the editable artwork, not to a new ParamRig brand accent. The bloom and planet
are vector illustrations; they do not prove an SVG binding or WebGL renderer.

## Files

Each numbered view has a standalone outlined SVG, a 3200 × 2000 PNG, and a
1280 × 800 preview. `overview.png` presents all three views together.

## Scope

No app framework, server, routing, renderer, AI integration, accounts, cloud
features, mobile views or working controls were implemented. Snapshot, export,
search and timeline behavior shown here remains proposed. No other repository
was modified. The canonical logo files remain byte-for-byte unchanged.

## Reproduction

Run `workproduct/ui-mockups/build_mockups.py` with Python, FontTools and
uharfbuzz, then `workproduct/ui-mockups/render_mockups.cjs` with Node and Sharp.
The scripts use the existing bundled Public Sans file; its original SIL Open
Font License notice remains beside it in the brand workproduct directory.
No font install or network access is required to view the outputs.

The QA report records text ink bounds, calibrated contrast checks and master
hashes. Raster exports are visually inspected. This is static artwork QA only,
not keyboard, responsive, runtime or production acceptance testing.
