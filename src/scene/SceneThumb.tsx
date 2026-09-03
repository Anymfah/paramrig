import { boxCorners, boxFaces, paintOrder, projectCorners, sceneThumbBoxes, thumbFrame, type ThumbFace } from '@/scene/io/thumbnail'
import type { SceneDocument } from '@/scene/types'

/**
 * A library card's picture of a scene, before there is a viewport to take one with: every object's
 * bounding box, drawn isometrically. It says how much is in the scene and roughly where, which is
 * what a card is for. The viewport replaces it with a real render in the shading prompt.
 *
 * The maths lives in `@/scene/io/thumbnail`, which draws the same picture as a data URL for the
 * recent-projects store; there is one projection, not two that drift apart.
 */
export function SceneThumb({ document }: { document: SceneDocument }) {
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
