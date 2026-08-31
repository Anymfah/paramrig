"""Three static desktop UI concepts, not a running ParamRig application.

Outlined Public Sans uses HarfBuzz shaping. Approved brand masters are embedded
unchanged. Preview artwork is generated vector geometry, not a product render.
"""
from pathlib import Path
from html import escape
from hashlib import sha256
import json
import math
import xml.etree.ElementTree as ET
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/ui-mockups'
OUT.mkdir(parents=True, exist_ok=True)
BRAND = ROOT / 'assets/brand'
FONT_PATH = ROOT / 'workproduct/brand-identity/paramrig/branding-board/fonts/PublicSans.ttf'
FONT = TTFont(FONT_PATH)
FACE = hb.Face(FONT_PATH.read_bytes())
W, H = 1600, 1000
PAPER, INK, STONE = '#F4F3EB', '#1C201C', '#C8CCC0'
LIGHT_PANEL, LIGHT_LINE, LIGHT_MUTED = '#E8EBE2', '#D7DAD0', '#62695E'
DARK, PANEL, RAISED, BORDER, SECONDARY = '#191D1A', '#222723', '#303731', '#383F39', '#AFB8AD'
MASTERS = {p.name: sha256(p.read_bytes()).hexdigest() for p in BRAND.glob('*.svg')}


