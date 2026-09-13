import type { FontResolver } from '@/typography/resources'
export type { FontResolver, FontRequest } from '@/typography/resources'
export type VectorResources = {
  font?: FontResolver
  /** Return a self-contained data URL for use in both the document and exported files. */
  image?: (reference: string, signal: AbortSignal) => Promise<string | null>
}
