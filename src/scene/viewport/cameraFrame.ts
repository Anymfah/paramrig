import { fovFromFocalLength } from '@/scene/viewport/view'
import type { CameraData } from '@/scene/types'

/**
 * Looking through the camera.
 *
 * Blender's camera view is not "the viewport with the camera's numbers": it is the viewport showing
 * a little more than the camera sees, with the camera's frame drawn inside it and everything
 * outside that frame dimmed. That is what makes it usable — the frame can be seen against its
 * surroundings, and there is somewhere to grab when the camera is moved.
 *
 * So two things have to be worked out together. The rectangle the camera renders, in pixels, which
 * is the largest one of the render's aspect that fits the region with a margin; and the field of
 * view the *viewport's* camera must use so that what falls inside that rectangle is exactly what
 * the camera renders — wider than the camera's own, in the same proportion as the region is bigger
 * than the frame. Get the second wrong and the passe-partout is a lie: the picture inside the frame
 * is not the picture that will be rendered.
 *
 * It is pure, and tested against the arithmetic rather than against a screenshot.
 */

export type CameraFrame = {
  /** The rendered rectangle, in pixels from the top left of the viewport. */
  x: number
  y: number
  width: number
  height: number
  /** The vertical field of view the viewport camera must use, in degrees. */
  viewFov: number
  /** For an orthographic camera, the world height the viewport must show instead of a fov. */
  viewOrthoHeight: number | null
}

/** How much of the shorter side the frame takes. Blender leaves a similar margin to grab by. */
const FILL = 0.9

export function cameraFrame(options: {
  viewport: { width: number; height: number }
  camera: CameraData
  /** The render's own shape; only its aspect matters here. */
  output?: { width: number; height: number }
}): CameraFrame {
  const width = Math.max(1, options.viewport.width)
  const height = Math.max(1, options.viewport.height)
  const output = options.output ?? { width: 1920, height: 1080 }
  const aspect = Math.max(0.01, output.width) / Math.max(0.01, output.height)

  // The largest rectangle of the render's aspect that fits the region with the margin left over.
  let frameWidth = width * FILL
  let frameHeight = frameWidth / aspect
  if (frameHeight > height * FILL) {
    frameHeight = height * FILL
    frameWidth = frameHeight * aspect
  }

  /*
   * Blender's shift is measured in widths of the frame, on both axes, which is why a shift of 0.1
   * moves the frame the same distance up as it does across. The frame moves within the region; the
   * camera's own centre stays where it is, which is the whole point of a shift.
   */
  const shiftX = (options.camera.shiftX ?? 0) * frameWidth
  const shiftY = (options.camera.shiftY ?? 0) * frameWidth
  const x = (width - frameWidth) / 2 + shiftX
  const y = (height - frameHeight) / 2 - shiftY

  if (options.camera.projection === 'orthographic') {
    const scale = Math.max(1e-4, options.camera.orthoScale ?? 6)
    // Blender's ortho scale is the width the camera sees; the viewport works in heights.
    const cameraHeight = scale / aspect
    return { x, y, width: frameWidth, height: frameHeight, viewFov: 0, viewOrthoHeight: cameraHeight * (height / frameHeight) }
  }

  /*
   * The camera's vertical field of view, then widened by however much taller the region is than the
   * frame. The horizontal one is what a focal length and a sensor give directly, so the vertical is
   * taken from it through the render's aspect rather than from the sensor's own height — which is
   * how Blender does it for a sensor fitted to its width.
   */
  const horizontal = fovFromFocalLength(options.camera.focalLength ?? 50, options.camera.sensor ?? 36)
  const vertical = (2 * Math.atan(Math.tan((horizontal * Math.PI) / 360) / aspect) * 180) / Math.PI
  const viewFov = (2 * Math.atan(Math.tan((vertical * Math.PI) / 360) * (height / frameHeight)) * 180) / Math.PI
  return { x, y, width: frameWidth, height: frameHeight, viewFov, viewOrthoHeight: null }
}
