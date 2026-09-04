import { useEffect, useRef, useState } from 'react'
import { EditorModal } from '@/editor/EditorModal'
import { downloadBlob } from '@/scene/io/models'
import { outputSize, renderImage } from '@/scene/io/render'
import type { SceneDocument } from '@/scene/types'
import { Button } from '@/ui/Button'

/**
 * F12: the render, while it happens and once it is done.
 *
 * A render of any size takes long enough that a person needs to be told it is happening, and large
 * ones take long enough that they need a way out — so the dialog opens with a progress bar and a
 * Stop, and becomes the picture when the picture exists. The image is not saved anywhere until Save
 * is pressed: a render is a look at the scene as often as it is a file.
 *
 * The rendering itself is off screen and belongs to `io/render.ts`; this only starts it, shows what
 * it says, and hands the result to the browser.
 */
export function SceneRenderDialog({ document: scene, open, onClose }: {
  document: SceneDocument
  open: boolean
  onClose: () => void
}) {
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [image, setImage] = useState<{ url: string; blob: Blob } | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const size = outputSize(scene)

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    abort.current = controller
    setProgress(0)
    setError(null)
    setImage(null)
    let url = ''
    void renderImage(scene, {
      signal: controller.signal,
      onProgress: (done) => { if (!controller.signal.aborted) setProgress(done) },
    })
      .then((blob) => {
        if (controller.signal.aborted) return
        url = URL.createObjectURL(blob)
        setImage({ url, blob })
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : 'The render did not finish.')
      })
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
    // The render is started once per opening, deliberately: a document that changes while it draws
    // would otherwise restart it, and the picture is of the scene as it was when F12 was pressed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const fileName = `${(scene.name || 'scene').replace(/[^\w.-]+/g, '-')}.png`

  return (
    <EditorModal prefix="scene" label="Render" open={open} onClose={onClose}>
      <div className="scene-render">
        <p className="scene-render__size">{size.width} × {size.height}{scene.output?.transparent ? ' · transparent' : ''}</p>
        {image ? (
          <>
            <button
              type="button"
              className="scene-render__frame"
              data-zoomed={zoomed || undefined}
              aria-label={zoomed ? 'Fit the render to the window' : 'Look at the render at full size'}
              onClick={() => setZoomed(!zoomed)}
            >
              <img src={image.url} alt="The rendered scene" />
            </button>
            <div className="scene-render__actions">
              <Button variant="ghost" onClick={onClose}>Close</Button>
              <Button onClick={() => downloadBlob(image.blob, fileName)}>Save</Button>
            </div>
          </>
        ) : error ? (
          <>
            <p className="scene-render__error" role="alert">{error}</p>
            <div className="scene-render__actions"><Button variant="ghost" onClick={onClose}>Close</Button></div>
          </>
        ) : (
          <>
            <div
              className="scene-render__progress"
              role="progressbar"
              aria-label="Rendering"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span className="scene-render__bar" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="scene-render__actions">
              <Button variant="ghost" onClick={() => { abort.current?.abort(); onClose() }}>Stop</Button>
            </div>
          </>
        )}
      </div>
    </EditorModal>
  )
}
