import { useCallback, useEffect, useRef, useState } from 'react'
import { IconButton } from '@/ui/Button'
import { IconPlay, IconStart } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { decibels, levels, waveformBands } from '@/audio/waveform'
import { playSamples, stopPlayback } from '@/audio/playback'
import { hasKeyboardFocus, playsOnSpace } from '@/audio/space-key'

/**
 * What a sound looks like while you work on it: the waveform, a play button, and the two numbers
 * worth knowing about a level.
 *
 * The playhead is driven from the clock rather than from the audio graph. The buffer is already
 * rendered and its length is known exactly, so a line that walks that duration is both simpler and
 * steadier than asking a source node where it has got to.
 */
export function AudioStage({ samples, sampleRate, name }: {
  samples: Float32Array
  sampleRate: number
  name: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef(0)
  const [width, setWidth] = useState(640)
  const [playing, setPlaying] = useState(false)
  const [head, setHead] = useState(0)
  const [silent, setSilent] = useState(false)
  const seconds = samples.length / Math.max(1, sampleRate)
  const { peak, rms } = levels(samples)

  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    if (!host || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box && box.width > 0) setWidth(Math.round(box.width))
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
    const height = canvas.clientHeight || 160
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
      const top = middle - band.max * (middle - 2)
      const bottom = middle - band.min * (middle - 2)
      // A band that rounds to nothing still gets a hairline, or a quiet passage reads as a gap.
      context.fillRect(column, top, 1, Math.max(1, bottom - top))
    }
  }, [samples, width])

  const stop = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    stopPlayback()
    setPlaying(false)
    setHead(0)
  }, [])

  useEffect(() => stop, [stop])
  useEffect(() => { stop() }, [samples, stop])

  const play = useCallback(() => {
    if (playing) {
      stop()
      return
    }
    const started = playSamples(samples, sampleRate, () => {
      setPlaying(false)
      setHead(0)
    })
    setSilent(!started)
    if (!started) return
    setPlaying(true)
    const from = performance.now()
    const step = () => {
      const spent = (performance.now() - from) / 1000
      if (spent >= seconds) {
        setHead(0)
        return
      }
      setHead(spent / seconds)
      frameRef.current = requestAnimationFrame(step)
    }
    frameRef.current = requestAnimationFrame(step)
  }, [playing, samples, sampleRate, seconds, stop])

  // Space plays, the way it does in every tool that makes a sound — and it keeps working after you
  // have clicked a field, which is the only way it is any use in a workspace made of controls.
  // `playsOnSpace` decides; see that file for what it leaves alone and why.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      const keyboard = target instanceof Element ? hasKeyboardFocus(target) : false
      if (!playsOnSpace(target, keyboard)) return
      event.preventDefault()
      play()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [play])

  return (
    <div className="audio-stage">
      <div className="audio-stage__wave">
        <canvas ref={canvasRef} aria-label={`${name} waveform`} role="img" />
        {playing ? <span className="audio-stage__head" style={{ left: `${head * 100}%` }} /> : null}
      </div>
      <div className="audio-stage__transport">
        <Tooltip content={playing ? 'Stop (Space)' : 'Play (Space)'}>
          <IconButton label={playing ? 'Stop' : 'Play'} onClick={play}>
            <>{playing ? <IconStart /> : <IconPlay />}</>
          </IconButton>
        </Tooltip>
        <span className="audio-stage__figure">{seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`}</span>
        <span className="audio-stage__figure">Peak {decibels(peak)}</span>
        <span className="audio-stage__figure">RMS {decibels(rms)}</span>
        <span className="audio-stage__figure audio-stage__figure--end">{Math.round(sampleRate / 1000)} kHz</span>
      </div>
      {silent ? <p className="audio-stage__notice" role="status">This browser will not give the page an audio device, so nothing can be played here. Everything else still works.</p> : null}
    </div>
  )
}
