import { useEffect, useRef, useState } from 'react'
import { waveformBands } from '@/audio/waveform'

/**
 * The buffer, drawn. Named `WaveformView` rather than `Waveform` because `waveform.ts` beside it
 * holds the maths, and on a case-insensitive filesystem those two are the same module.
 *
 * The buffer, drawn. It is a gauge rather than a picture: you look at it to confirm the sound has
 * the shape you meant — an attack that bites, a tail that ends — and then you listen. Sized by
 * whatever contains it, so the same component is a strip in the transport and a panel in Tune.
 */
export function WaveformView({ samples, label, head }: {
  samples: Float32Array
  label: string
  /** 0 to 1 while playing, null when stopped. */
  head?: number | null
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ width: 160, height: 40 })

  useEffect(() => {
    const host = canvasRef.current?.parentElement
    if (!host || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box && box.width > 0 && box.height > 0) setSize({ width: Math.round(box.width), height: Math.round(box.height) })
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const { width, height } = size
    const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.max(1, Math.round(height * ratio))
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)

    const styles = getComputedStyle(canvas)
    const accent = styles.getPropertyValue('--accent').trim() || '#d4e7e1'
    const rule = styles.getPropertyValue('--border-default').trim() || 'rgba(255,255,255,0.11)'
    const middle = height / 2

    context.strokeStyle = rule
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(0, middle)
    context.lineTo(width, middle)
    context.stroke()

    const bands = waveformBands(samples, width)
    context.fillStyle = accent
    for (let column = 0; column < bands.length; column += 1) {
      const band = bands[column]
      if (!band) continue
      const top = middle - band.max * (middle - 1)
      const bottom = middle - band.min * (middle - 1)
      // A band that rounds to nothing still gets a hairline, or a quiet passage reads as a gap.
      context.fillRect(column, top, 1, Math.max(1, bottom - top))
    }
  }, [samples, size])

  return (
    <div className="waveform">
      <canvas ref={canvasRef} aria-label={`${label} waveform`} role="img" />
      {head === null || head === undefined ? null : <span className="waveform__head" style={{ left: `${head * 100}%` }} />}
    </div>
  )
}
