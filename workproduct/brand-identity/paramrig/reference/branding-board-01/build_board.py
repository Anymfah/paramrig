"""Static brand study. Original logo masters are embedded unchanged, not redrawn.

Run with FontTools installed, then render the standalone SVG with Sharp.
Text is outlined from the bundled OFL fonts; no font installation is required
to view the result. This is artwork, not a functional application prototype.
"""
from pathlib import Path
from html import escape
from hashlib import sha256
import json
import xml.etree.ElementTree as ET
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
ASSETS = ROOT / 'assets/brand'
OUT = ASSETS / 'branding-board'
OUT.mkdir(exist_ok=True)
INK, PAPER, STONE, LIME = '#1C201C', '#F4F3EB', '#C8CCC0', '#D8F36A'
MUTED, LINE, PANEL = '#62695E', '#D7DAD0', '#E8EBE2'
fonts = {
    'regular': TTFont(HERE / 'fonts/Manrope.ttf'),
    'bold': TTFont(HERE / 'fonts/Manrope.ttf'),
    'mono': TTFont(HERE / 'fonts/IBMPlexMono-Regular.ttf'),
}
glyphsets = {k: f.getGlyphSet(location={'wght': 650 if k == 'bold' else 450})
             for k, f in fonts.items()}
parts, text_bounds = [], []


def rect(x, y, w, h, fill, r=0, stroke=None):
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"'
                 + (f' stroke="{stroke}"' if stroke else '') + '/>')


def line(x1, y1, x2, y2, color=LINE, width=1):
    parts.append(f'<path d="M{x1} {y1}L{x2} {y2}" fill="none" stroke="{color}" stroke-width="{width}"/>')


def text(value, x, y, size=18, face='regular', fill=INK, tracking=0, maxwidth=None):
    font, glyphs = fonts[face], glyphsets[face]
    scale = size / font['head'].unitsPerEm
    cmap, cursor, shapes = font.getBestCmap(), 0, []
    bounds = [float('inf'), float('inf'), -float('inf'), -float('inf')]
    for char in value:
        assert ord(char) in cmap, f'Missing glyph: {char}'
        glyph = glyphs[cmap[ord(char)]]
        pen = SVGPathPen(glyphs)
        glyph.draw(pen)
        b = BoundsPen(glyphs)
        glyph.draw(b)
        if b.bounds:
            x0, y0, x1, y1 = b.bounds
            bounds = [min(bounds[0], x + cursor + x0 * scale),
                      min(bounds[1], y - y1 * scale),
                      max(bounds[2], x + cursor + x1 * scale),
                      max(bounds[3], y - y0 * scale)]
        shapes.append(f'<path transform="translate({cursor:.4f} 0) scale({scale:.6f} {-scale:.6f})" d="{pen.getCommands()}"/>')
        cursor += glyph.width * scale + tracking
    assert maxwidth is None or cursor - tracking <= maxwidth, (value, cursor, maxwidth)
    assert 0 <= bounds[0] < bounds[2] <= 1600 and 0 <= bounds[1] < bounds[3] <= 2040, (value, bounds)
    text_bounds.append({'text': value, 'bounds': bounds})
    parts.append(f'<g aria-label="{escape(value, quote=True)}" fill="{fill}" transform="translate({x} {y})">' + ''.join(shapes) + '</g>')


def label(value, x, y, fill=MUTED):
    text(value, x, y, 13, 'mono', fill, .6)


def artwork(filename, x, y, width, fill=INK):
    root = ET.parse(ASSETS / filename).getroot()
    vw = float(root.attrib['viewBox'].split()[2])
    # Preserve every original path, transform and fill rule.
    inner = ''.join(ET.tostring(c, encoding='unicode') for c in root if not c.tag.endswith('title'))
    parts.append(f'<g fill="{fill}" color="{fill}" transform="translate({x} {y}) scale({width/vw})">{inner}</g>')


