import { WebGLRenderer, SRGBColorSpace, type Camera } from 'three'
import { createSceneInstance, type SceneInstanceOptions } from './engine'

export type SceneViewerOptions = Omit<SceneInstanceOptions, 'renderer'> & {
  container: HTMLElement
  pixelRatio?: number
  /** Render animation time continuously. Otherwise only redraw after updates. */
  animate?: boolean
  camera?: Camera
}

/** Optional canvas owner. Hosts with a renderer use createSceneInstance directly. */
export function createSceneViewer(options: SceneViewerOptions) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setPixelRatio(Math.min(options.pixelRatio ?? window.devicePixelRatio ?? 1, 2))
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%'
  options.container.append(renderer.domElement)
  let destroyed = false
  let frame = 0
  let instance: ReturnType<typeof createSceneInstance> | undefined
  const draw = (time: number) => {
    frame = 0
    if (destroyed || !instance) return
    if (options.animate) instance.setTime(time / 1000)
    instance.configureRenderer(renderer)
    renderer.render(instance.scene, options.camera ?? instance.camera)
    if (options.animate) schedule()
  }
  const schedule = () => { if (!destroyed && !frame) frame = requestAnimationFrame(draw) }
  try { instance = createSceneInstance({ ...options, renderer, onInvalidate: () => { options.onInvalidate?.(); schedule() } }) }
  catch (error) { destroyed = true; cancelAnimationFrame(frame); renderer.dispose(); renderer.domElement.remove(); throw error }
  const resize = () => {
    if (destroyed) return
    const width = Math.max(1, options.container.clientWidth)
    const height = Math.max(1, options.container.clientHeight)
    renderer.setSize(width, height, false); instance!.resize(width, height); schedule()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(options.container); resize()
  return {
    instance, renderer, canvas: renderer.domElement,
    get ready() { return instance!.ready },
    render: schedule,
    update: instance.update,
    setValues: instance.setValues,
    setTime: instance.setTime,
    destroy() {
      if (destroyed) return
      destroyed = true; cancelAnimationFrame(frame); observer.disconnect(); instance!.destroy(); renderer.dispose(); renderer.domElement.remove()
    },
  }
}
