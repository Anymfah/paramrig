import { useCallback, useEffect, useRef, useState } from 'react'
import { playSamples, stopPlayback } from '@/audio/playback'
import type { Stereo } from '@/audio/types'
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

export function useTransport(samples: Stereo, sampleRate: number, autoPlay = true): Transport {
  const [playing, setPlaying] = useState(false)
  const [head, setHead] = useState<number | null>(null)
  const [silent, setSilent] = useState(false)
  const frameRef = useRef(0)
  const previousSamples = useRef(samples)
  const seconds = samples.left.length / Math.max(1, sampleRate)
  // Read at the moment a buffer arrives, never depended on: a change plays itself, and the flag is
  // about the next buffer, not the one already on screen.
  const wanted = useRef(autoPlay)
  wanted.current = autoPlay

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

  /**
   * A new buffer is a different sound; whatever was playing is the old one, and the new one is
   * what a tweak asked to hear.
   *
   * Both halves belong to one effect. They used to be split, the stop here and the play in the
   * transport bar below, and React runs a child's effects before its parent's: every auto-play
   * started a sound and had it stopped five milliseconds later by this line.
   *
   * Not on arrival: a workspace that makes noise the moment it opens is a workspace people turn
   * off. A change plays itself, and there has not been one yet.
   */
  useEffect(() => {
    stop()
    if (previousSamples.current === samples) return
    previousSamples.current = samples
    if (wanted.current) play()
  }, [samples, stop, play])
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