class Board:
    def __init__(self, name, title, dark=False):
        self.name, self.title, self.dark = name, title, dark
        self.parts, self.bounds = [], []
        self.fg = PAPER if dark else INK
        self.muted = SECONDARY if dark else LIGHT_MUTED
        self.bg = DARK if dark else PAPER
        self.panel = PANEL if dark else LIGHT_PANEL
        self.border = BORDER if dark else LIGHT_LINE
        self.rect(0, 0, W, H, self.bg)

    def rect(self, x, y, w, h, fill, r=0, stroke=None, sw=1):
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"'
                          + (f' stroke="{stroke}" stroke-width="{sw}"' if stroke else '') + '/>')

    def line(self, x, y, xx, yy, fill=None, width=1):
        self.parts.append(f'<path d="M{x} {y} L{xx} {yy}" stroke="{fill or self.border}" stroke-width="{width}" fill="none"/>')

    def circle(self, x, y, r, fill, stroke=None):
        self.parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"' + (f' stroke="{stroke}"' if stroke else '') + '/>')

    def text(self, value, x, y, size=14, weight=400, fill=None, maxwidth=None, align='left', tnum=False):
        hf = hb.Font(FACE)
        hf.set_variations({'wght': weight})
        glyphs = FONT.getGlyphSet(location={'wght': weight})
        buf = hb.Buffer()
        buf.add_str(value)
        buf.guess_segment_properties()
        hb.shape(hf, buf, {'tnum': tnum})
        scale = size / FACE.upem
        tracking = -.025 * size if size >= 32 else 0
        advance = sum(pos.x_advance * scale + tracking for pos in buf.glyph_positions) - tracking
        assert maxwidth is None or advance <= maxwidth, (value, advance, maxwidth)
        if align == 'right':
            x -= advance
        if align == 'center':
            x -= advance / 2
        cursor, shapes = 0, []
        bb = [float('inf'), float('inf'), -float('inf'), -float('inf')]
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            assert info.codepoint != 0, f'Missing glyph in {value}'
            glyph = glyphs[FONT.getGlyphName(info.codepoint)]
            pen, bounds = SVGPathPen(glyphs), BoundsPen(glyphs)
            glyph.draw(pen)
            glyph.draw(bounds)
            tx, ty = cursor + pos.x_offset * scale, -pos.y_offset * scale
            if bounds.bounds:
                x0, y0, x1, y1 = bounds.bounds
                bb = [min(bb[0], x+tx+x0*scale), min(bb[1], y+ty-y1*scale),
                      max(bb[2], x+tx+x1*scale), max(bb[3], y+ty-y0*scale)]
            shapes.append(f'<path transform="translate({tx:.5f} {ty:.5f}) scale({scale:.7f} {-scale:.7f})" d="{pen.getCommands()}"/>')
            cursor += pos.x_advance * scale + tracking
        assert 0 <= bb[0] < bb[2] <= W and 0 <= bb[1] < bb[3] <= H, (value, bb)
        self.bounds.append({'text': value, 'bounds': bb})
        self.parts.append(f'<g fill="{fill or self.fg}" aria-label="{escape(value, quote=True)}" transform="translate({x} {y})">'+''.join(shapes)+'</g>')

    def icon(self, name, x, y, color=None, size=18):
        paths = {
            'grid': 'M2 2h6v6H2z M12 2h6v6h-6z M2 12h6v6H2z M12 12h6v6h-6z',
            'search': 'M14 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M12.5 12.5L18 18',
            'chevron': 'M7 4l6 6-6 6',
            'down': 'M4 7l6 6 6-6',
            'arrow': 'M3 10h14 M12 5l5 5-5 5',
            'back': 'M17 10H3 M8 5l-5 5 5 5',
            'folder': 'M2 5h6l2 3h8v9H2z',
            'cube': 'M10 1l8 4.5v9L10 19l-8-4.5v-9z M2 5.5l8 4.5 8-4.5 M10 10v9',
            'shape': 'M10 1l9 9-9 9-9-9z',
            'undo': 'M6 4L2 8l4 4 M3 8h8a6 6 0 0 1 0 12',
            'check': 'M3 10l5 5L17 5',
            'play': 'M5 3l12 7-12 7z',
            'pause': 'M6 4v12 M14 4v12',
            'plus': 'M10 3v14 M3 10h14',
            'code': 'M6 5l-5 5 5 5 M14 5l5 5-5 5 M12 2L8 18',
            'sliders': 'M2 5h16 M2 15h16 M7 2v6 M13 12v6',
            'key': 'M10 3l7 7-7 7-7-7z',
        }
        self.parts.append(f'<path d="{paths[name]}" transform="translate({x} {y}) scale({size/20})" fill="none" stroke="{color or self.muted}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>')

    def logo(self, x, y, width=146):
        for file, dx, dy, width2 in [('paramrig-coform-symbol.svg', 0, 0, width*.16),
                                    ('paramrig-wordmark.svg', width*.22, width*.01, width*.78)]:
            root = ET.parse(BRAND / file).getroot()
            vb = float(root.attrib['viewBox'].split()[2])
            inner = ''.join(ET.tostring(e, encoding='unicode') for e in root if not e.tag.endswith('title'))
            self.parts.append(f'<g fill="{self.fg}" color="{self.fg}" transform="translate({x+dx} {y+dy}) scale({width2/vb})">{inner}</g>')

    def button(self, value, x, y, w, primary=False, icon=None):
        self.rect(x, y, w, 36, self.fg if primary else self.panel, 7)
        color = self.bg if primary else self.fg
        self.text(value, x+w/2-(10 if icon else 0), y+23, 13, 600 if primary else 400, color, w-24, 'center')
        if icon:
            self.icon(icon, x+w-28, y+10, color, 16)

    def field(self, title, value, y, ratio=None, unit=None):
        x, right = 1304, 1576
        self.text(title, x, y, 13)
        self.rect(right-88, y-22, 88, 32, RAISED, 5)
        self.text(value, right-12, y, 13, fill=PAPER, align='right', tnum=True)
        if ratio is not None:
            self.line(x, y+30, right, y+30, '#626F62', 2)
            self.line(x, y+30, x+(right-x)*ratio, y+30, STONE, 2)
            self.circle(x+(right-x)*ratio, y+30, 5, PAPER)

    def section(self, value, y):
        self.text(value, 1304, y, 14, 600)
        self.icon('down', 1558, y-12, SECONDARY, 14)

    def save(self):
        svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="title desc"><title id="title">{escape(self.title)}</title><desc id="desc">Static desktop interface concept with illustrative sample data. No working controls, live renderer or source integration.</desc>'+''.join(self.parts)+'</svg>'
        (OUT / f'{self.name}.svg').write_text(svg)
        return {'name': self.name, 'text': self.bounds}


