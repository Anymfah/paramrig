import { useCallback, useEffect, useRef, useState } from 'react'
import { playSamples, stopPlayback } from '@/audio/playback'
import { playsOnSpace } from '@/audio/space-key'

/**
 * Playing a buffer, and knowing where it has got to.
 *
 * The playhead is driven from the clock rather than from the audio graph: the buffer is already
 * rendered and its length is known exactly, so a line that walks that duration is both simpler and
 * steadier than asking a source node where it is.
 */
export type Transport = {
  playing: boolean
  /** 0 to 1 while playing, null when stopped. */
  head: number | null
  /** True where the browser gives the page no audio device at all. */
  silent: boolean
  play: () => void
  stop: () => void
}

export function useTransport(samples: Float32Array, sampleRate: number): Transport {
  const [playing, setPlaying] = useState(false)
  const [head, setHead] = useState<number | null>(null)
  const [silent, setSilent] = useState(false)
  const frameRef = useRef(0)
  const seconds = samples.length / Math.max(1, sampleRate)

  const stop = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    stopPlayback()
    setPlaying(false)
    setHead(null)
  }, [])

  const play = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    const started = playSamples(samples, sampleRate, () => {
      setPlaying(false)
      setHead(null)
    })
    setSilent(!started)
    if (!started) return
    setPlaying(true)
    const from = performance.now()
    const step = () => {
      const spent = (performance.now() - from) / 1000
      if (spent >= seconds) {
        setHead(null)
        return
      }
      setHead(spent / seconds)
      frameRef.current = requestAnimationFrame(step)
    }
    frameRef.current = requestAnimationFrame(step)
  }, [samples, sampleRate, seconds])

  // A new buffer is a different sound; whatever was playing is the old one.
  useEffect(() => { stop() }, [samples, stop])
  useEffect(() => stop, [stop])

  return { playing, head, silent, play, stop }
}

/**
 * Space plays, and keeps working after you have clicked a field — which is the only way it is any
 * use in a workspace made of controls. `playsOnSpace` decides what it leaves alone.
 */
export function usePlayKey(onToggle: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (!playsOnSpace(event.target)) return
      event.preventDefault()
      onToggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onToggle])
}
