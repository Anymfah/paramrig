import { useState } from 'react'
import type { RigSession } from '@/state/session'
import { Button, IconButton } from '@/ui/Button'
import { IconCopy, IconDownload } from '@/ui/icons'
import { StatusMessage } from '@/ui/StatusMessage'
import { Tooltip } from '@/ui/Tooltip'
import * as Popover from '@radix-ui/react-popover'

type ExportActionProps = {
  session: RigSession
}

export function ExportAction({ session }: ExportActionProps) {
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [fallback, setFallback] = useState<string | null>(null)

  const jsonOf = () => JSON.stringify(session.toExport(), null, 2)

  const copy = async () => {
    const json = jsonOf()
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is not available in this browser.')
      await navigator.clipboard.writeText(json)
      setFallback(null)
      setMessage({ tone: 'ok', text: 'Copied the current parameter JSON.' })
    } catch (error) {
      setFallback(json)
      setMessage({
        tone: 'error',
        text: error instanceof Error ? `${error.message} Select the text below instead.` : 'Copy failed. Select the text below.',
      })
    }
  }

  const download = () => {
    const document = session.toExport()
    const json = JSON.stringify(document, null, 2)
    try {
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = window.document.createElement('a')
      anchor.href = url
      anchor.download = `${document.rigId}.paramrig.json`
      anchor.click()
      URL.revokeObjectURL(url)
      setMessage({ tone: 'ok', text: 'Downloaded the current parameter JSON.' })
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'The file could not be saved.',
      })
    }
  }

  return (
    <Popover.Root>
      <Tooltip content="Export">
        <Popover.Trigger asChild>
          <IconButton label="Export">
            <IconDownload />
          </IconButton>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content className="popover popover--export" sideOffset={8} align="end">
          <p className="lede">Copy or download the live values. This does not write back into project source.</p>
          <div className="export-actions">
            <Tooltip content="Copy JSON">
              <Button variant="ghost" size="sm" onClick={() => void copy()}>
                <IconCopy /> Copy JSON
              </Button>
            </Tooltip>
            <Tooltip content="Download">
              <Button variant="ghost" size="sm" onClick={download}>
                <IconDownload /> Download
              </Button>
            </Tooltip>
          </div>
          {message ? <StatusMessage tone={message.tone}>{message.text}</StatusMessage> : null}
          {fallback ? (
            <textarea className="number-field__input" readOnly rows={8} value={fallback} data-copyable aria-label="Export JSON fallback" />
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
