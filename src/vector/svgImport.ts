import { applyAffine, IDENTITY, type Affine } from '@/vector/affine'
import { createVectorElement } from '@/vector/model'
import { networkFromRuns, normalizeWorld, type RunPoint } from '@/vector/network'
import type { VectorElement, VectorPoint } from '@/vector/types'

type AbsoluteNode = RunPoint

const NAMED: Record<string, string> = {
  black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF', yellow: '#FFFF00', gray: '#808080', grey: '#808080',
  silver: '#C0C0C0', orange: '#FFA500', purple: '#800080', navy: '#000080', teal: '#008080', lime: '#00FF00', cyan: '#00FFFF', aqua: '#00FFFF',
  magenta: '#FF00FF', fuchsia: '#FF00FF', maroon: '#800000', olive: '#808000', pink: '#FFC0CB', brown: '#A52A2A', transparent: 'none',
}

export type ImportedElement = VectorElement

/** Parses SVG markup into path elements placed at their SVG user coordinates. */
export function importSvg(markup: string, options: { currentColor?: string } = {}): VectorElement[] {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const root = parsed.querySelector('svg')
  if (!root || parsed.querySelector('parsererror')) return []
  const elements: VectorElement[] = []
  const currentColor = options.currentColor ?? '#000000'
  let rootTransform = IDENTITY
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  const width = parseLength(root.getAttribute('width'))
  const height = parseLength(root.getAttribute('height'))
  if (viewBox && viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2]! > 0 && viewBox[3]! > 0 && width && height) {
    const sx = width / viewBox[2]!
    const sy = height / viewBox[3]!
    rootTransform = { a: sx, b: 0, c: 0, d: sy, e: -viewBox[0]! * sx, f: -viewBox[1]! * sy }
  }
  walk(root, rootTransform, { fill: '#000000', stroke: 'none', strokeWidth: 1, opacity: 1 }, elements, currentColor)
  return elements
}

type Style = { fill: string; stroke: string; strokeWidth: number; opacity: number }

function walk(node: Element, transform: Affine, inherited: Style, out: VectorElement[], currentColor: string) {
  const local = multiply(transform, parseTransform(node.getAttribute('transform')))
  const style = readStyle(node, inherited, currentColor)
  const tag = node.tagName.toLowerCase()
  if (tag === 'g' || tag === 'svg' || tag === 'a') {
    for (const child of Array.from(node.children)) walk(child, local, style, out, currentColor)
    return
  }
  if (tag === 'defs' || tag === 'style' || tag === 'title' || tag === 'desc' || tag === 'metadata' || tag === 'clippath' || tag === 'mask' || tag === 'symbol') return
  const runs = shapeRuns(node, tag)
  if (!runs.length) return
  const mappedRuns = runs.filter((run) => run.nodes.length >= 2).map((run) => ({
    closed: run.closed && run.nodes.length >= 3,
    points: run.nodes.map((item): AbsoluteNode => ({
      anchor: applyAffine(local, item.anchor),
      ...(item.in ? { in: applyAffine(local, item.in) } : {}),
      ...(item.out ? { out: applyAffine(local, item.out) } : {}),
    })),
  }))
  const network = networkFromRuns(mappedRuns)
  if (network.segments.length === 0) return
  const box = normalizeWorld(network)
  const name = node.getAttribute('id') || (tag === 'path' ? 'Path' : tag.charAt(0).toUpperCase() + tag.slice(1))
  const element = createVectorElement('path', box, {
    name: name.slice(0, 120),
    network: box.network,
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.stroke === 'none' ? 0 : Math.max(0, style.strokeWidth * Math.sqrt(Math.abs(local.a * local.d - local.b * local.c))),
  })
  element.opacity = Math.min(1, Math.max(0, style.opacity))
  out.push(element)
}

function readStyle(node: Element, inherited: Style, currentColor: string): Style {
  const fill = paintValue(node.getAttribute('fill') ?? styleProperty(node, 'fill'), inherited.fill, currentColor)
  const stroke = paintValue(node.getAttribute('stroke') ?? styleProperty(node, 'stroke'), inherited.stroke, currentColor)
  const widthRaw = node.getAttribute('stroke-width') ?? styleProperty(node, 'stroke-width')
  const strokeWidth = widthRaw ? parseLength(widthRaw) ?? inherited.strokeWidth : inherited.strokeWidth
  const opacityRaw = node.getAttribute('opacity') ?? styleProperty(node, 'opacity')
  const opacity = opacityRaw ? inherited.opacity * (Number(opacityRaw) || 1) : inherited.opacity
  return { fill, stroke, strokeWidth, opacity }
}

