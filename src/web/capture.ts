export async function captureScreen(): Promise<string> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen capture is unavailable in this browser.')
  let stream: MediaStream
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false }) }
  catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    throw new Error(name === 'InvalidStateError'
      ? 'Bring this browser tab to the foreground, then choose Capture screen again. Your feedback is preserved.'
      : name === 'NotAllowedError' || name === 'AbortError'
        ? 'Screen sharing was declined or cancelled. Your feedback is preserved.'
        : 'Screen sharing could not start in this browser. Your feedback is preserved.')
  }
  try {
    const video = document.createElement('video'); video.srcObject = stream; video.muted = true
    await video.play()
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Screen capture timed out. Your feedback is preserved.')), 5000)
      const ready = () => { clearTimeout(timer); resolve() }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(ready)
      else requestAnimationFrame(ready)
    })
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight
    const context = canvas.getContext('2d'); if (!context || !canvas.width) throw new Error('No screen frame was captured.')
    context.drawImage(video, 0, 0); video.srcObject = null
    return canvas.toDataURL('image/png')
  } finally { stream.getTracks().forEach(track => track.stop()) }
}
