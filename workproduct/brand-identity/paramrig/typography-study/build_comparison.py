"""Two equal-size font specimens; HarfBuzz shaping + portable SVG outlines.

The custom logo is reused verbatim. No font is selected or applied to the app.
"""
from pathlib import Path
from hashlib import sha256
from html import escape
import json
import xml.etree.ElementTree as ET
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
ASSETS = ROOT / 'assets/brand'
OUT = ASSETS / 'typography'
OUT.mkdir(exist_ok=True)
INK, PAPER, MUTED, STONE = '#1C201C', '#F4F3EB', '#62695E', '#C8CCC0'
W, H = 1600, 1200
font_paths = {'A': HERE/'fonts/UncutSans-Variable.ttf', 'B': HERE/'fonts/FamiljenGrotesk.ttf'}
fonts = {key: TTFont(p) for key,p in font_paths.items()}
faces = {key: hb.Face(p.read_bytes()) for key,p in font_paths.items()}
parts, evidence = [], []


def rect(x,y,w,h,color,r=0):
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{color}"/>')


def line(x1,y1,x2,y2,color='#D7DAD0',width=1):
    parts.append(f'<path d="M{x1} {y1}L{x2} {y2}" fill="none" stroke="{color}" stroke-width="{width}"/>')


def text(value,x,y,size=18,key='A',weight=400,color=INK,maxwidth=None,tnum=False):
    font = fonts[key]
    hf = hb.Font(faces[key])
    hf.set_variations({'wght':weight})
    glyphset = font.getGlyphSet(location={'wght':weight})
    buf = hb.Buffer()
    buf.add_str(value)
    buf.guess_segment_properties()
    hb.shape(hf,buf,{'tnum':True} if tnum else {})
    scale = size / faces[key].upem
    cursor, shapes = 0, []
    bb = [float('inf'),float('inf'),-float('inf'),-float('inf')]
    for info,pos in zip(buf.glyph_infos,buf.glyph_positions):
        assert info.codepoint != 0, f'Missing glyph: {value}'
        name = font.getGlyphName(info.codepoint)
        glyph = glyphset[name]
        pen, bounds = SVGPathPen(glyphset), BoundsPen(glyphset)
        glyph.draw(pen)
        glyph.draw(bounds)
        tx, ty = cursor + pos.x_offset*scale, -pos.y_offset*scale
        shapes.append(f'<path transform="translate({tx:.5f} {ty:.5f}) scale({scale:.7f} {-scale:.7f})" d="{pen.getCommands()}"/>')
        if bounds.bounds:
            x0,y0,x1,y1=bounds.bounds
            bb=[min(bb[0],x+tx+x0*scale),min(bb[1],y+ty-y1*scale),max(bb[2],x+tx+x1*scale),max(bb[3],y+ty-y0*scale)]
        cursor+=pos.x_advance*scale
    assert maxwidth is None or cursor <= maxwidth, (value,cursor,maxwidth)
    assert 0<=bb[0]<bb[2]<=W and 0<=bb[1]<bb[3]<=H,(value,bb)
    parts.append(f'<g aria-label="{escape(value,quote=True)}" fill="{color}" transform="translate({x} {y})">'+''.join(shapes)+'</g>')
    evidence.append({'text':value,'font':key,'size':size,'weight':weight,'bounds':bb})
    return cursor


def logo(x,y,width):
    source=ET.parse(ASSETS/'paramrig-wordmark.svg').getroot()
    inner=''.join(ET.tostring(e,encoding='unicode') for e in source if not e.tag.endswith('title'))
    parts.append(f'<g fill="{INK}" transform="translate({x} {y}) scale({width/383})">{inner}</g>')


# Calibration: unkerned single glyph advance must match its actual metric.
for key in fonts:
    hf=hb.Font(faces[key]); hf.set_variations({'wght':400})
    b=hb.Buffer(); b.add_str('H'); b.guess_segment_properties(); hb.shape(hf,b)
    gs=fonts[key].getGlyphSet(location={'wght':400})
    assert abs(b.glyph_positions[0].x_advance-gs[fonts[key].getBestCmap()[ord('H')]].width)<1

masters={p.name:sha256(p.read_bytes()).hexdigest() for p in ASSETS.glob('*.svg')}
rect(0,0,W,H,PAPER)
logo(64,42,180)
text('Typography study / Same content, same sizes',880,68,18,maxwidth=656)
line(64,104,1536,104)

for key,x,name in [('A',64,'Uncut Sans'),('B',832,'Familjen Grotesk')]:
    def t(s,dx,y,size=18,weight=400,color=INK,maxwidth=640,tnum=False):
        return text(s,x+dx,y,size,key,weight,color,maxwidth,tnum)
    t(f'{key} / {name}',0,166,32,600)
    t('One family for titles, text and controls.',0,200,18,color=MUTED)
    line(x,232,x+704,232)
    t('You shape',0,318,64,600)
    t('the result.',0,390,64,600)
    t('Ask AI to build your tools. Adjust each detail until',0,444,20)
    t('it looks right to you. Bring the result into your project.',0,474,20)
    t('a g R t & 012',0,571,64,500)
    t('Same 64 px / 600 headings · 20 px / 400 body',0,610,16,color=MUTED)
    rect(x,648,704,376,INK,8)
    t('Geometry',32,695,24,600,PAPER)
    t('Reset',608,692,14,400,STONE,64)
    line(x+32,720,x+672,720,'#42493F')
    for i,(field,value,ratio) in enumerate([('Radius','48.00 px',.48),('Rotation','12.00°',.4),('Layers','8',.7)]):
        y=758+i*68
        t(field,32,y,16,color=PAPER)
        t(value,576,y,16,color=STONE,maxwidth=96,tnum=True)
        line(x+32,y+20,x+672,y+20,'#62695E',2)
        line(x+32,y+20,x+32+640*ratio,y+20,PAPER,2)
        parts.append(f'<circle cx="{x+32+640*ratio}" cy="{y+20}" r="5" fill="{PAPER}"/>')
    rect(x+32,950,168,42,PAPER,5)
    t('Export settings',48,977,16,500,INK,136)
    t('Parameters in the same family — no monospace.',0,1064,18,color=MUTED)
    t('No font chosen yet. Custom logo remains unchanged.',0,1094,18,color=MUTED)

line(64,1136,1536,1136)
text('ParamRig / Typeface comparison',64,1168,15,color=MUTED)
text('Static specimens · English reference language',1176,1168,15,color=MUTED,maxwidth=360)
svg='<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200" role="img" aria-label="ParamRig typography comparison: Uncut Sans and Familjen Grotesk">'+''.join(parts)+'</svg>'
(OUT/'paramrig-type-comparison.svg').write_text(svg)
(HERE/'qa.json').write_text(json.dumps({'masters':masters,'shaping':'HarfBuzz; single H advance calibrated to font metric','text':evidence},indent=2))
print(OUT/'paramrig-type-comparison.svg')
