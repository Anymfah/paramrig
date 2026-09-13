import type { LabThumbnail } from './thumbnail'
import { useEffect, useRef, type RefObject } from 'react'
import { LabRunner } from './runner'
import type { LabSound } from './model'

/** Fill visible reserve and history waveforms, quietly and one at a time. */
export function useReserveThumbnails(root: RefObject<HTMLElement | null>, sounds: LabSound[], paused: boolean, rate: number,
  onPreview: (fingerprint: string, bins: number[], detail?: LabThumbnail) => void) {
  const runner = useRef(new LabRunner())
  const failed = useRef(new Set<string>())
  useEffect(() => { const held = runner.current; return () => held.dispose() }, [])
  useEffect(() => {
    const held = runner.current
    if (paused) { held.cancel(); return }
    const host = root.current
    if (!host || typeof IntersectionObserver === 'undefined') return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const visible = new Map<Element, string>()
    const missing = sounds.filter((sound) => (sound.preview?.fingerprint !== sound.fingerprint || !sound.preview.detail) && !failed.current.has(sound.fingerprint))
    if (!missing.length) return
    const pump = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!alive) return
        if (held.running) { pump(); return }
        const next = missing.find((sound) => [...visible.values()].includes(sound.fingerprint) && !failed.current.has(sound.fingerprint))
        if (!next) return
        for (const [element, key] of visible) if (key === next.fingerprint) visible.delete(element)
        held.run({ kind: 'preview', sound: next, rate }, (render) => {
          if (alive) onPreview(next.fingerprint, render.preview, render.thumbnail)
        }, (issue) => {
          if (issue) failed.current.add(next.fingerprint)
          if (alive) pump()
        })
      }, 240)
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const key = entry.target.getAttribute('data-thumbnail')
        if (!key) continue
        if (entry.isIntersecting) visible.set(entry.target, key)
        else visible.delete(entry.target)
      }
      pump()
    }, { root: host, threshold: 0.1 })
    host.querySelectorAll('[data-thumbnail]').forEach((card) => observer.observe(card))
    return () => { alive = false; clearTimeout(timer); observer.disconnect() }
  }, [root, sounds, paused, rate, onPreview])
}