def signature(x, y, width, fill=INK):
    artwork('paramrig-coform-symbol.svg', x, y, width * .16, fill)
    artwork('paramrig-wordmark.svg', x + width * .22, y + width * .01, width * .78, fill)


def slider(name, value, y, ratio):
    text(name, 112, y, 16, fill=PAPER)
    text(value, 279, y, 14, 'mono', STONE)
    line(112, y + 22, 314, y + 22, '#62695E', 3)
    line(112, y + 22, 112 + 202 * ratio, y + 22, LIME, 3)
    parts.append(f'<circle cx="{112 + 202 * ratio}" cy="{y + 22}" r="6" fill="{LIME}"/>')


def luminance(h):
    rgb = [int(h[i:i+2], 16) / 255 for i in (1, 3, 5)]
    rgb = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055)**2.4 for c in rgb]
    return sum(c * w for c, w in zip(rgb, [.2126, .7152, .0722]))


def contrast(a, b):
    hi, lo = sorted([luminance(a), luminance(b)], reverse=True)
    return (hi + .05) / (lo + .05)


# Known answers calibrate the contrast function before using its output.
assert abs(contrast('#000000', '#FFFFFF') - 21) < 1e-8
assert contrast(INK, INK) == 1
for foreground, background in [(INK, PAPER), (PAPER, INK), (INK, LIME), (MUTED, PAPER), (STONE, INK)]:
    assert contrast(foreground, background) >= 4.5

masters = {p.name: sha256(p.read_bytes()).hexdigest() for p in ASSETS.glob('*.svg')}
assert masters['paramrig-coform-symbol.svg'] == '60881480cf56de25c2acb3833d13f95b61b5862d18231d2616f22878670e3e22'
rect(0, 0, 1600, 2040, PAPER)
signature(64, 45, 176)
label('VISUAL IDENTITY / 01', 1118, 61)
line(64, 96, 1536, 96)

# 01 — The approved mark anchors the largest quiet field.
rect(64, 128, 864, 640, '#EBEDE5')
label('01 / THE SIGNATURE', 96, 172)
artwork('paramrig-coform-logo.svg', 308, 228, 376)
label('COFORM', 96, 712)
text('Two complementary forms. One shared result.', 96, 742, 18)
rect(952, 128, 584, 640, INK)
label('THE IDEA', 984, 172, STONE)
text('AI builds the tools.', 984, 254, 47, 'bold', PAPER, -1.3, 520)
text('You shape the result.', 984, 312, 47, 'bold', PAPER, -1.3, 520)
text('A creative workbench for human decisions.', 984, 365, 19, fill=STONE, maxwidth=520)
artwork('paramrig-coform-symbol.svg', 1120, 425, 240, LIME)
label('OPEN-SOURCE CREATIVE TOOLS', 984, 718, STONE)
label('paramrig.com', 984, 744, PAPER)

# 02 — Four colors, one accent. No invented product-state palette.
label('02 / PALETTE PROPOSAL', 64, 824)
swatches = [(64, 448, INK, PAPER, 'Carbon', 'Primary ink / dark canvas'),
            (512, 352, PAPER, INK, 'Chalk', 'Light canvas'),
            (864, 256, STONE, INK, 'Stone', 'Supporting neutral'),
            (1120, 416, LIME, INK, 'Signal', 'Selection / creative action')]
for x, width, bg, fg, name, role in swatches:
    rect(x, 856, width, 168, bg)
    text(name, x + 24, 900, 24, 'bold', fg)
    text(bg, x + 24, 932, 15, 'mono', fg)
    text(role, x + 24, 995, 14, fill=fg, maxwidth=width-48)
line(512, 1024, 864, 1024)

