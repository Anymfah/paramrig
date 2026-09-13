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

export { rgbChannels as pdfColor, cmykOf } from '@/color/space'

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
