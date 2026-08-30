# ParamRig — Coform

Cleaned vector masters of the Coform direction selected by the founder.

- `paramrig-coform-symbol.svg`: the two-part symbol, 333 × 281 viewBox.
- `paramrig-wordmark.svg`: custom drawn lettering, 383 × 86 viewBox.
- `paramrig-coform-logo.svg`: stacked symbol and custom wordmark,
  383 × 404 viewBox. The symbol position and lettering region are preserved.

All three files contain only vector geometry, have transparent backgrounds, and use
`currentColor` (black by default). No embedded raster, external resource, or font
is required. When inserted inline, set CSS `color` to recolor the artwork.
For a standalone white asset, replace the root `fill="currentColor"` with
`fill="#fff"`. Parent-page `color` does not cross an `<img>` boundary.

The current wordmark is drawn from explicit vector geometry in the spirit of the
approved reference, not traced or substituted with a font. This does not identify
or select a typeface for application text.

## Wordmark reconstruction

The founder rejected the lightly smoothed lettering because it retained bumps
and irregular joins from the generated image. The lettering is now rebuilt with
straight stems, regular bowls and counters, identical repeated `a` glyphs, and a
circular `i` dot. P and R share an upper-bowl construction. Terminals are squarer
than the earlier trace; this is a visible cleanup, not a pixel-identical replica.
The accepted Coform symbol is unchanged, including its placement in the logo.

`paramrig-wordmark.svg` and `paramrig-coform-symbol.svg` are the editable masters.
`clean_coform.py` composes them into the full logo without raster input.
`render_wordmark.cjs` produces the before/after and light/dark previews in
`../../workproduct/brand-identity/paramrig/wordmark-qa/`. The earlier smoothed
version remains in `reference/svg-v2/`.

After positive founder feedback, a final detail pass harmonized the two inner
arches of `m`, matched the round bowl of `g` to `a`, and refined the parallel
edges of the `R` leg. Spacing, dimensions and the Coform symbol remain unchanged.
The first drawn wordmark is archived in `reference/svg-v3/`. Run
`render_wordmark.cjs --polish` for this pass's comparison and scale previews in
`wordmark-polish-qa/`. The founder approved this refinement before requesting
the branding board. See `branding-board/` for the subsequent palette and type
proposal; those additions are not yet approved.

## Optical cleanup

At the founder's request, the v2 files removed the small irregularities that
the initial trace inherited from the generated PNG. The symbol uses 17 cubic
curves instead of 55, with explicit horizontal/vertical segments and aligned
tangents. Its two masses, asymmetry, negative-space P, original size and placement
are retained. The original lettering was gently smoothed, not replaced by a font.

The symbol is 870 bytes (previously 2,735), and the v2 complete logo is 7,245 bytes
(previously 11,691). The largest sampled outline movement versus the original
trace is 1.36 source pixels. This is intentional optical cleanup, not the earlier
pixel-fidelity deliverable. The upper tip of the right mass remains an intentional
sharp point; all other symbol joins have aligned tangents within 0.03 degrees.

Before/after, 12× detail crops, 16–64px examples, dark renders and calibrated
measurements are stored in `../../workproduct/brand-identity/paramrig/cleanup-qa/`.
The original traced SVGs are preserved in
`../../workproduct/brand-identity/paramrig/reference/svg-v1/`.

`render_cleanup.cjs` and `verify_cleanup.py` reproduce the historical v1-to-v2
checks against the archived files. Historical tracing scripts write only to the
archived v1 directory, not to the current masters.

## Historical v1 fidelity and source

Reference: `../../workproduct/brand-identity/paramrig/reference/coform-approved-board.png`.
SHA-256: `64a4172924498b1d93d21adc56fd5f221717dc60eca51438c2b1f71bf3728bbd`.

The archived v1 files are faithful reconstructions, not original vector masters.
The raster's slight asymmetry and local curvature are preserved in v1. No geometric
redesign or font replacement was made. The PNG's background, noise and exact
antialiasing are not reproduced; literal per-pixel identity is not claimed.

Verification uses the actual SVG rasterized through Sharp/librsvg at native
and 4× dimensions. Foreground masks use a 50% luminance threshold. Edge distances
are symmetric nearest-neighbor distances between densely sampled 50% contours,
expressed in source-image pixels, not a guarantee for every browser rasterizer.

| Asset | Foreground intersection / union | 95th-percentile edge distance | Maximum sampled edge distance |
| --- | --- | --- | --- |
| Symbol | 99.8819% | 0.148 px | 0.249 px |
| Stacked logo | 99.7092% | 0.147 px | 0.279 px |

The measuring pipeline was calibrated against an exact rendered 40 × 40 pixel
square, identity overlap, and a known one-pixel shift. Light/dark and 16–768 pixel
renders were inspected. At favicon size, the symbol is preferable to the full
stacked logo; no optically redrawn small-size alternate is included.

Evidence: `../../workproduct/brand-identity/paramrig/vector-qa/comparison.png`,
`results.json`, and `manifest.json` in that same folder. Conversion and validation
scripts are kept under `workproduct/brand-identity/paramrig/` for reproducibility.

No palette, application typography, site implementation, or trademark clearance
is included in this asset delivery.
