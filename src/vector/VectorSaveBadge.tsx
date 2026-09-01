import { Tooltip } from '@/ui/Tooltip'
import { saveBadgeLabel, type ProjectFile } from '@/vector/useProjectFile'

/** Autosave state in the inspector header: "Saved · 12:04", or why the last write did not land. */
export function VectorSaveBadge({ file }: { file: ProjectFile }) {
  const label = saveBadgeLabel(file)
  const hint = file.message
    ?? (file.linked ? `Autosaving to ${file.fileName}` : 'Autosaving to this browser. Use File · Save as… to keep a copy on disk.')
  return (
    <Tooltip content={hint}>
      <span className="vector-save-badge" data-state={file.state} role="status">
        <span className="vector-save-badge__dot" aria-hidden="true" />
        {label}
      </span>
    </Tooltip>
  )
}
