import { afterEach, describe, expect, it, vi } from 'vitest'
import { HELLO_HEARTBEAT, helloDelay, helloQueue } from './handshake'

afterEach(() => { vi.useRealTimers() })

describe('the host greeting queue', () => {
  it('opens with short steps and settles on the heartbeat', () => {
    vi.useFakeTimers()
    const at: number[] = []
    let answered = false
    const start = Date.now()
    const stop = helloQueue(() => at.push(Date.now() - start), () => answered)
    expect(at).toEqual([0])
    vi.advanceTimersByTime(1500)
    expect(at).toEqual([0, 100, 300, 700, 1500])
    vi.advanceTimersByTime(2000)
    expect(at).toEqual([0, 100, 300, 700, 1500, 3500])
    stop()
    vi.advanceTimersByTime(10000)
    expect(at).toHaveLength(6)
    answered = true
  })

  it('stops stepping as soon as the preview has answered once', () => {
    vi.useFakeTimers()
    let answered = false
    let count = 0
    const stop = helloQueue(() => { count += 1 }, () => answered)
    expect(count).toBe(1)
    answered = true
    // The step already on the clock still fires; the one it schedules is the heartbeat.
    vi.advanceTimersByTime(100)
    expect(count).toBe(2)
    vi.advanceTimersByTime(1999)
    expect(count).toBe(2)
    vi.advanceTimersByTime(1)
    expect(count).toBe(3)
    stop()
  })

  it('never waits longer than the heartbeat, and never longer than it did before answering', () => {
    expect([0, 1, 2, 3, 4, 5].map(step => helloDelay(step, false))).toEqual([100, 200, 400, 800, HELLO_HEARTBEAT, HELLO_HEARTBEAT])
    expect([0, 1, 2].map(step => helloDelay(step, true))).toEqual([HELLO_HEARTBEAT, HELLO_HEARTBEAT, HELLO_HEARTBEAT])
  })
})
