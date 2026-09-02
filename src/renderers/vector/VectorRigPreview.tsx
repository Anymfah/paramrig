import { useMemo } from 'react'
import type { ParamValue } from '@/rigs/types'
import { StatusMessage } from '@/ui/StatusMessage'
import { documentThumbnail, getVectorDocument } from '@/vector/document'
import { resolveRigValues } from '@/vector/rig'

/**
 * A parametered vector document, drawn the way its controls say. The workbench asks for this the
 * same way it asks for any other renderer: values in, a picture out. Nothing here can edit the
 * document — turning a knob writes a value, and the drawing follows.
 */
export function VectorRigPreview({ documentId, values, name }: {
  documentId: string
  values: Record<string, ParamValue>
  name: string
}) {
  const document = useMemo(() => getVectorDocument(documentId), [documentId])
  const markup = useMemo(() => {
    if (!document) return null
    const resolved = resolveRigValues(document, values)
    return {
      body: documentThumbnail(resolved),
      width: resolved.width,
      height: resolved.height,
      background: resolved.background,
    }
  }, [document, values])

  if (!markup) {
    return <StatusMessage>That document is not in this browser. Open its project file to bring it back.</StatusMessage>
  }
  return (
    <svg
      className="vector-rig-preview"
      viewBox={`0 0 ${markup.width} ${markup.height}`}
      role="img"
      aria-label={`${name} preview`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x={0} y={0} width={markup.width} height={markup.height} fill={markup.background} />
      <g dangerouslySetInnerHTML={{ __html: markup.body }} />
    </svg>
  )
}
