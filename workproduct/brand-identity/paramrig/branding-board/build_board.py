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
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
ASSETS = ROOT / 'assets/brand'
OUT = ASSETS / 'branding-board'
OUT.mkdir(exist_ok=True)
INK, PAPER, STONE = '#1C201C', '#F4F3EB', '#C8CCC0'
MUTED, LINE, PANEL = '#62695E', '#D7DAD0', '#E8EBE2'
font_path = HERE / 'fonts/PublicSans.ttf'
font = TTFont(font_path)
hb_face = hb.Face(font_path.read_bytes())
weights = {'regular': 400, 'bold': 600}
glyphsets = {k: font.getGlyphSet(location={'wght': weight}) for k, weight in weights.items()}
parts, text_bounds = [], []


def rect(x, y, w, h, fill, r=0, stroke=None):
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"'
                 + (f' stroke="{stroke}"' if stroke else '') + '/>')


def line(x1, y1, x2, y2, color=LINE, width=1):
    parts.append(f'<path d="M{x1} {y1}L{x2} {y2}" fill="none" stroke="{color}" stroke-width="{width}"/>')


def text(value, x, y, size=18, face='regular', fill=INK, tracking=0, maxwidth=None, tnum=False):
    glyphs = glyphsets[face]
    hf = hb.Font(hb_face)
    hf.set_variations({'wght': weights[face]})
    buf = hb.Buffer()
    buf.add_str(value)
    buf.guess_segment_properties()
    hb.shape(hf, buf, {'tnum': True} if tnum else {})
    scale = size / font['head'].unitsPerEm
    cursor, shapes = 0, []
    bounds = [float('inf'), float('inf'), -float('inf'), -float('inf')]
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        assert info.codepoint != 0, f'Missing glyph: {value}'
        glyph = glyphs[font.getGlyphName(info.codepoint)]
        tx, ty = cursor + pos.x_offset * scale, -pos.y_offset * scale
        pen = SVGPathPen(glyphs)
        glyph.draw(pen)
        b = BoundsPen(glyphs)
        glyph.draw(b)
        if b.bounds:
            x0, y0, x1, y1 = b.bounds
            bounds = [min(bounds[0], x + tx + x0 * scale),
                      min(bounds[1], y + ty - y1 * scale),
                      max(bounds[2], x + tx + x1 * scale),
                      max(bounds[3], y + ty - y0 * scale)]
        shapes.append(f'<path transform="translate({tx:.5f} {ty:.5f}) scale({scale:.7f} {-scale:.7f})" d="{pen.getCommands()}"/>')
        cursor += pos.x_advance * scale + tracking
    assert maxwidth is None or cursor - tracking <= maxwidth, (value, cursor, maxwidth)
    assert 0 <= bounds[0] < bounds[2] <= 1600 and 0 <= bounds[1] < bounds[3] <= 2040, (value, bounds)
    text_bounds.append({'text': value, 'bounds': bounds, 'size': size, 'weight': weights[face], 'tabular': tnum})
    parts.append(f'<g aria-label="{escape(value, quote=True)}" fill="{fill}" transform="translate({x} {y})">' + ''.join(shapes) + '</g>')


def label(value, x, y, fill=MUTED):
    text(value, x, y, 16, 'regular', fill)


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
    text(value, 279, y, 16, fill=STONE, tnum=True)
    line(112, y + 22, 314, y + 22, '#62695E', 3)
    line(112, y + 22, 112 + 202 * ratio, y + 22, PAPER, 3)
    parts.append(f'<circle cx="{112 + 202 * ratio}" cy="{y + 22}" r="6" fill="{PAPER}"/>')


def luminance(h):
    rgb = [int(h[i:i+2], 16) / 255 for i in (1, 3, 5)]
    rgb = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055)**2.4 for c in rgb]
    return sum(c * w for c, w in zip(rgb, [.2126, .7152, .0722]))


def contrast(a, b):
    hi, lo = sorted([luminance(a), luminance(b)], reverse=True)
    return (hi + .05) / (lo + .05)


# Known answers calibrate the contrast function before using its output.
for face, weight in weights.items():
    hf = hb.Font(hb_face)
    hf.set_variations({'wght': weight})
    b = hb.Buffer()
    b.add_str('H')
    b.guess_segment_properties()
    hb.shape(hf, b)
    assert abs(b.glyph_positions[0].x_advance - glyphsets[face][font.getBestCmap()[ord('H')]].width) < 1
assert abs(contrast('#000000', '#FFFFFF') - 21) < 1e-8
assert contrast(INK, INK) == 1
for foreground, background in [(INK, PAPER), (PAPER, INK), (INK, PANEL), (MUTED, PAPER), (STONE, INK)]:
    assert contrast(foreground, background) >= 4.5

masters = {p.name: sha256(p.read_bytes()).hexdigest() for p in ASSETS.glob('*.svg')}
assert masters['paramrig-coform-symbol.svg'] == '60881480cf56de25c2acb3833d13f95b61b5862d18231d2616f22878670e3e22'
rect(0, 0, 1600, 2040, PAPER)
signature(64, 45, 176)
label('Visual identity / 03', 1392 - 16 * 8, 61)
line(64, 96, 1536, 96)

