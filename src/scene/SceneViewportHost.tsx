import { useEffect, useRef, useState, type ReactNode } from 'react'
import { StatusMessage } from '@/ui/StatusMessage'
import { installSceneDebug, markFirstFrame } from '@/scene/viewport/debug'
import { acquireSceneViewport, releaseSceneViewport } from '@/scene/viewport/keep'
import { SceneViewport, type SceneViewportOptions } from '@/scene/viewport/SceneViewport'
import type { SceneDocument, SceneSelection, ViewState } from '@/scene/types'

/**
 * Where the viewport is mounted, and the only place React and three.js meet.
 *
 * The viewport is created once and told about the document by method call. It is deliberately not
 * a component with the scene as a prop: a React tree that re-renders when a vertex moves is a
 * React tree that drops frames, and the whole point of the class next door is that it does not
 * take part in that.
 */

export type SceneViewportHandle = SceneViewport

export function SceneViewportHost({
  document,
  selection,
  view,
  hoverId = null,
  keepKey,
  onReady,
  createViewport,
  options,
  children,
}: {
  document: SceneDocument
  selection: SceneSelection
  view: ViewState
  hoverId?: string | null
  /**
   * Keeps the viewport alive under this name when the host unmounts, so that editing a scene and
   * tuning it — two React trees — share one WebGL context rather than building a second.
   */
  keepKey?: string
  onReady?: (viewport: SceneViewport | null) => void
  /** A test hands over a double; the editor uses the real one. */
  createViewport?: (container: HTMLElement, options: SceneViewportOptions) => SceneViewport
  options?: SceneViewportOptions
  children?: ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewport = useRef<SceneViewport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ready = useRef(onReady)
  ready.current = onReady
  const make = useRef(createViewport)
  make.current = createViewport
  const settings = useRef(options)
  settings.current = options

  useEffect(() => {
    const container = host.current
    if (!container) return
    const build = make.current ?? ((element: HTMLElement, given: SceneViewportOptions) => new SceneViewport(element, given))
    const given: SceneViewportOptions = {
      ...settings.current,
      onError: (message) => setError(message),
      onFrame: (info) => {
        markFirstFrame()
        settings.current?.onFrame?.(info)
      },
    }
    const instance = keepKey
      ? acquireSceneViewport(keepKey, container, () => build(container, given), given)
      : build(container, given)
    viewport.current = instance
    const uninstall = installSceneDebug(instance)
    ready.current?.(instance)
    return () => {
      uninstall()
      ready.current?.(null)
      // A kept viewport is handed back rather than destroyed: the other tree may be about to ask
      // for it, and rebuilding it would mean a new context and a black frame.
      if (keepKey) releaseSceneViewport(keepKey)
      else instance.dispose()
      viewport.current = null
    }
  }, [keepKey])

  /*
   * A preference that changes how many pixels the viewport draws — the resolution scale — reaches a
   * viewport that already exists, rather than waiting for one to be built again.
   */
  useEffect(() => {
    const instance = viewport.current
    if (!instance) return
    instance.setOptions({
      ...(options?.pixelScale === undefined ? {} : { pixelScale: options.pixelScale }),
      ...(options?.maxPixelRatio === undefined ? {} : { maxPixelRatio: options.maxPixelRatio }),
      ...(options?.shadows === undefined ? {} : { shadows: options.shadows }),
    })
  }, [options?.pixelScale, options?.maxPixelRatio, options?.shadows])

  useEffect(() => {
    viewport.current?.setView(view)
  }, [view])

  useEffect(() => {
    viewport.current?.setDocument(document)
  }, [document])

  useEffect(() => {
    viewport.current?.setSelection(selection)
  }, [selection])

  useEffect(() => {
    viewport.current?.setHover(hoverId)
  }, [hoverId])

  // The stylesheet holds every viewport colour, so a theme change is a re-read, not a rebuild.
  useEffect(() => {
    const target = window.document.documentElement
    const observer = new MutationObserver(() => viewport.current?.setTheme())
    observer.observe(target, { attributes: true, attributeFilter: ['data-theme'] })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => viewport.current?.setTheme()
    media.addEventListener('change', onScheme)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', onScheme)
    }
  }, [])

  return (
    <div className="scene-viewport" ref={host} data-error={error ? '' : undefined}>
      {error ? (
        <div className="scene-viewport__error">
          <StatusMessage tone="error">{error}</StatusMessage>
        </div>
      ) : null}
      {children}
    </div>
  )
}
