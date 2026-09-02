import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { IconButton } from '@/ui/Button'
import { IconMore } from '@/ui/icons'
import { Tooltip } from '@/ui/Tooltip'
import { VectorSection } from '@/vector/VectorSection'
import { componentThumbnail } from '@/vector/document'
import type { Asset, AssetGroup } from '@/vector/assets'
import { stampPath } from '@/vector/brushes'
import type { VectorBrush, VectorElement } from '@/vector/types'

export type AssetActions = {
  /** Puts a component or a pattern on the canvas. */
  onPlace?: (asset: Asset) => void
  /** Paints the selection with a style, or sets its brush or its font. */
  onApply?: (asset: Asset) => void
  onRename?: (asset: Asset, name: string) => void
  onDuplicate?: (asset: Asset) => void
  onDelete?: (asset: Asset) => void
  onSelectUsers?: (asset: Asset) => void
}

/**
 * What the document reuses: components, styles, brushes, patterns and fonts, one 40 px line each.
 * They live here rather than in the inspector because the inspector describes the selection, and
 * an asset belongs to the document.
 */
export function VectorAssets({ groups, elements, actions }: {
  groups: AssetGroup[]
  elements: VectorElement[]
  actions: AssetActions
}) {
  return (
    <div className="vector-assets">
      {groups.map((group) => (
        <VectorSection key={group.id} id={`assets-${group.id}`} title={group.label} meta={group.assets.length > 0 ? `${group.assets.length}` : undefined}>
          {group.assets.length === 0
            ? <p className="vector-empty">{EMPTY[group.id]}</p>
            : group.assets.map((asset) => (
              <AssetRow key={`${asset.kind}-${asset.id}`} asset={asset} elements={elements} actions={actions} />
            ))}
        </VectorSection>
      ))}
    </div>
  )
}

const EMPTY: Record<string, string> = {
  components: 'No components. Make one from a selection with ⌥⌘K',
  styles: 'No styles. Create one from a fill or a stroke',
  brushes: 'No brushes.',
  patterns: 'No patterns. Define one from two selected objects',
  fonts: 'No fonts beyond the ones the app offers.',
}

function AssetRow({ asset, elements, actions }: { asset: Asset; elements: VectorElement[]; actions: AssetActions }) {
  const [editing, setEditing] = useState(false)
  const draggable = asset.kind === 'component' || asset.kind === 'pattern'
  const menu = [
    ...(actions.onRename && !asset.builtin ? [{ label: 'Rename', onSelect: () => setEditing(true) }] : []),
    ...(actions.onDuplicate && !asset.builtin ? [{ label: 'Duplicate', onSelect: () => actions.onDuplicate!(asset) }] : []),
    ...(actions.onSelectUsers ? [{ label: `Select users · ${asset.userIds.length}`, disabled: asset.userIds.length === 0, onSelect: () => actions.onSelectUsers!(asset) }] : []),
    ...(actions.onDelete && !asset.builtin ? [{ label: 'Delete', onSelect: () => actions.onDelete!(asset) }] : []),
  ]
  const open = () => {
    if (draggable) actions.onPlace?.(asset)
    else actions.onApply?.(asset)
  }
  return (
    <div className="vector-asset" data-kind={asset.kind}>
      <button
        type="button"
        className="vector-asset__open"
        draggable={draggable}
        onDragStart={draggable ? (event) => {
          event.dataTransfer.setData('application/x-paramrig-component', asset.sourceId ?? asset.id)
          event.dataTransfer.effectAllowed = 'copy'
        } : undefined}
        onClick={open}
        aria-label={draggable ? `Place ${asset.name}` : `Apply ${asset.name} to the selection`}
      >
        <span className="vector-asset__thumb" data-kind={asset.kind} style={asset.swatch ? { background: asset.swatch } : undefined} aria-hidden="true">
          {asset.sourceId ? <Thumbnail elements={elements} sourceId={asset.sourceId} /> : null}
          {asset.kind === 'brush' && asset.network ? <BrushMark network={asset.network} /> : null}
          {asset.kind === 'font' ? <span className="vector-asset__letter" style={{ fontFamily: asset.name }}>Aa</span> : null}
        </span>
        {editing ? null : <span className="vector-asset__name">{asset.name}</span>}
        {asset.detail ? <span className="vector-asset__meta">{asset.detail}</span> : null}
      </button>
      {editing ? (
        <input
          className="vector-asset__input"
          autoFocus
          defaultValue={asset.name}
          aria-label={`${asset.name} name`}
          spellCheck={false}
          maxLength={60}
          onBlur={(event) => { actions.onRename?.(asset, event.currentTarget.value); setEditing(false) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') { event.currentTarget.value = asset.name; event.currentTarget.blur() }
          }}
        />
      ) : null}
      {menu.length > 0 ? (
        <DropdownMenu.Root modal={false}>
          <Tooltip content={`${asset.name} actions`}>
            <DropdownMenu.Trigger asChild>
              <IconButton label={`${asset.name} actions`}><IconMore /></IconButton>
            </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu" side="bottom" align="end" sideOffset={6} collisionPadding={8} aria-label={`${asset.name} actions`}>
              {menu.map((item) => (
                <DropdownMenu.Item key={item.label} className="menu__item" disabled={item.disabled} onSelect={item.onSelect}>
                  {item.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : null}
    </div>
  )
}

/** The brush's stamp, drawn once at the size of the line's thumbnail. */
function BrushMark({ network }: { network: VectorBrush['network'] }) {
  return (
    <svg viewBox="0 0 32 32" className="vector-asset__brush">
      <path d={stampPath(network, { x: 16, y: 16 }, 22, 0)} fillRule="evenodd" />
    </svg>
  )
}

function Thumbnail({ elements, sourceId }: { elements: VectorElement[]; sourceId: string }) {
  const source = elements.find((element) => element.id === sourceId)
  if (!source) return null
  return (
    <svg
      viewBox={`${source.x} ${source.y} ${Math.max(1, source.width)} ${Math.max(1, source.height)}`}
      dangerouslySetInnerHTML={{ __html: componentThumbnail(elements, sourceId) }}
    />
  )
}