# 01 — The approved mark anchors the largest quiet field.
rect(64, 128, 864, 640, '#EBEDE5')
label('The signature', 96, 172)
artwork('paramrig-coform-logo.svg', 308, 228, 376)
text('Coform', 96, 708, 24, 'bold')
text('Two complementary forms. One shared result.', 96, 742, 18)
rect(952, 128, 584, 640, INK)
label('The idea', 1000, 176, STONE)
text('AI builds', 1000, 284, 64, 'bold', PAPER, -1.9, 488)
text('the tools.', 1000, 356, 64, 'bold', PAPER, -1.9, 488)
text('You shape', 1000, 468, 64, 'bold', PAPER, -1.9, 488)
text('the result.', 1000, 540, 64, 'bold', PAPER, -1.9, 488)
text('Your eye. Your decisions.', 1000, 616, 20, fill=STONE)
label('Open-source creative tools', 1000, 720, STONE)

# 02 — Three neutral colors. The rejected citron accent is deliberately absent.
label('A quiet palette', 64, 824)
swatches = [(64, 544, INK, PAPER, 'Carbon', 'Primary ink / dark canvas'),
            (608, 544, PAPER, INK, 'Chalk', 'Light canvas / active controls'),
            (1152, 384, STONE, INK, 'Stone', 'Supporting neutral')]
for x, width, bg, fg, name, role in swatches:
    rect(x, 856, width, 168, bg)
    text(name, x + 24, 900, 24, 'bold', fg)
    text(bg, x + 24, 932, 16, fill=fg)
    text(role, x + 24, 995, 14, fill=fg, maxwidth=width-48)
line(608, 1024, 1152, 1024)

# 03 — Real fonts for copy; the logo remains custom outlined lettering.
label('Typography', 64, 1080)
text('Every detail.', 64, 1176, 64, 'bold', tracking=-1.9)
text('In your hands.', 64, 1248, 64, 'bold', tracking=-1.9)
text('Public Sans / Regular + Semibold', 64, 1312, 20, fill=MUTED)
text('Custom lettering for the logo. One family for everything else.', 64, 1344, 16, fill=MUTED)
line(64, 1384, 928, 1384)
rect(952, 1056, 584, 328, PANEL)
text('Clarity at every size.', 984, 1112, 32, 'bold', tracking=-.5, maxwidth=520)
text('Tune the shape. Keep what feels right.', 984, 1152, 20, maxwidth=520)
for name, value, y in [('Radius', '48.00 px', 1216), ('Rotation', '12.00°', 1264), ('Layers', '8', 1312)]:
    text(name, 984, y, 16)
    text(value, 1400, y, 16, maxwidth=104, tnum=True)
    if y < 1312:
        line(984, y + 16, 1504, y + 16)

# 04 — Two clearly marked static applications, not implemented product UI.
label('In context / Visual concepts', 64, 1432)
rect(64, 1464, 944, 440, INK, 12)
signature(88, 1485, 156, PAPER)
text('Contour study', 382, 1506, 17, fill=STONE)
rect(834, 1480, 150, 36, PAPER, 6)
text('Export settings', 850, 1503, 14, 'bold', INK, maxwidth=120)
line(64, 1536, 1008, 1536, '#42493F')
line(344, 1536, 344, 1904, '#42493F')
label('Geometry', 112, 1582, STONE)
slider('Radius', '48 px', 1630, .48)
slider('Rotation', '12°', 1710, .4)
slider('Layers', '8', 1790, .7)
label('SVG / 2D', 112, 1872, STONE)
rect(368, 1560, 616, 320, '#252B25', 4)
for i in range(8):
    side = 140 + i * 15
    parts.append(f'<rect x="{676-side/2}" y="{1720-side/2}" width="{side}" height="{side}" rx="48" fill="none" stroke="{PAPER}" stroke-width="1.6" transform="rotate({12*i/7} 676 1720)"/>')
label('Preview', 392, 1592, STONE)
label('100%', 916, 1856, STONE)
rect(1032, 1464, 504, 440, PANEL)
label('Made with a human eye.', 1064, 1510, INK)
text('Make it', 1064, 1610, 72, 'bold', INK, -2, 440)
text('yours.', 1064, 1689, 72, 'bold', INK, -2, 440)
text('Build the tools with AI.', 1064, 1750, 20)
text('Put your eye into every detail.', 1064, 1782, 20, maxwidth=440)
signature(1064, 1832, 218)
label('paramrig.com', 1368, 1872, INK)

line(64, 1944, 1536, 1944)
label('ParamRig / Coform', 64, 1980)
text('Approved logo. Proposed palette, type and applications.', 64, 2008, 14, fill=MUTED)
label('Brand study / August 2026', 1336 - 16 * 4, 1980)

svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2040" viewBox="0 0 1600 2040" role="img" aria-labelledby="title desc">'
       '<title id="title">ParamRig — branding board</title>'
       '<desc id="desc">Approved Coform logo with a carbon, chalk and stone palette. Public Sans typography proposal with restrained hierarchy and generous space. Static editor and cover concepts, not a working product.</desc>'
       + ''.join(parts) + '</svg>')
(OUT / 'paramrig-branding-board.svg').write_text(svg)
(HERE / 'qa.json').write_text(json.dumps({'masters_sha256': masters, 'text_bounds': text_bounds,
    'typeface': 'Public Sans', 'shaping': 'HarfBuzz; single H advance calibrated at both weights',
    'contrast_calibration': 'black/white = 21; identity = 1',
    'contrast': {f'{a} on {b}': round(contrast(a, b), 2) for a,b in [(INK,PAPER),(INK,PANEL),(MUTED,PAPER),(STONE,INK)]}}, indent=2))
print(OUT / 'paramrig-branding-board.svg')
