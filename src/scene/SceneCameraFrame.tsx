import { useEffect, useRef, useState } from 'react'
import { cameraFrame } from '@/scene/viewport/cameraFrame'
import type { CameraData, SceneDocument } from '@/scene/types'

/**
 * The camera's frame, and the passe-partout around it.
 *
 * Blender dims everything the camera will not render and draws a border round what it will. That
 * border is the whole point of camera view: without it the region is just a viewpoint, and there is
 * no way to see what is in the shot and what is one step outside it.
 *
 * It is drawn in the page rather than in the scene — an SVG over the canvas — for two reasons. It
 * has to be crisp at any pixel ratio, which a line in a 3D scene is not; and it must not be part of
 * what the viewport renders, or an F12 image would have its own frame drawn into it.
 *
 * The rectangle comes from the same pure function the viewport uses to widen its field of view, so
 * what is inside the frame is exactly what the camera renders.
 */
export function SceneCameraFrame({ document: scene }: { document: SceneDocument }) {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = host.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) setSize({ width: box.width, height: box.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const camera = scene.objects.find((object) => object.data.kind === 'camera' && object.data.active)
  const data = camera?.data.kind === 'camera' ? (camera.data as CameraData) : null
  const looking = scene.view.camera?.looking === true
  const dim = scene.view.camera?.passepartout ?? 0.5

  // The host is always mounted so that its size is known the moment the view is entered; only what
  // is drawn inside it depends on the state.
  const frame = data && size.width > 0 && size.height > 0
    ? cameraFrame({ viewport: size, camera: data, output: scene.output })
    : null

  return (
    <div className="scene-camera-frame" ref={host} aria-hidden="true">
      {looking && frame ? (
        <svg className="scene-camera-frame__svg" viewBox={`0 0 ${size.width} ${size.height}`}>
          {/* One path with two rectangles and the even-odd rule: the region, less the frame. */}
          <path
            className="scene-camera-frame__mask"
            fillRule="evenodd"
            style={{ opacity: dim }}
            d={`M0 0H${size.width}V${size.height}H0Z M${frame.x} ${frame.y}H${frame.x + frame.width}V${frame.y + frame.height}H${frame.x}Z`}
          />
          <rect
            className="scene-camera-frame__border"
            x={frame.x}
            y={frame.y}
            width={frame.width}
            height={frame.height}
          />
          {/* The passe-partout's own corner marks, which is how the shot's edges are found at a glance. */}
          <path
            className="scene-camera-frame__marks"
            d={corners(frame.x, frame.y, frame.width, frame.height)}
          />
        </svg>
      ) : null}
    </div>
  )
}

/** Four corner brackets, each an eighth of the shorter side long. */
function corners(x: number, y: number, width: number, height: number): string {
  const arm = Math.max(6, Math.min(width, height) / 8)
  const right = x + width
  const bottom = y + height
  return [
    `M${x} ${y + arm}V${y}H${x + arm}`,
    `M${right - arm} ${y}H${right}V${y + arm}`,
    `M${right} ${bottom - arm}V${bottom}H${right - arm}`,
    `M${x + arm} ${bottom}H${x}V${bottom - arm}`,
  ].join(' ')
}
