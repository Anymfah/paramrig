import { useState } from 'react'
import { saveResource } from '@/state/resources'
import { Button } from '@/ui/Button'

/**
 * Choosing a file for a panel: an environment image, a texture map.
 *
 * A file input rather than a browser dialogue, because the bytes have to be read and stored before
 * the document can name them — a document holds a reference, and the file itself stays in this
 * browser. The same control takes a drop, which is how an image usually arrives: dragged out of a
 * folder rather than found again through a picker.
 */
export function ResourceField({ label, accept, hint, maxMB = 32, name, onChoose, onClear }: {
  label: string
  /** The `accept` list, in the same form an `<input type="file">` takes. */
  accept: string
  /** What may be dropped, said in words, under the control. */
  hint: string
  maxMB?: number
  /** The file that is in it, or null. */
  name: string | null
  onChoose: (resource: { id: string; name: string }) => void
  onClear: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [over, setOver] = useState(false)

  const take = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const saved = await saveResource(file, accept, maxMB)
      onChoose({ id: saved.id, name: saved.name })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That file could not be read.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="controller-stack">
      <label
        className="resource-drop"
        data-filled={name ? '' : undefined}
        data-over={over || undefined}
        onDragEnter={(event) => { event.preventDefault(); setOver(true) }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(false) }}
        onDrop={(event) => { event.preventDefault(); setOver(false); void take(event.dataTransfer.files[0]) }}
      >
        <input
          type="file"
          accept={accept}
          disabled={busy}
          aria-label={`Choose ${label.toLowerCase()}`}
          onChange={(event) => { void take(event.target.files?.[0]); event.target.value = '' }}
        />
        <span className="resource-drop__label">{label}</span>
        <span className="resource-drop__name">
          {busy ? 'Saving locally…' : over ? 'Drop to use this file' : name ?? 'Choose or drop a file'}
        </span>
        <small>{hint}</small>
      </label>
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {name ? (
        <div className="controller-actions">
          <Button size="sm" variant="quiet" disabled={busy} onClick={onClear}>Remove</Button>
        </div>
      ) : null}
    </div>
  )
}
