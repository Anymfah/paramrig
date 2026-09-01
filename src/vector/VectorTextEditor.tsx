import { useEffect, useRef, type CSSProperties } from 'react'
import { fontStack, MAX_TEXT_LENGTH, textProperties } from '@/vector/text'
import type { VectorElement } from '@/vector/types'

/**
 * In-place text editing: a transparent contenteditable laid over the shape, at the same place,
 * size and angle as the `<text>` it replaces while it is open.
 */
export function VectorTextEditor({ element, zoom, pan, viewport, page, color, onChange, onCommit, onCancel }: {
  element: VectorElement
  zoom: number
  pan: { x: number; y: number }
  viewport: { width: number; height: number }
  page: { width: number; height: number }
  color: string
  onChange: (text: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const properties = textProperties(element)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.textContent = properties.text
    node.focus()
    const selection = window.getSelection()
    const range = window.document.createRange()
    range.selectNodeContents(node)
    selection?.removeAllRanges()
    selection?.addRange(range)
    // Only on open: later keystrokes must not move the caret back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element.id])

  const center = {
    x: viewport.width / 2 + pan.x + zoom * (element.x + element.width / 2 - page.width / 2),
    y: viewport.height / 2 + pan.y + zoom * (element.y + element.height / 2 - page.height / 2),
  }
  const style: CSSProperties = {
    left: center.x,
    top: center.y,
    width: element.width,
    height: element.height,
    marginLeft: -element.width / 2,
    marginTop: -element.height / 2,
    transform: `rotate(${element.rotation}deg) scale(${zoom})`,
    fontFamily: fontStack(properties.fontFamily),
    fontSize: properties.fontSize,
    fontWeight: properties.fontWeight,
    lineHeight: properties.lineHeight,
    letterSpacing: properties.letterSpacing,
    textAlign: properties.textAlign,
    whiteSpace: properties.textSizing === 'fixed' ? 'pre-wrap' : 'pre',
    color,
  }

  return (
    <div
      ref={ref}
      className="vector-text-editor"
      style={style}
      role="textbox"
      aria-label={`Edit ${element.name}`}
      aria-multiline="true"
      data-vector-text-editor={element.id}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={(event) => onChange(readText(event.currentTarget).slice(0, MAX_TEXT_LENGTH))}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={onCommit}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
          return
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          onCommit()
        }
      }}
      onPaste={(event) => {
        // Keep pasted text plain so the box never gains markup it cannot render.
        event.preventDefault()
        const plain = event.clipboardData.getData('text/plain')
        window.document.execCommand('insertText', false, plain.slice(0, MAX_TEXT_LENGTH))
      }}
    />
  )
}

/** Reads the editable's content as plain text, one `\n` per visual line. */
function readText(node: HTMLElement): string {
  const lines: string[] = []
  let current = ''
  const walk = (child: Node) => {
    if (child.nodeType === Node.TEXT_NODE) {
      current += child.textContent ?? ''
      return
    }
    if (!(child instanceof HTMLElement)) return
    if (child.tagName === 'BR') {
      lines.push(current)
      current = ''
      return
    }
    const block = child.tagName === 'DIV' || child.tagName === 'P'
    if (block && (current || lines.length)) {
      lines.push(current)
      current = ''
    }
    for (const grandchild of child.childNodes) walk(grandchild)
  }
  for (const child of node.childNodes) walk(child)
  lines.push(current)
  return lines.join('\n')
}
