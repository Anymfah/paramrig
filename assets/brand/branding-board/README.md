# ParamRig branding board — proposal 03, restrained typography

English-language static identity study, August 2026.

Typography status: Public Sans is proposed, pending founder review. The founder
rejected IBM Plex Mono, then Uncut Sans and Familjen Grotesk, and named Apple as
the aesthetic reference. This revision interprets that as restrained typography,
clear hierarchy and breathing room, not copying Apple assets or its typeface.

The founder rejected the citron accent and requested a monochrome base. The
current board removes it from the palette, reversed logo, controls, preview art
and social cover. No replacement accent is proposed in this revision. The
previous boards are archived in
`workproduct/brand-identity/paramrig/reference/branding-board-01/` and
`workproduct/brand-identity/paramrig/reference/branding-board-02/`.

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

- Public Sans, weights 400 and 600: headings, prose, labels and controls.
  Parameter values use its tabular numerals, not a separate monospace.
  [Project source](https://github.com/uswds/public-sans),
  [font distribution](https://github.com/google/fonts/tree/main/ofl/publicsans).
- The approved custom wordmark remains an independent vector drawing.

The downloaded font and its SIL Open Font License 1.1 notice are retained at the
repository-relative path `workproduct/brand-identity/paramrig/branding-board/fonts/`.
Earlier rejected font files remain there only to reproduce historical studies;
the active board does not use them. No font file has been modified.
The board itself needs no installed fonts and makes no network requests.

## Reproduction and checks

Source: `workproduct/brand-identity/paramrig/branding-board/build_board.py`
(FontTools and uharfbuzz), then `render_board.cjs` (Sharp).

`qa.json` records canonical master hashes, outlined-text bounds and contrast
checks calibrated against black/white (21:1) and identical colors (1:1).
HarfBuzz supplies kerning and glyph positioning before outlining; its advance
is calibrated against the font's single-H metric at both selected weights.
The exported board was visually inspected for layout, glyphs and clipping.
This does not constitute keyboard, responsive or live-application QA.

No changes were made to ANYM, Helios or Stellary.
