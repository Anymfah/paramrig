import { describe, expect, it, vi } from 'vitest'
import { createLruCache, memoize } from '@/vector/cache'

describe('lru cache', () => {
  it('keeps the most recently used entries and drops the oldest', () => {
    const cache = createLruCache<number>(2)

    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a')
    cache.set('c', 3)

    expect(cache.keys).toEqual(['a', 'c'])
    expect(cache.get('b')).toBeUndefined()
    expect(cache.size).toBe(2)
  })

  it('refreshes an entry written again', () => {
    const cache = createLruCache<number>(2)

    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 9)
    cache.set('c', 3)

    expect(cache.keys).toEqual(['a', 'c'])
    expect(cache.get('a')).toBe(9)
  })
})

describe('memoize', () => {
  it('computes once per fingerprint', () => {
    const compute = vi.fn((value: number) => value * 2)
    const doubled = memoize(compute, (value) => String(value), 4)

    expect(doubled(2)).toBe(4)
    expect(doubled(2)).toBe(4)
    expect(doubled(3)).toBe(6)

    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('recomputes once an entry has been evicted', () => {
    const compute = vi.fn((value: number) => value)
    const identity = memoize(compute, (value) => String(value), 1)

    identity(1)
    identity(2)
    identity(1)

    expect(compute).toHaveBeenCalledTimes(3)
  })
})