# 03 — Real fonts for copy; the logo remains custom outlined lettering.
label('03 / TYPOGRAPHY PROPOSAL', 64, 1080)
text('Manrope', 64, 1161, 64, 'bold', tracking=-1.6)
text('Precise tools. Human decisions.', 64, 1210, 32, tracking=-.5, maxwidth=840)
text('Aa Bb Cc Dd Ee Ff Gg 0123456789', 64, 1258, 26, maxwidth=840)
text('Titles + interface copy / Weights 450 + 650', 64, 1310, 17, fill=MUTED)
text('Logo lettering: custom vector drawing, not a font.', 64, 1342, 17, fill=MUTED)
line(64, 1384, 928, 1384)
rect(952, 1056, 584, 328, PANEL)
label('TYPE FOR PARAMETERS', 984, 1100)
text('IBM Plex Mono', 984, 1161, 36, 'mono', maxwidth=520)
text('radius    48.00 px', 984, 1222, 23, 'mono')
text('rotation  12.00 deg', 984, 1260, 23, 'mono')
text('layers    08', 984, 1298, 23, 'mono')
text('Values, labels and code / Regular', 984, 1342, 17, fill=MUTED)

# 04 — Two clearly marked static applications, not implemented product UI.
label('04 / IN CONTEXT — VISUAL CONCEPTS', 64, 1432)
rect(64, 1464, 944, 440, INK, 12)
signature(88, 1485, 156, PAPER)
text('Contour study', 382, 1506, 17, fill=STONE)
rect(834, 1480, 150, 36, LIME, 6)
text('Export settings', 850, 1503, 14, 'bold', INK, maxwidth=120)
line(64, 1536, 1008, 1536, '#42493F')
line(344, 1536, 344, 1904, '#42493F')
label('GEOMETRY', 112, 1582, STONE)
slider('Radius', '48 px', 1630, .48)
slider('Rotation', '12°', 1710, .4)
slider('Layers', '8', 1790, .7)
label('SVG / 2D', 112, 1872, STONE)
rect(368, 1560, 616, 320, '#252B25', 4)
for i in range(8):
    side = 140 + i * 15
    parts.append(f'<rect x="{676-side/2}" y="{1720-side/2}" width="{side}" height="{side}" rx="48" fill="none" stroke="{LIME}" stroke-width="1.6" transform="rotate({12*i/7} 676 1720)"/>')
label('LIVE PREVIEW', 392, 1592, STONE)
label('100%', 916, 1856, STONE)
rect(1032, 1464, 504, 440, LIME)
label('SOCIAL / COVER STUDY', 1064, 1510, INK)
text('Make it', 1064, 1610, 72, 'bold', INK, -2, 440)
text('yours.', 1064, 1689, 72, 'bold', INK, -2, 440)
text('Build the tools with AI.', 1064, 1750, 20)
text('Put your eye into every detail.', 1064, 1782, 20, maxwidth=440)
signature(1064, 1832, 218)
label('paramrig.com', 1368, 1872, INK)

line(64, 1944, 1536, 1944)
label('PARAMRIG / COFORM', 64, 1980)
text('Approved logo. Proposed palette, type and applications.', 64, 2008, 14, fill=MUTED)
label('BRAND STUDY — AUG 2026', 1290, 1980)
label('01 / 01', 1468, 2008)

svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2040" viewBox="0 0 1600 2040" role="img" aria-labelledby="title desc">'
       '<title id="title">ParamRig — branding board</title>'
       '<desc id="desc">Approved Coform logo with a proposed carbon, chalk, stone and lime palette; Manrope and IBM Plex Mono; static editor and social cover concepts.</desc>'
       + ''.join(parts) + '</svg>')
(OUT / 'paramrig-branding-board.svg').write_text(svg)
(HERE / 'qa.json').write_text(json.dumps({'masters_sha256': masters, 'text_bounds': text_bounds,
    'contrast_calibration': 'black/white = 21; identity = 1',
    'contrast': {f'{a} on {b}': round(contrast(a, b), 2) for a,b in [(INK,PAPER),(INK,LIME),(MUTED,PAPER),(STONE,INK)]}}, indent=2))
print(OUT / 'paramrig-branding-board.svg')
