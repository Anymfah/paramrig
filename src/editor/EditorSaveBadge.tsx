import { Tooltip } from '@/ui/Tooltip'
import { saveBadgeLabel, type ProjectFile } from '@/editor/useProjectFile'

/** Autosave state in an editor header: "Saved · 12:04", or why the last write did not land. */
export function EditorSaveBadge({ file, prefix = 'editor' }: { file: ProjectFile<unknown>; prefix?: string }) {
  const label = saveBadgeLabel(file)
  const hint = file.message
    ?? (file.linked ? `Autosaving to ${file.fileName}` : 'Autosaving to this browser. Use File · Save as… to keep a copy on disk.')
  return (
    <Tooltip content={hint}>
      <span className={`${prefix}-save-badge`} data-state={file.state} role="status">
        <span className={`${prefix}-save-badge__dot`} aria-hidden="true" />
        {label}
      </span>
    </Tooltip>
  )
}
