# ParamRig branding board — proposal 02, monochrome

English-language static identity study, August 2026.

Typography status: superseded for review. The founder explicitly rejected IBM
Plex Mono and the default-looking AI/dev typography direction. Manrope is not
approved. See `../typography/` for the subsequent two-candidate study; do not
treat the typefaces in this historical board as the current specification.

The founder rejected the citron accent and requested a monochrome base. The
current board removes it from the palette, reversed logo, controls, preview art
and social cover. No replacement accent is proposed in this revision. The
previous board is archived in
`workproduct/brand-identity/paramrig/reference/branding-board-01/`.

- `paramrig-branding-board.png`: high-resolution export, 3200 × 4080 pixels.
- `paramrig-branding-board.svg`: standalone vector board, all lettering outlined.
- `paramrig-branding-board-preview.png`: 1200 × 1530 preview.

## Approved versus proposed

The Coform symbol and custom ParamRig wordmark were approved by the founder.
Their geometry is embedded directly from the canonical SVG masters, unmodified.
The horizontal arrangements shown here are proposed applications of those marks.

The palette, supporting typefaces, messaging, editor appearance and social cover
are proposals, not an approved design system or implemented product. The editor
is a static graphic: it has no working controls. No website was built or deployed.

| Color | Hex | Proposed use |
| --- | --- | --- |
| Carbon | `#1C201C` | Primary ink and dark canvas |
| Chalk | `#F4F3EB` | Light canvas and active controls on dark |
| Stone | `#C8CCC0` | Supporting neutral |

Use Carbon text on Chalk and Chalk text on Carbon. The understated neutral
undertones are retained; “monochrome” here means no chromatic accent, not a
strict RGB grayscale conversion. This board is an sRGB digital proposal; it does
not claim CMYK or Pantone print equivalents.

## Typography and sources

- Manrope, variable weights 450 and 650: titles and interface copy. Its geometric
  construction complements the custom lettering without substituting for it.
  [Font source](https://github.com/google/fonts/tree/main/ofl/manrope).
- IBM Plex Mono Regular: parameters, numerical values and technical labels.
  [Project source](https://github.com/IBM/plex),
  [font distribution](https://github.com/google/fonts/tree/main/ofl/ibmplexmono).

Both downloaded font files and their OFL notices are retained at the
repository-relative path `workproduct/brand-identity/paramrig/branding-board/fonts/`.
The board itself needs no installed fonts and makes no network requests.

## Reproduction and checks

Source: `workproduct/brand-identity/paramrig/branding-board/build_board.py`
(FontTools), then `render_board.cjs` (Sharp).

`qa.json` records canonical master hashes, outlined-text bounds and contrast
checks calibrated against black/white (21:1) and identical colors (1:1).
The exported board was visually inspected for layout, glyphs and clipping.
This does not constitute keyboard, responsive or live-application QA.

No changes were made to ANYM, Helios or Stellary.
