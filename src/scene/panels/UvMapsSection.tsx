import { useEffect, useRef, useState } from 'react'
import { addUvMap, MAX_UV_MAPS, removeUvMap, renameUvMap, setActiveUvMap, uvMapsOf } from '@/scene/mesh/uv'
import { withMesh } from '@/scene/document'
import { SceneEmpty, SceneSection } from '@/scene/SceneProperties'
import type { MeshData, SceneDocument } from '@/scene/types'
import { IconButton } from '@/ui/Button'
import { IconCheck, IconPencil, IconTrash } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'

/**
 * Data > UV maps: the list, and the four things a person does to it.
 *
 * A mesh may carry several maps — one unwrapped for the texture, one packed edge to edge for a
 * lightmap — and exactly one of them is the map every UV operator writes and the viewport samples.
 * So the list is not a list of check boxes: choosing a row *is* the edit, and everything else in
 * the editor follows it.
 *
 * It works in object mode as well as in edit mode, as Blender's does. Making a map is a change to
 * what the mesh carries rather than to what is selected in it, and having to open a mesh for
 * editing in order to add a second map would be a rule with nothing behind it.
 */

export function UvMapsSection({ mesh, meshId, onEditDocument, isOpen, onSection }: {
  mesh: MeshData
  meshId: string
  onEditDocument: (edit: (current: SceneDocument) => SceneDocument, label: string) => void
  isOpen: (sectionId: string) => boolean
  onSection: (sectionId: string, open: boolean) => void
}) {
  const maps = uvMapsOf(mesh)
  const active = Math.min(maps.length - 1, Math.max(0, mesh.attributes.loop?.activeUv ?? 0))
  const [renaming, setRenaming] = useState<{ index: number; draft: string } | null>(null)
  const field = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (renaming) field.current?.select()
  }, [renaming])

  const edit = (change: (current: MeshData) => MeshData, label: string): void => {
    onEditDocument((current) => {
      const data = current.meshes[meshId]
      return data ? withMesh(current, meshId, change(data)) : current
    }, label)
  }

  const commitRename = (keep: boolean): void => {
    const pending = renaming
    setRenaming(null)
    if (!pending || !keep) return
    const wanted = pending.draft.trim()
    if (wanted.length === 0 || wanted === maps[pending.index]?.name) return
    edit((current) => renameUvMap(current, pending.index, wanted), 'Rename UV map')
  }

  const full = maps.length >= MAX_UV_MAPS

  return (
    <SceneSection id="data-mesh-uv" title="UV maps" meta={`${maps.length}`} isOpen={isOpen} onSection={onSection}>
      {maps.length === 0 ? (
        <SceneEmpty>This mesh has no UV map. Add one here, or unwrap the mesh with U in edit mode.</SceneEmpty>
      ) : (
        <div className="scene-uv-maps" role="group" aria-label="UV maps">
          {maps.map((map, index) => (
            <div key={`${map.name}-${index}`} className="scene-uv-maps__row" data-active={index === active}>
              {renaming?.index === index ? (
                <input
                  ref={field}
                  className="scene-uv-maps__field"
                  aria-label={`Rename ${map.name}`}
                  value={renaming.draft}
                  maxLength={64}
                  autoFocus
                  onChange={(event) => setRenaming({ index, draft: event.currentTarget.value })}
                  onBlur={() => commitRename(true)}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitRename(true)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      commitRename(false)
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="scene-uv-maps__name"
                  aria-pressed={index === active}
                  title={map.name}
                  onClick={() => {
                    if (index !== active) edit((current) => setActiveUvMap(current, index), 'Active UV map')
                  }}
                  onDoubleClick={() => setRenaming({ index, draft: map.name })}
                >
                  {map.name}
                </button>
              )}
              {index === active ? <IconCheck className="scene-uv-maps__mark" aria-hidden="true" /> : null}
              <span className="scene-uv-maps__actions">
                <Tooltip content={`Rename ${map.name}`}>
                  <IconButton label={`Rename ${map.name}`} onClick={() => setRenaming({ index, draft: map.name })}>
                    <IconPencil />
                  </IconButton>
                </Tooltip>
                <Tooltip content={`Remove ${map.name}`}>
                  <IconButton
                    label={`Remove ${map.name}`}
                    onClick={() => edit((current) => removeUvMap(current, index), 'Remove UV map')}
                  >
                    <IconTrash />
                  </IconButton>
                </Tooltip>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="scene-buttons">
        <Tooltip content={full ? `A mesh carries at most ${MAX_UV_MAPS} UV maps.` : 'A copy of the active map, made active'}>
          <button
            type="button"
            className="scene-button"
            disabled={full}
            onClick={() => edit((current) => addUvMap(current), 'Add UV map')}
          >
            Add
          </button>
        </Tooltip>
      </div>
    </SceneSection>
  )
}
