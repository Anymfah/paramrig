# ParamRig — typography study

Two candidates following the founder's rejection of default-looking AI/dev
typography, specifically IBM Plex Mono. Both candidates were subsequently rejected
as too familiar. This comparison is retained as historical evidence only.

- A: [Uncut Sans](https://github.com/kaspernordkvist/uncut_sans), Kasper Nordkvist.
- B: [Familjen Grotesk](https://github.com/Familjen-Sthlm/Familjen-Grotesk).

This is an aesthetic comparison, not a claim about measured frequency of use
by AI systems. Neither a monospace nor Manrope is used in this new specimen.
The custom ParamRig wordmark is embedded unchanged, not set in either font.

Both columns use identical content, colors, point sizes, weights and layout.
Headings are 64px/600, body is 20px/400, controls are 16px/400. The glyph-detail
line uses 64px/500. HarfBuzz supplies actual shaping/kerning, then FontTools
outlines the glyphs into a standalone SVG. No installed font is needed to view
the result. This is a static graphic, not a working application screen.

Exports: vector SVG, 3200 × 2400 PNG, 1200 × 900 preview.

Build scripts, downloaded fonts and their original license notices live in
`workproduct/brand-identity/paramrig/typography-study/`. No font files were
modified. The build checks missing glyphs and bounds, calibrates single-glyph
advance against the font metric, and records logo hashes in `qa.json`.

The current branding board in `../branding-board/` explores Public Sans after
the founder named Apple as a reference for restraint and clarity. That new
proposal is pending review; it does not change the approved custom wordmark.
