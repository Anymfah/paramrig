import { useEffect, useRef, useState } from 'react'
import type { RadialLayer } from '@/rigs/extended-types'
import { radialFillPath, radialStrokePath } from '@/ui/radial-curve'
import { waveformBands } from '@/audio/waveform'
import { profileCeiling } from '@/audio/profiles'

/**
 * The buffer, drawn. Named `WaveformView` rather than `Waveform` because `waveform.ts` beside it
 * holds the maths, and on a case-insensitive filesystem those two are the same module.
 *
 * The buffer, drawn. It is a gauge rather than a picture: you look at it to confirm the sound has
 * the shape you meant — an attack that bites, a tail that ends — and then you listen. Sized by
 * whatever contains it, so the same component is a strip in the transport and a panel in Tune.
 */
export function WaveformView({ samples, label, head, profiles = [] }: {
  samples: Float32Array
  label: string
  /** 0 to 1 while playing, null when stopped. */
  head?: number | null
  /** The layers whose envelopes are drawn over the sum, in their own colours. */
  profiles?: RadialLayer[]
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

  const ceiling = profileCeiling(profiles)
  const shown = profiles.filter((profile) => profile.enabled)

  return (
    <div className="waveform">
      <canvas ref={canvasRef} aria-label={`${label} waveform`} role="img" />
      {shown.length > 0 ? (
        <svg className="waveform__profiles" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {/* Scaled into the top half, so a layer's envelope traces the crest of the sum rather
              than sitting beside it. The paths are the radial controller's own. */}
          <g transform="scale(1, 0.5)">
            {shown.map((profile) => {
              const points = profile.points.map((point) => ({ x: point.x, y: point.y / ceiling }))
              return (
                <g key={profile.name} style={{ color: profile.color }}>
                  <path className="waveform__profile-fill" d={radialFillPath(points)} />
                  {/* A dark pass under the coloured one. Over dense material — a noise layer fills
                      its own outline with white — a bare 1.5px line disappears into what it is
                      describing. */}
                  <path className="waveform__profile-halo" d={radialStrokePath(points)} />
                  <path className="waveform__profile-line" d={radialStrokePath(points)} />
                </g>
              )
            })}
          </g>
        </svg>
      ) : null}
      {head === null || head === undefined ? null : <span className="waveform__head" style={{ left: `${head * 100}%` }} />}
    </div>
  )
}