def shell(b, current=None):
    b.rect(0, 0, 1600, 64, b.panel if b.dark else PAPER)
    b.logo(24, 19)
    b.line(208, 0, 208, 976)
    b.line(0, 64, 1600, 64)
    b.text('Creative studies', 240, 39, 13, fill=b.muted)
    if current:
        b.icon('chevron', 363, 24, size=14)
        b.text(current, 392, 39, 13, 600)
        b.icon('undo', 1200, 22, size=16)
        b.text('Snapshot', 1248, 39, 13, fill=b.muted)
        b.button('Export settings', 1416, 14, 160, True, 'arrow')
    else:
        b.text('Local workspace', 1576, 39, 13, fill=b.muted, align='right')
    b.icon('grid', 24, 92)
    b.text('Rig library', 56, 106, 14, 600)
    b.line(24, 136, 184, 136)
    b.text('Creative studies', 24, 176, 12, fill=b.muted)
    rows = [('shape', 'Contour bloom'), ('cube', 'Tidal planet'), ('sliders', 'Surface studies'), ('code', 'Type specimen')]
    for i, (icon, title) in enumerate(rows):
        y = 208 + i*40
        if current == title:
            b.rect(12, y-16, 184, 36, RAISED if b.dark else LIGHT_PANEL, 6)
            b.rect(12, y-8, 2, 20, b.fg, 1)
        b.icon(icon, 26, y-7, b.fg if title == current else b.muted, 16)
        b.text(title, 54, y+6, 13, fill=b.fg if title == current else b.muted, maxwidth=140)
    b.line(24, 392, 184, 392)
    b.text('From your project', 24, 428, 12, fill=b.muted)
    b.text('Rig files appear here', 24, 456, 12, fill=b.muted)
    b.text('when your agent adds them.', 24, 476, 12, fill=b.muted, maxwidth=160)
    b.text('Documentation', 24, 940, 12, fill=b.muted)
    b.line(0, 976, 1600, 976)
    b.text('Design concept · Sample workspace', 24, 992, 11, fill=b.muted)
    b.text('ParamRig', 1576, 992, 11, fill=b.muted, align='right')


def bloom(b, cx, cy, radius):
    # Offset nested contours create the illustrative relief, without bitmaps.
    for i in range(38):
        scale = 1-i*.019
        points=[]
        for j in range(241):
            a=j*math.tau/240
            r=radius*scale*(1+.10*math.cos(6*a+i*.065)+.045*math.sin(3*a))
            points.append((cx+r*math.cos(a),cy+r*math.sin(a)))
        d='M'+' L'.join(f'{x:.2f} {y:.2f}' for x,y in points)+' Z'
        tone=round(30+i*3.8)
        fill=f'#{tone:02x}{tone+4:02x}{tone:02x}'
        b.parts.append(f'<path d="{d}" fill="{fill}" stroke="{PAPER}" stroke-opacity=".34" stroke-width=".7"/>')


def planet(b, cx, cy, radius, suffix):
    # Concept render: clipped geological contours plus spherical light falloff.
    b.parts.append(f'<defs><radialGradient id="light-{suffix}" cx="30%" cy="24%" r="78%"><stop stop-color="#D7E1D8"/><stop offset=".48" stop-color="#829A98"/><stop offset=".78" stop-color="#394D51"/><stop offset="1" stop-color="#131D20"/></radialGradient><radialGradient id="shade-{suffix}" cx="25%" cy="20%" r="80%"><stop offset=".3" stop-color="#0E171A" stop-opacity="0"/><stop offset=".72" stop-color="#0E171A" stop-opacity=".12"/><stop offset="1" stop-color="#0E171A" stop-opacity=".96"/></radialGradient><clipPath id="planet-{suffix}"><circle cx="{cx}" cy="{cy}" r="{radius}"/></clipPath></defs>')
    b.circle(cx,cy,radius+2,'#6E8783')
    b.circle(cx,cy,radius,f'url(#light-{suffix})')
    b.parts.append(f'<g clip-path="url(#planet-{suffix})">')
    for i in range(100):
        yy=cy-radius+i*radius/50
        points=[]
        for j in range(121):
            xx=cx-radius+2*radius*j/120
            y=yy+radius*(.075*math.sin(j*.095+i*.12)+.025*math.sin(j*.32-i*.25)+.012*math.cos(j*.85+i*.21))
            points.append((xx,y))
        d='M'+' L'.join(f'{x:.2f} {y:.2f}' for x,y in points)
        b.parts.append(f'<path d="{d}" fill="none" stroke="{"#E5DFBC" if i%7<3 else "#283D40"}" stroke-opacity="{.16 if i%7<3 else .32}" stroke-width="{radius*.009}"/>')
    b.circle(cx,cy,radius,f'url(#shade-{suffix})')
    b.parts.append('</g>')


