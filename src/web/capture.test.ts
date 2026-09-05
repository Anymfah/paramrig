import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureScreen } from './capture'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('optional screen capture', () => {
  it('explains missing support and preserves the calling document on denial', async () => {
    vi.stubGlobal('navigator', {})
    await expect(captureScreen()).rejects.toThrow('unavailable')
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) } })
    await expect(captureScreen()).rejects.toThrow('feedback is preserved')
  })
  it('stops the sharing stream when frame acquisition fails', async () => {
    const stop = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('Frame unavailable'))
    await expect(captureScreen()).rejects.toThrow('Frame unavailable')
    expect(stop).toHaveBeenCalledOnce()
  })
  it('stops sharing before returning the image for user cropping', async () => {
    const stop = vi.fn(); const drawImage = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(400)
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(300)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { queueMicrotask(() => fn(0)); return 1 })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as ReturnType<HTMLCanvasElement['getContext']>)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,frame')
    expect(await captureScreen()).toBe('data:image/png;base64,frame')
    expect(drawImage).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce()
  })
})
