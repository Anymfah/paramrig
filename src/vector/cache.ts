/** Small least-recently-used cache: the oldest entry leaves once the limit is passed. */
export type LruCache<Value> = {
  get: (key: string) => Value | undefined
  set: (key: string, value: Value) => void
  has: (key: string) => boolean
  clear: () => void
  readonly size: number
  readonly keys: string[]
}

export function createLruCache<Value>(limit: number): LruCache<Value> {
  const entries = new Map<string, Value>()
  const max = Math.max(1, limit)
  return {
    get(key) {
      if (!entries.has(key)) return undefined
      const value = entries.get(key)!
      entries.delete(key)
      entries.set(key, value)
      return value
    },
    set(key, value) {
      entries.delete(key)
      entries.set(key, value)
      while (entries.size > max) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        entries.delete(oldest.value)
      }
    },
    has: (key) => entries.has(key),
    clear: () => entries.clear(),
    get size() {
      return entries.size
    },
    get keys() {
      return [...entries.keys()]
    },
  }
}

/** Wraps a pure function in an LRU keyed by a caller-supplied fingerprint of its arguments. */
export function memoize<Args extends unknown[], Value>(
  compute: (...args: Args) => Value,
  fingerprint: (...args: Args) => string,
  limit: number,
): ((...args: Args) => Value) & { cache: LruCache<Value> } {
  const cache = createLruCache<Value>(limit)
  const memoized = (...args: Args): Value => {
    const key = fingerprint(...args)
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const value = compute(...args)
    cache.set(key, value)
    return value
  }
  memoized.cache = cache
  return memoized
}