def library():
    b=Board('01-library','ParamRig — rig library')
    shell(b)
    b.text('Your rigs',248,132,36,600)
    b.text('Tools built around what you want to create.',248,168,15,fill=b.muted)
    b.rect(248,200,552,40,LIGHT_PANEL,7)
    b.icon('search',264,211,size=16)
    b.text('Find a rig in Creative studies',292,225,13,fill=b.muted)
    b.text('4 rigs',1192,225,13,fill=b.muted,align='right')
    b.line(1240,64,1240,976)
    cards=[(248,272,'Contour bloom','SVG · Shape, relief and motion'),(736,272,'Tidal planet','3D · Surface, atmosphere and orbit'),
           (248,608,'Surface studies','HTML / CSS · Material and light'),(736,608,'Type specimen','HTML / CSS · Rhythm and hierarchy')]
    for i,(x,y,title,desc) in enumerate(cards):
        bg=LIGHT_PANEL if i!=1 else '#242C28'
        b.rect(x,y,456,244,bg,8,INK if i==0 else None)
        if i==0:
            bloom(b,x+228,y+122,90)
            b.circle(x+430,y+26,11,INK)
            b.icon('check',x+423,y+19,PAPER,14)
        elif i==1:
            planet(b,x+228,y+122,90,'thumb')
        elif i==2:
            for j,c in enumerate([PAPER,STONE,INK]):
                b.rect(x+56+j*112,y+74,96,96,c,24)
                b.line(x+72+j*112,y+82,x+136+j*112,y+82,'#F9FAF4',1)
        else:
            b.text('Aa',x+40,y+142,92,600)
            b.text('Make it',x+222,y+96,28,600)
            b.text('your own.',x+222,y+132,28,600)
            b.text('Type, space, rhythm.',x+222,y+168,12,fill=b.muted)
        b.text(title,x,y+274,16,600)
        b.text(desc,x,y+300,12,fill=b.muted)
    b.text('Selected rig',1272,112,12,fill=b.muted)
    b.text('Contour bloom',1272,156,24,600)
    b.text('A shape study with layered contours.',1272,192,13,maxwidth=296)
    b.text('Tune the silhouette, relief and motion.',1272,214,13,maxwidth=296)
    b.button('Open rig',1272,246,296,True,'arrow')
    b.line(1272,320,1576,320)
    for label,value,y in [('Renderer','SVG',360),('Controls','18 parameters',412),('Animation','3 tracks',464)]:
        b.text(label,1272,y,13,fill=b.muted)
        b.text(value,1576,y,13,align='right')
    b.text('Source',1272,528,12,fill=b.muted)
    b.rect(1272,548,304,48,LIGHT_PANEL,6)
    b.icon('code',1288,564,size=16)
    b.text('contour-bloom.rig.tsx',1316,578,13,maxwidth=244)
    b.text('The rig defines the controls.',1272,632,14,600)
    b.text('ParamRig gives them a home.',1272,656,14)
    b.text('Your agent can build any renderer',1272,700,13,fill=b.muted)
    b.text('or custom control this study needs.',1272,722,13,fill=b.muted)
    b.text('Illustrative filenames and rig contents.',1272,940,11,fill=b.muted)
    return b.save()


def editor_base(name,title):
    b=Board(name,f'ParamRig — {title}',True)
    shell(b,title)
    b.rect(208,64,1072,48,PANEL)
    b.rect(224,72,176,32,RAISED,6)
    b.text(title,240,93,13,600)
    b.text('Tidal planet' if title=='Contour bloom' else 'Contour bloom',424,93,13,fill=b.muted)
    b.line(208,112,1600,112)
    b.line(1280,64,1280,976)
    b.rect(1281,64,319,912,PANEL)
    b.text('Inspector',1304,94,14,600)
    b.icon('sliders',1557,80,size=16)
    b.text('Controls',1304,141,13,600)
    b.text('Bindings',1400,141,13,fill=b.muted)
    b.text('Snapshots',1488,141,13,fill=b.muted)
    b.line(1304,155,1360,155,PAPER,2)
    b.line(1280,164,1600,164)
    return b


