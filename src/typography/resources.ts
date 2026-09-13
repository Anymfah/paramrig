import type { Font } from '@paramrig/core/fonts'
export type FontRequest = {
  font: Font
  weight: number
  purpose: 'display' | 'outline'
  signal?: AbortSignal
}
export type FontResolver = (request: FontRequest) => Promise<ArrayBuffer | null>
