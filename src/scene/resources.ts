import type { FontResolver } from '@/typography/resources'
export type { FontResolver, FontRequest } from '@/typography/resources'
export type SceneResourceResolver = (id: string, signal: AbortSignal) => Promise<Blob | null>
export type SceneResources = {
  resource?: SceneResourceResolver
  font?: FontResolver
}