function styleProperty(node: Element, name: string): string | null {
  const style = node.getAttribute('style')
  if (!style) return null
  const match = style.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}:`))
  return match ? match.slice(name.length + 1).trim() : null
}

function paintValue(raw: string | null, inherited: string, currentColor: string): string {
  if (raw === null || raw === 'inherit') return inherited
  const value = raw.trim().toLowerCase()
  if (value === 'none') return 'none'
  if (value === 'currentcolor') return currentColor
  if (/^#[0-9a-f]{6}$/.test(value)) return value.toUpperCase()
  if (/^#[0-9a-f]{3}$/.test(value)) return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toUpperCase()
  if (/^#[0-9a-f]{8}$/.test(value)) return value.slice(0, 7).toUpperCase()
  const rgb = value.match(/^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)/)
  if (rgb) {
    const channel = (part: string) => part.endsWith('%') ? Math.round(parseFloat(part) * 2.55) : Math.round(parseFloat(part))
    return `#${[rgb[1]!, rgb[2]!, rgb[3]!].map((part) => Math.max(0, Math.min(255, channel(part))).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
  }
  if (value.startsWith('url(')) return inherited === 'none' ? '#808080' : inherited
  return NAMED[value] ?? inherited
}

function parseLength(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  const value = parseFloat(raw)
  return Number.isFinite(value) ? value : null
}

type Run = { nodes: AbsoluteNode[]; closed: boolean }

function shapeRuns(node: Element, tag: string): Run[] {
  const number = (name: string, fallback = 0) => parseLength(node.getAttribute(name)) ?? fallback
  switch (tag) {
    case 'rect': {
      const x = number('x'); const y = number('y'); const w = number('width'); const h = number('height')
      if (w <= 0 || h <= 0) return []
      const rx = Math.min(w / 2, number('rx', number('ry')))
      const ry = Math.min(h / 2, number('ry', rx))
      if (rx > 0 && ry > 0) {
        const k = 0.5522847498
        return [{ closed: true, nodes: [
          { anchor: { x: x + rx, y }, in: { x: x + rx - rx * k, y } },
          { anchor: { x: x + w - rx, y }, out: { x: x + w - rx + rx * k, y } },
          { anchor: { x: x + w, y: y + ry }, in: { x: x + w, y: y + ry - ry * k } },
          { anchor: { x: x + w, y: y + h - ry }, out: { x: x + w, y: y + h - ry + ry * k } },
          { anchor: { x: x + w - rx, y: y + h }, in: { x: x + w - rx + rx * k, y: y + h } },
          { anchor: { x: x + rx, y: y + h }, out: { x: x + rx - rx * k, y: y + h } },
          { anchor: { x, y: y + h - ry }, in: { x, y: y + h - ry + ry * k } },
          { anchor: { x, y: y + ry }, out: { x, y: y + ry - ry * k } },
        ] }]
      }
      return [{ closed: true, nodes: [{ anchor: { x, y } }, { anchor: { x: x + w, y } }, { anchor: { x: x + w, y: y + h } }, { anchor: { x, y: y + h } }] }]
    }
    case 'circle':
    case 'ellipse': {
      const cx = number('cx'); const cy = number('cy')
      const rx = tag === 'circle' ? number('r') : number('rx'); const ry = tag === 'circle' ? number('r') : number('ry')
      if (rx <= 0 || ry <= 0) return []
      const k = 0.5522847498
      return [{ closed: true, nodes: [
        { anchor: { x: cx, y: cy - ry }, in: { x: cx - rx * k, y: cy - ry }, out: { x: cx + rx * k, y: cy - ry } },
        { anchor: { x: cx + rx, y: cy }, in: { x: cx + rx, y: cy - ry * k }, out: { x: cx + rx, y: cy + ry * k } },
        { anchor: { x: cx, y: cy + ry }, in: { x: cx + rx * k, y: cy + ry }, out: { x: cx - rx * k, y: cy + ry } },
        { anchor: { x: cx - rx, y: cy }, in: { x: cx - rx, y: cy + ry * k }, out: { x: cx - rx, y: cy - ry * k } },
      ] }]
    }
    case 'line':
      return [{ closed: false, nodes: [{ anchor: { x: number('x1'), y: number('y1') } }, { anchor: { x: number('x2'), y: number('y2') } }] }]
    case 'polyline':
    case 'polygon': {
      const values = (node.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite)
      const points: AbsoluteNode[] = []
      for (let index = 0; index + 1 < values.length; index += 2) points.push({ anchor: { x: values[index]!, y: values[index + 1]! } })
      return [{ closed: tag === 'polygon', nodes: points }]
    }
    case 'path':
      return parsePathData(node.getAttribute('d') ?? '')
    default:
      return []
  }
}

