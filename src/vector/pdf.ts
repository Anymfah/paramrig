/**
 * A very small PDF 1.4 writer.
 *
 * Enough of the format to put vector drawings on a page: objects, a cross-reference table, page
 * content streams, extended graphics states for opacity, shadings for gradients and image
 * XObjects. Nothing is compressed — a drawing is small, and a readable file is easier to trust.
 */

export type PdfObject = string | Uint8Array

export type PdfStream = { dictionary: string; data: string | Uint8Array }

export class PdfWriter {
  private objects: PdfObject[] = []

  /** Reserves an object number without writing it yet, for forward references. */
  reserve(): number {
    this.objects.push('')
    return this.objects.length
  }

  put(body: PdfObject, at?: number): number {
    if (at === undefined) {
      this.objects.push(body)
      return this.objects.length
    }
    this.objects[at - 1] = body
    return at
  }

  putStream(stream: PdfStream, at?: number): number {
    const bytes = typeof stream.data === 'string' ? encode(stream.data) : stream.data
    const head = encode(`<< ${stream.dictionary} /Length ${bytes.length} >>\nstream\n`)
    const tail = encode('\nendstream')
    return this.put(concat([head, bytes, tail]), at)
  }

  /** The finished file: header, objects, cross-reference table and trailer. */
  build(rootRef: number): Uint8Array {
    const parts: Uint8Array[] = [encode('%PDF-1.4\n%âãÏÓ\n')]
    let offset = parts[0]!.length
    const offsets: number[] = []
    this.objects.forEach((body, index) => {
      const bytes = typeof body === 'string' ? encode(body) : body
      const head = encode(`${index + 1} 0 obj\n`)
      const tail = encode('\nendobj\n')
      offsets.push(offset)
      parts.push(head, bytes, tail)
      offset += head.length + bytes.length + tail.length
    })
    const xrefAt = offset
    const rows = offsets.map((value) => `${String(value).padStart(10, '0')} 00000 n \n`).join('')
    parts.push(encode(`xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n${rows}`))
    parts.push(encode(`trailer\n<< /Size ${this.objects.length + 1} /Root ${rootRef} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`))
    return concat(parts)
  }
}

/** A PDF name or string, with the characters the format reserves escaped. */
export function pdfString(value: string): string {
  return `(${value.replace(/[\\()]/g, (character) => `\\${character}`)})`
}

export function pdfNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** An sRGB hex colour as the three numbers PDF wants, 0 to 1. */
export function pdfColor(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const channel = (at: number) => (Number.parseInt(clean.slice(at, at + 2), 16) || 0) / 255
  return [channel(0), channel(2), channel(4)]
}

/**
 * A naive sRGB to CMYK conversion, for a print-minded read-out and an optional DeviceCMYK
 * export. There is no ICC profile behind it: it is indicative, not colour-managed.
 */
export function cmykOf(hex: string): [number, number, number, number] {
  const [r, g, b] = pdfColor(hex)
  const k = 1 - Math.max(r, g, b)
  if (k >= 1) return [0, 0, 0, 1]
  return [
    round((1 - r - k) / (1 - k)),
    round((1 - g - k) / (1 - k)),
    round((1 - b - k) / (1 - k)),
    round(k),
  ]
}

export function encode(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length)
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff
  return bytes
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