def svg_editor():
    b=editor_base('02-svg-editor','Contour bloom')
    b.text('Preview',240,148,13,600)
    b.text('SVG',322,148,12,fill=b.muted)
    b.text('Fit',1208,148,12,fill=b.muted)
    b.icon('down',1236,136,size=14)
    b.rect(280,192,928,624,PAPER,4)
    bloom(b,744,504,208)
    b.text('Contour bloom',320,236,12,fill=LIGHT_MUTED)
    b.text('800 × 600',1168,788,12,fill=LIGHT_MUTED,align='right',tnum=True)
    b.rect(632,850,224,40,PANEL,8)
    b.text('Original',656,875,13,fill=b.muted)
    b.rect(736,854,116,32,RAISED,6)
    b.text('Current',794,875,13,600,align='center')
    b.text('4 values changed since snapshot',240,944,12,fill=b.muted)
    b.text('Reset changes',1248,944,12,fill=b.muted,align='right')
    b.section('Shape',200)
    b.field('Lobes','6',244,.50)
    b.field('Amplitude','0.18',324,.36)
    b.field('Twist','24°',404,.60)
    b.line(1304,460,1576,460)
    b.section('Relief',496)
    b.field('Layers','38',540,.70)
    b.field('Depth','0.72',620,.72)
    b.line(1304,676,1576,676)
    b.section('Surface',712)
    b.text('Ink',1304,752,13)
    b.rect(1416,730,160,34,RAISED,5)
    b.circle(1435,747,8,INK,SECONDARY)
    b.text('#1C201C',1556,752,12,align='right')
    b.text('Edge softness',1304,808,13)
    b.rect(1304,832,272,88,DARK,6)
    b.line(1320,900,1560,900,BORDER)
    b.line(1320,848,1320,900,BORDER)
    b.parts.append(f'<path d="M1320 900C1416 900 1424 848 1560 848" fill="none" stroke="{STONE}" stroke-width="2"/>')
    b.circle(1320,900,4,PAPER)
    b.circle(1560,848,4,PAPER)
    b.text('Custom curve control',1304,948,11,fill=b.muted)
    return b.save()


def timeline(b):
    b.rect(208,744,1072,232,PANEL)
    b.line(208,744,1280,744)
    b.text('Timeline',240,777,14,600)
    b.icon('play',354,762,PAPER,17)
    b.text('02.40 / 08.00 s',392,777,12,tnum=True)
    b.text('Loop',1144,777,12,fill=b.muted)
    b.text('30 fps',1248,777,12,fill=b.muted,align='right',tnum=True)
    b.line(208,796,1280,796)
    b.line(432,796,432,976)
    for i in range(9):
        x=456+i*96
        b.text(f'{i}s',x,820,11,fill=b.muted,tnum=True)
        b.line(x,832,x,956,BORDER)
    for j,(name,value) in enumerate([('Rotation Y','108°'),('Cloud drift','0.24'),('Light angle','36°')]):
        y=858+j*40
        b.icon('key',240,y-12,SECONDARY,14)
        b.text(name,264,y,12)
        b.text(value,416,y,12,fill=b.muted,align='right',tnum=True)
        b.rect(456,y-16,768,24,RAISED,4)
        for x in ([456,744,1224] if j!=1 else [456,936,1224]):
            b.icon('key',x-5,y-10,PAPER,10)
    playhead=456+2.4*96
    b.line(playhead,798,playhead,968,PAPER,1.5)
    b.parts.append(f'<path d="M{playhead-5} 798h10v8l-5 5-5-5z" fill="{PAPER}"/>')