/** Parses SVG path data into sub-path runs of cubic nodes. Arcs and quadratics become cubics. */
export function parsePathData(d: string): Run[] {
  const tokens = d.match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? []
  const runs: Run[] = []
  let current: Run | null = null
  let command = ''
  let index = 0
  let point: VectorPoint = { x: 0, y: 0 }
  let start: VectorPoint = { x: 0, y: 0 }
  let lastControl: VectorPoint | null = null
  let lastCommand = ''
  const read = () => {
    const value = parseFloat(tokens[index++] ?? '')
    return Number.isFinite(value) ? value : 0
  }
  const finishRun = () => {
    if (current && current.nodes.length >= 2) runs.push(current)
    current = null
  }
  const ensureRun = () => {
    if (!current) current = { nodes: [{ anchor: point }], closed: false }
    return current
  }
  const setOut = (run: Run, control: VectorPoint) => {
    const last = run.nodes[run.nodes.length - 1]!
    if (Math.hypot(control.x - last.anchor.x, control.y - last.anchor.y) > 1e-9) last.out = control
  }
  while (index < tokens.length) {
    const token = tokens[index]!
    if (/^[a-z]$/i.test(token)) {
      command = token
      index += 1
      if (command === 'Z' || command === 'z') {
        if (current) {
          (current as Run).closed = true
          const run = current as Run
          const first = run.nodes[0]!
          const last = run.nodes[run.nodes.length - 1]!
          if (run.nodes.length > 1 && Math.hypot(first.anchor.x - last.anchor.x, first.anchor.y - last.anchor.y) < 1e-6) {
            if (last.in) first.in = last.in
            run.nodes.pop()
          }
        }
        finishRun()
        point = start
        lastControl = null
        lastCommand = 'Z'
        continue
      }
    }
    if (!command) break
    const relative = command === command.toLowerCase()
    const upper = command.toUpperCase()
    const abs = (x: number, y: number): VectorPoint => relative ? { x: point.x + x, y: point.y + y } : { x, y }
    switch (upper) {
      case 'M': {
        const next = abs(read(), read())
        finishRun()
        point = next
        start = next
        current = { nodes: [{ anchor: next }], closed: false }
        command = relative ? 'l' : 'L'
        lastControl = null
        break
      }
      case 'L': {
        const next = abs(read(), read())
        ensureRun().nodes.push({ anchor: next })
        point = next
        lastControl = null
        break
      }
      case 'H': {
        const x = read()
        const next = { x: relative ? point.x + x : x, y: point.y }
        ensureRun().nodes.push({ anchor: next })
        point = next
        lastControl = null
        break
      }
      case 'V': {
        const y = read()
        const next = { x: point.x, y: relative ? point.y + y : y }
        ensureRun().nodes.push({ anchor: next })
        point = next
        lastControl = null
        break
      }
      case 'C': {
        const c1 = abs(read(), read()); const c2 = abs(read(), read()); const next = abs(read(), read())
        const run = ensureRun()
        setOut(run, c1)
        run.nodes.push({ anchor: next, in: c2 })
        point = next
        lastControl = c2
        break
      }
      case 'S': {
        const c2 = abs(read(), read()); const next = abs(read(), read())
        const run = ensureRun()
        const reflected = lastControl && /[CS]/.test(lastCommand.toUpperCase()) ? { x: 2 * point.x - lastControl.x, y: 2 * point.y - lastControl.y } : point
        setOut(run, reflected)
        run.nodes.push({ anchor: next, in: c2 })
        point = next
        lastControl = c2
        break
      }
      case 'Q':
      case 'T': {
        let control: VectorPoint
        if (upper === 'Q') control = abs(read(), read())
        else control = lastControl && /[QT]/.test(lastCommand.toUpperCase()) ? { x: 2 * point.x - lastControl.x, y: 2 * point.y - lastControl.y } : point
        const next = abs(read(), read())
        const run = ensureRun()
        const c1 = { x: point.x + (2 / 3) * (control.x - point.x), y: point.y + (2 / 3) * (control.y - point.y) }
        const c2 = { x: next.x + (2 / 3) * (control.x - next.x), y: next.y + (2 / 3) * (control.y - next.y) }
        setOut(run, c1)
        run.nodes.push({ anchor: next, in: c2 })
        point = next
        lastControl = control
        break
      }
      case 'A': {
        const rx = read(); const ry = read(); const rotation = read(); const large = read() !== 0; const sweep = read() !== 0
        const next = abs(read(), read())
        const run = ensureRun()
        for (const cubic of arcToCubics(point, next, rx, ry, rotation, large, sweep)) {
          setOut(run, cubic[0])
          run.nodes.push({ anchor: cubic[2], in: cubic[1] })
        }
        point = next
        lastControl = null
        break
      }
      default:
        index += 1
    }
    lastCommand = command
  }
  finishRun()
  return runs
}

