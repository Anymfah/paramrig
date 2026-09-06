import { afterEach, describe, expect, it, vi } from 'vitest'
import { HELLO_HEARTBEAT, helloDelay, helloQueue, unanswered } from './handshake'

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

describe('what the workspace says when the preview does not answer', () => {
  const host = 'http://127.0.0.1:5174'
  const project = 'http://localhost:3000'

  it('names the three causes in the order they usually are', () => {
    const { status, causes } = unanswered(false, host, project)
    expect(status).toBe('Preview unavailable')
    expect(causes).toHaveLength(3)
    expect(causes[0]).toContain(project)
    expect(causes[1]).toContain(host)
    expect(causes[2]).toContain('frame-ancestors')
  })

  it('says the SDK is there and names this workbench once an announcement has been heard', () => {
    const { status, causes } = unanswered(true, host, project)
    expect(status).toBe(`The page's SDK is present but did not accept this workbench origin (${host})`)
    expect(causes).toHaveLength(1)
    expect(causes[0]).toContain('hostOrigin')
    // The page answered, so nothing here may blame the development server or the frame permission.
    expect(`${status} ${causes.join(' ')}`).not.toContain(project)
    expect(causes[0]).not.toContain('frame-ancestors')
  })
})
