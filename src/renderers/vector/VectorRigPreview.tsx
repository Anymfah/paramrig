import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ParamValue } from '@/rigs/types'
import { StatusMessage } from '@/ui/StatusMessage'
import { documentThumbnail, getVectorDocument } from '@/vector/document'
import { resolveRigValues } from '@/vector/rig'
import { bindWebKitPinch } from '@/vector/pinch'
import { useFontMetricsRevision } from '@/vector/fontMetrics'
import { ensureFonts } from '@/vector/fontLoader'
import { BrandReview } from '@/vector/BrandReview'
import { BrandSpecimens } from '@/vector/BrandSpecimens'
import { isBrandDocument } from '@/vector/brandKit'
import { IconButton } from '@/ui/Button'
import { IconExpand, IconMinus, IconPlus } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'

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
  const fontRevision = useFontMetricsRevision()
  const resolvedDocument = useMemo(() => document ? resolveRigValues(document, values) : null, [document, values])
  useEffect(() => { void ensureFonts(resolvedDocument?.fonts) }, [resolvedDocument?.fonts])
  const markup = useMemo(() => {
    if (!document) return null
    const resolved = resolveRigValues(document, values)
    return {
      body: documentThumbnail(resolved),
      width: resolved.width,
      height: resolved.height,
      background: resolved.background,
    }
  // Font metrics live outside React; a loaded face changes thumbnail line wrapping.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, values, fontRevision])

  const viewport = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 })
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const fit = () => setCamera({ zoom: 1, x: 0, y: 0 })
  const width = markup?.width ?? 1
  const height = markup?.height ?? 1
  const units = useCallback(() => {
    const rect = viewport.current?.getBoundingClientRect()
    return rect && rect.width && rect.height ? Math.max(width / rect.width, height / rect.height) : 1
  }, [width, height])
  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const rect = viewport.current?.getBoundingClientRect()
    if (!rect) return
    const x = (clientX === undefined ? 0 : clientX - rect.left - rect.width / 2) * units()
    const y = (clientY === undefined ? 0 : clientY - rect.top - rect.height / 2) * units()
    setCamera(current => {
      const zoom = Math.max(0.25, Math.min(32, current.zoom * factor))
      const ratio = zoom / current.zoom
      return { zoom, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio }
    })
  }, [units])

  useEffect(() => {
    const node = viewport.current
    if (!node) return
    const pinch = bindWebKitPinch(node, zoomAt)
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (pinch.active()) return
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1
      if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY * scale * 0.002), event.clientX, event.clientY)
      else {
        const horizontal = event.shiftKey && Math.abs(event.deltaX) < 1
        const dx = (horizontal ? event.deltaY : event.deltaX) * scale * units()
        const dy = (horizontal ? 0 : event.deltaY) * scale * units()
        setCamera(current => ({ ...current, x: current.x - dx, y: current.y - dy }))
      }
    }
    node.addEventListener('wheel', wheel, { passive: false })
    return () => { node.removeEventListener('wheel', wheel); pinch.dispose() }
  }, [zoomAt, units])

  if (!markup) {
    return <StatusMessage>That document is not in this browser. Open its project file to bring it back.</StatusMessage>
  }
  return (
    <div ref={viewport} className="vector-preview-viewport" tabIndex={0} role="region" aria-label="Vector workspace"
      style={{ background: markup.background === 'none' ? 'transparent' : markup.background }}
      data-dragging={dragging || undefined}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(1.25) }
        if (event.key === '-') { event.preventDefault(); zoomAt(0.8) }
        if (event.code === 'Digit1' && event.shiftKey || event.key === 'Home') { event.preventDefault(); fit() }
        if (event.key === 'Escape') { drag.current = null; setDragging(false) }
      }}
      onPointerDown={event => {
        if (event.button !== 0 || (event.target as Element).closest('button')) return
        event.currentTarget.focus({ preventScroll: true })
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
        setDragging(true)
      }}
      onPointerMove={event => {
        const last = drag.current
        if (!last || last.id !== event.pointerId) return
        const dx = (event.clientX - last.x) * units(), dy = (event.clientY - last.y) * units()
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
        setCamera(current => ({ ...current, x: current.x + dx, y: current.y + dy }))
      }}
      onPointerUp={event => { drag.current = null; setDragging(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
      onPointerCancel={() => { drag.current = null; setDragging(false) }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false) }}
    >
    <svg
      className="vector-rig-preview"
      viewBox={`0 0 ${markup.width} ${markup.height}`}
      role="img"
      aria-label={`${name} preview`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g data-preview-camera transform={`translate(${width / 2 + camera.x} ${height / 2 + camera.y}) scale(${camera.zoom}) translate(${-width / 2} ${-height / 2})`} dangerouslySetInnerHTML={{ __html: markup.body }} />
    </svg>
    <div className="vector-preview-navigation" role="group" aria-label="Workspace navigation">
      {resolvedDocument && isBrandDocument(resolvedDocument) ? <><BrandSpecimens document={resolvedDocument} /><BrandReview document={resolvedDocument} /></> : null}
      <Tooltip content="Zoom out (−)"><IconButton label="Zoom out" disabled={camera.zoom <= 0.25} onClick={() => zoomAt(0.8)}><IconMinus /></IconButton></Tooltip>
      <Tooltip content="Fit all pages (Shift+1)"><IconButton label="Fit all pages" onClick={fit}><IconExpand /></IconButton></Tooltip>
      <Tooltip content="Zoom in (+)"><IconButton label="Zoom in" disabled={camera.zoom >= 32} onClick={() => zoomAt(1.25)}><IconPlus /></IconButton></Tooltip>
    </div>
    </div>
  )
}