/** Converts an SVG arc to one or more cubic segments: [control1, control2, end]. */
function arcToCubics(from: VectorPoint, to: VectorPoint, rxIn: number, ryIn: number, rotationDeg: number, large: boolean, sweep: boolean): Array<[VectorPoint, VectorPoint, VectorPoint]> {
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx === 0 || ry === 0 || (from.x === to.x && from.y === to.y)) return [[from, to, to]]
  const phi = rotationDeg * Math.PI / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (from.x - to.x) / 2
  const dy = (from.y - to.y) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const sign = large === sweep ? -1 : 1
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const factor = sign * Math.sqrt(Math.max(0, numerator / denominator))
  const cxp = factor * (rx * y1 / ry)
  const cyp = factor * (-ry * x1 / rx)
  const cx = cos * cxp - sin * cyp + (from.x + to.x) / 2
  const cy = sin * cxp + cos * cyp + (from.y + to.y) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    let value = Math.acos(Math.max(-1, Math.min(1, dot / len)))
    if (ux * vy - uy * vx < 0) value = -value
    return value
  }
  const theta1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
  let delta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  if (sweep && delta < 0) delta += 2 * Math.PI
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)))
  const step = delta / segments
  const result: Array<[VectorPoint, VectorPoint, VectorPoint]> = []
  let theta = theta1
  const pointAt = (t: number): VectorPoint => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos })
  const derivative = (t: number): VectorPoint => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos })
  for (let index = 0; index < segments; index += 1) {
    const next = theta + step
    const alpha = (4 / 3) * Math.tan(step / 4)
    const p0 = pointAt(theta)
    const p3 = index === segments - 1 ? to : pointAt(next)
    const d0 = derivative(theta)
    const d3 = derivative(next)
    result.push([{ x: p0.x + alpha * d0.x, y: p0.y + alpha * d0.y }, { x: p3.x - alpha * d3.x, y: p3.y - alpha * d3.y }, p3])
    theta = next
  }
  return result
}

/** Parses an SVG transform list into one affine. */
export function parseTransform(raw: string | null): Affine {
  if (!raw) return IDENTITY
  let result = IDENTITY
  const pattern = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(raw))) {
    const args = match[2]!.trim().split(/[\s,]+/).map(Number)
    let m: Affine = IDENTITY
    switch (match[1]) {
      case 'matrix':
        if (args.length === 6) m = { a: args[0]!, b: args[1]!, c: args[2]!, d: args[3]!, e: args[4]!, f: args[5]! }
        break
      case 'translate':
        m = { ...IDENTITY, e: args[0] ?? 0, f: args[1] ?? 0 }
        break
      case 'scale':
        m = { ...IDENTITY, a: args[0] ?? 1, d: args[1] ?? args[0] ?? 1 }
        break
      case 'rotate': {
        const radians = (args[0] ?? 0) * Math.PI / 180
        const cos = Math.cos(radians)
        const sin = Math.sin(radians)
        const cx = args[1] ?? 0
        const cy = args[2] ?? 0
        m = { a: cos, b: sin, c: -sin, d: cos, e: cx - cos * cx + sin * cy, f: cy - sin * cx - cos * cy }
        break
      }
      case 'skewX':
        m = { ...IDENTITY, c: Math.tan((args[0] ?? 0) * Math.PI / 180) }
        break
      case 'skewY':
        m = { ...IDENTITY, b: Math.tan((args[0] ?? 0) * Math.PI / 180) }
        break
    }
    result = multiply(result, m)
  }
  return result
}

/** `first` then `second` applied to a point: result = first ∘ second. */
export function multiply(first: Affine, second: Affine): Affine {
  return {
    a: first.a * second.a + first.c * second.b,
    b: first.b * second.a + first.d * second.b,
    c: first.a * second.c + first.c * second.d,
    d: first.b * second.c + first.d * second.d,
    e: first.a * second.e + first.c * second.f + first.e,
    f: first.b * second.e + first.d * second.f + first.f,
  }
}
