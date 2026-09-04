import { useMemo } from 'react'
import { boxCorners, boxFaces, paintOrder, projectCorners, sceneThumbBoxes, thumbFrame, type ThumbFace } from '@/scene/io/thumbnail'
import { renderDocumentThumbnail } from '@/scene/viewport/preview'
import type { SceneDocument } from '@/scene/types'

/**
 * A library card's picture of a scene: a real render where there is a graphics card, and every
 * object's bounding box drawn isometrically where there is not.
 *
 * The render is the truer picture — it is the scene's own materials under the same studio the
 * viewport lights solid shading with — and it is cached on the document's own last-changed stamp,
 * so a list of cards draws each scene once rather than once per scroll. The isometric boxes remain
 * for a browser that will give no context, a card drawn before one exists, and every test that runs
 * without a screen: a card with a diagram beats a card with a hole in it.
 *
 * The projection maths lives in `@/scene/io/thumbnail`, which draws the same picture as a data URL
 * for the recent-projects store; there is one projection, not two that drift apart.
 */
export function SceneThumb({ document }: { document: SceneDocument }) {
  /*
   * Keyed on what would change the picture rather than on the document's identity: a card list
   * re-reads its documents from storage on every render, so a new object each time would redraw
   * every scene on every scroll. The stamp moves whenever anything is edited.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rendered = useMemo(() => renderDocumentThumbnail(document), [document.id, document.updatedAt])
  if (rendered) return <img className="scene-thumb scene-thumb--rendered" src={rendered} alt="" />
  const boxes = sceneThumbBoxes(document)
  if (boxes.length === 0) return <svg className="scene-thumb" viewBox="-50 -50 100 100" aria-hidden="true" />
  const frame = thumbFrame(boxes)

  return (
    <svg className="scene-thumb" viewBox={frame.view} aria-hidden="true" strokeWidth={frame.stroke}>
      {paintOrder(boxes).map((box) => {
        // The three visible faces of an isometric box: top, left and right.
        const [top, left, right] = boxFaces(projectCorners(boxCorners(box.centre, box.half)))
        return (
          <g key={box.id} data-kind={box.kind}>
            <polygon className="scene-thumb__face scene-thumb__face--top" points={facePoints(top)} />
            <polygon className="scene-thumb__face scene-thumb__face--left" points={facePoints(left)} />
            <polygon className="scene-thumb__face scene-thumb__face--right" points={facePoints(right)} />
          </g>
        )
      })}
    </svg>
  )
}

function facePoints(face: ThumbFace): string {
  return face.map((point) => `${point[0]},${point[1]}`).join(' ')
}