def scene_editor():
    b=editor_base('03-3d-editor','Tidal planet')
    b.rect(209,112,1070,632,'#141C1C')
    b.text('Perspective',240,148,13)
    b.icon('down',332,136,size=14)
    b.text('Lit',380,148,12,fill=b.muted)
    b.text('Orbit camera',1248,148,12,fill=b.muted,align='right')
    # Subtle equatorial orbit behind the sample world, not decorative HUD chrome.
    b.parts.append(f'<ellipse cx="744" cy="428" rx="344" ry="96" fill="none" stroke="#566460" stroke-opacity=".42" transform="rotate(-18 744 428)"/>')
    planet(b,744,414,222,'large')
    b.text('Tidal planet',240,696,13)
    b.text('Surface + atmosphere',240,718,12,fill=b.muted)
    b.line(1200,691,1232,691,STONE,1.5)
    b.line(1200,691,1200,661,STONE,1.5)
    b.text('Y',1196,650,11,fill=b.muted)
    b.text('X',1240,695,11,fill=b.muted)
    timeline(b)
    b.section('Surface',200)
    b.field('Seed','4817',244)
    b.field('Terrain scale','2.40',300,.48)
    b.field('Ridge strength','0.62',380,.62)
    b.text('Elevation palette',1304,456,13)
    b.parts.append('<defs><linearGradient id="terrain"><stop stop-color="#263D42"/><stop offset=".5" stop-color="#819893"/><stop offset="1" stop-color="#E2DDBC"/></linearGradient></defs>')
    b.rect(1304,480,272,20,'url(#terrain)',4)
    for x in [1304,1440,1576]:
        b.circle(x,506,4,PAPER)
    b.line(1304,536,1576,536)
    b.section('Atmosphere',572)
    b.field('Density','0.28',616,.28)
    b.field('Light direction','36°',696,.4)
    b.line(1304,748,1576,748)
    b.section('Animation',784)
    b.text('Rotation Y',1304,824,13)
    b.icon('key',1452,811,PAPER,14)
    b.rect(1488,802,88,32,RAISED,5)
    b.text('108°',1564,824,13,align='right',tnum=True)
    b.text('Interpolated at 2.40 s',1304,852,12,fill=b.muted)
    b.rect(1304,876,272,48,DARK,6)
    b.text('Linear',1320,905,13)
    b.icon('down',1548,891,size=16)
    b.text('3 animated parameters',1304,948,11,fill=b.muted)
    return b.save()


def luminance(value):
    channels=[int(value[i:i+2],16)/255 for i in (1,3,5)]
    channels=[c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in channels]
    return sum(c*w for c,w in zip(channels,[.2126,.7152,.0722]))


def contrast(a,b):
    hi,lo=sorted([luminance(a),luminance(b)],reverse=True)
    return (hi+.05)/(lo+.05)


if __name__ == '__main__':
    assert abs(contrast('#000000','#FFFFFF')-21)<1e-8
    assert contrast(INK,INK)==1
    for weight in [400,600]:
        hf=hb.Font(FACE);hf.set_variations({'wght':weight})
        buf=hb.Buffer();buf.add_str('H');buf.guess_segment_properties();hb.shape(hf,buf)
        gs=FONT.getGlyphSet(location={'wght':weight})
        assert abs(buf.glyph_positions[0].x_advance-gs[FONT.getBestCmap()[ord('H')]].width)<1
    pairs=[(INK,PAPER),(LIGHT_MUTED,PAPER),(LIGHT_MUTED,LIGHT_PANEL),(PAPER,PANEL),(SECONDARY,PANEL),(SECONDARY,DARK)]
    for fg,bg in pairs:
        assert contrast(fg,bg)>=4.5,(fg,bg,contrast(fg,bg))
    reports=[library(),svg_editor(),scene_editor()]
    assert MASTERS=={p.name:sha256(p.read_bytes()).hexdigest() for p in BRAND.glob('*.svg')}
    (Path(__file__).parent/'qa.json').write_text(json.dumps({'masters':MASTERS,'calibration':'Single-H shaping metric at 400/600; contrast black/white=21 and identity=1','contrast':{f'{a} on {b}':round(contrast(a,b),2) for a,b in pairs},'boards':reports},indent=2))
    print('Built three static 1600 × 1000 SVG mockups. Logo masters unchanged.')
