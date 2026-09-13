# Artwork font sources

The graphic-charter rig uses Public Sans (the existing default), Space Grotesk and Source Serif 4.
These are artwork choices; application chrome remains unchanged.

- Space Grotesk: https://github.com/google/fonts/tree/main/ofl/spacegrotesk
- Source Serif 4: https://github.com/google/fonts/tree/main/ofl/sourceserif4

Retrieved 2026-09-12. Original SIL Open Font License files are included alongside each family.
The distributed TTF and WOFF2 files are subsets of the upright variable masters, keeping
U+0000–024F, U+2000–206F, U+20AC and U+2190–21FF, with all layout features.
Source Serif 4's optical-size axis is fixed at 20 to reduce transfer size and keep
the same optical design in browser rendering and PDF outlines; its weight axis remains variable.
WOFF2 serves the canvas and SVG/PNG exports; TTF supplies PDF glyph outlines.
They are served from this application's origin, without a third-party font request.
