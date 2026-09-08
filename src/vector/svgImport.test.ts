import { describe, expect, it } from 'vitest'
import { importSvg, parsePathData, parseTransform } from '@/vector/svgImport'
import { documentThumbnail, serializeVectorMarkup } from '@/vector/document'
import { chains, worldNetwork } from '@/vector/network'
import { outlinePathData } from '@/vector/render'

describe('svg import', () => {
  it('parses shapes with styles and transforms into paths', () => {
    const elements = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200">
      <rect id="box" x="10" y="10" width="20" height="10" fill="red" stroke="#00f" stroke-width="2"/>
      <g transform="translate(50 0)"><circle cx="10" cy="10" r="5" style="fill: rgb(0, 128, 0)"/></g>
      <polygon points="0,0 10,0 5,10" fill="none" stroke="black"/>
      <line x1="0" y1="50" x2="50" y2="50" stroke="currentColor"/>
    </svg>`, { currentColor: '#ABCDEF' })
    expect(elements).toHaveLength(4)
    expect(elements[0]).toMatchObject({ name: 'box', x: 20, y: 20, width: 40, height: 20, fill: '#FF0000', stroke: '#0000FF', strokeWidth: 4 })
    expect(elements[1]).toMatchObject({ x: 110, y: 10, width: 20, height: 20, fill: '#008000' })
    expect(elements[1]!.network!.segments.every((segment) => segment.ah && segment.bh)).toBe(true)
    expect(elements[2]).toMatchObject({ fill: 'none', stroke: '#000000' })
    expect(chains(worldNetwork(elements[2]!))[0]!.closed).toBe(true)
    expect(elements[3]).toMatchObject({ stroke: '#ABCDEF' })
    expect(chains(worldNetwork(elements[3]!))[0]!.closed).toBe(false)
  })

  it('parses path data including relative commands, curves, arcs and multiple sub-paths', () => {
    const runs = parsePathData('M 10 10 l 20 0 L 30 30 z m 40 0 h 10 v 10 c 0 5 -5 10 -10 10 S 40 20 40 10 Q 45 5 50 10 T 60 10')
    expect(runs).toHaveLength(2)
    expect(runs[0]!.closed).toBe(true)
    expect(runs[0]!.nodes.map((node) => node.anchor)).toEqual([{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }])
    expect(runs[1]!.closed).toBe(false)
    expect(runs[1]!.nodes[0]!.anchor).toEqual({ x: 50, y: 10 })
    expect(runs[1]!.nodes[3]!.in).toBeDefined()
    expect(runs[1]!.nodes[runs[1]!.nodes.length - 1]!.anchor).toEqual({ x: 60, y: 10 })
    const arc = parsePathData('M 0 0 A 50 50 0 0 1 100 0')
    expect(arc[0]!.nodes.length).toBeGreaterThanOrEqual(3)
    expect(arc[0]!.nodes[arc[0]!.nodes.length - 1]!.anchor).toEqual({ x: 100, y: 0 })
    const mid = arc[0]!.nodes[1]!.anchor
    expect(Math.hypot(mid.x - 50, mid.y - 0)).toBeCloseTo(50, 0)
  })

  it('composes transforms and keeps rounded rectangles curved', () => {
    const m = parseTransform('translate(10 20) scale(2) rotate(90)')
    expect(m.e).toBeCloseTo(10)
    expect(m.f).toBeCloseTo(20)
    expect(m.a).toBeCloseTo(0)
    expect(m.b).toBeCloseTo(2)
    const [rounded] = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="100" height="50" rx="10"/></svg>')
    expect(rounded!.network!.nodes).toHaveLength(8)
    expect(outlinePathData(rounded!)).toContain('C')
    expect(worldNetwork(rounded!).nodes[0]!.point).toEqual({ x: 10, y: 0 })
  })

  it('returns nothing for invalid markup', () => {
    expect(importSvg('<svg><rect width="1" height="1"')).toEqual([])
    expect(importSvg('not svg')).toEqual([])
  })

  // Static analysis reads `DOMParser.parseFromString` on imported markup as an XSS sink, and what
  // answers it is a chain rather than a line. The parsed document is only ever read; a paint has to
  // match a closed set or it is dropped; script, style and foreignObject produce no element at all.
  // One hostile string does survive — the name, taken from `id` — and it is harmless only because
  // the writer never serialises a name, emitting generated ids instead. That last link is the one
  // that could quietly break, so it is held here: a name that reaches the markup fails this first.
  it('cannot smuggle markup out of the file it came from', () => {
    const elements = importSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" width="100" height="100">
      <script>alert('script')</script>
      <rect id="&quot;&gt;&lt;script&gt;alert('id')&lt;/script&gt;" width="10" height="10" fill="red" onload="alert('onload')"/>
      <path id="&quot;&gt;&lt;img src=x onerror=alert('img')&gt;" d="M0 0 L10 10 L20 0 Z" fill="url(javascript:alert('fill'))" stroke="expression(alert('stroke'))" style="fill:javascript:alert('style')"/>
      <a xlink:href="javascript:alert('href')"><circle cx="5" cy="5" r="5"/></a>
      <foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert('fo')"/></body></foreignObject>
    </svg>`)
    expect(elements).toHaveLength(3)
    expect(elements.map((element) => [element.fill, element.stroke])).toEqual([['#FF0000', 'none'], ['#000000', 'none'], ['#000000', 'none']])
    expect(elements[0]!.name).toContain('<script>')
    const written = [
      serializeVectorMarkup(elements, { x: 0, y: 0, width: 100, height: 100 }),
      documentThumbnail({ id: 'hostile', elements }),
    ]
    for (const output of written) {
      for (const smuggled of ['script', 'onerror', 'onload', 'javascript:', 'expression(', '<img', 'foreignobject', 'alert(']) {
        expect(output.toLowerCase()).not.toContain(smuggled)
      }
    }
  })
})
