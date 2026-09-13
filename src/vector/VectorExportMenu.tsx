import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Button, IconButton } from '@/ui/Button'
import { IconCheck, IconDownload, IconTrash } from '@/ui/icons'
import { SwitchField } from '@/ui/SwitchField'
import { Tooltip } from '@/ui/Tooltip'
import { EXPORT_SCALES, type ExportSettings, type ExportTargetKind } from '@/vector/export'
import type { VectorExportPreset } from '@/vector/types'

export function VectorExportMenu({ settings, onSettings, frameName, selectionCount, presets, onExport, onSavePreset, onDeletePreset, onBrandKit, brandKitBusy }: {
  onBrandKit?: () => void
  brandKitBusy?: boolean
  settings: ExportSettings
  onSettings: (settings: ExportSettings) => void
  frameName: string | null
  selectionCount: number
  presets: VectorExportPreset[]
  onExport: (settings: ExportSettings) => void
  onSavePreset: (name: string, settings: ExportSettings) => void
  onDeletePreset: (id: string) => void
}) {
  const [presetName, setPresetName] = useState('')
  const targets: Array<{ value: ExportTargetKind; label: string; disabled: boolean }> = [
    { value: 'document', label: 'Whole page', disabled: false },
    { value: 'frame', label: frameName ? `Frame · ${frameName}` : 'Frame', disabled: !frameName },
    { value: 'selection', label: selectionCount > 0 ? `Selection · ${selectionCount}` : 'Selection', disabled: selectionCount === 0 },
  ]
  const update = <Key extends keyof ExportSettings>(key: Key, value: ExportSettings[Key]) => onSettings({ ...settings, [key]: value })
  const ready = settings.target === 'document' || (settings.target === 'frame' ? !!frameName : selectionCount > 0)
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip content="Export">
        <DropdownMenu.Trigger asChild>
          <IconButton label="Export"><IconDownload /></IconButton>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu vector-export-menu" side="bottom" align="end" sideOffset={8} collisionPadding={8} aria-label="Export">
          {onBrandKit ? <><DropdownMenu.Item className="menu__item" disabled={brandKitBusy} onSelect={onBrandKit}>{brandKitBusy ? 'Preparing brand kit…' : 'Download brand kit · ZIP'}</DropdownMenu.Item><DropdownMenu.Separator className="menu__sep" /></> : null}
          <p className="vector-export__label">What</p>
          <DropdownMenu.RadioGroup value={settings.target} onValueChange={(value) => update('target', value as ExportTargetKind)}>
            {targets.map((target) => (
              <DropdownMenu.RadioItem
                key={target.value}
                className="menu__item vector-export__item"
                value={target.value}
                disabled={target.disabled}
                onSelect={(event) => event.preventDefault()}
              >
                <span className="vector-export__check"><DropdownMenu.ItemIndicator><IconCheck /></DropdownMenu.ItemIndicator></span>
                <span className="vector-export__name">{target.label}</span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="menu__sep" />
          <p className="vector-export__label">Format</p>
          <div className="vector-export__row">
            {(['svg', 'png', 'pdf'] as const).map((format) => (
              <button
                key={format}
                type="button"
                className="vector-export__chip"
                aria-pressed={settings.format === format}
                onClick={() => update('format', format)}
              >
                {format.toUpperCase()}
              </button>
            ))}
          </div>
          {settings.format === 'png' ? (
            <div className="vector-export__row">
              {EXPORT_SCALES.map((scale) => (
                <button
                  key={scale}
                  type="button"
                  className="vector-export__chip"
                  aria-pressed={settings.scale === scale}
                  onClick={() => update('scale', scale)}
                >
                  {scale}×
                </button>
              ))}
            </div>
          ) : null}
          <div className="vector-export__switch">
            <SwitchField label="Transparent background" checked={settings.transparent} onChange={(transparent) => update('transparent', transparent)} />
          </div>
          <DropdownMenu.Separator className="menu__sep" />
          {presets.length > 0 ? (
            <>
              <p className="vector-export__label">Presets</p>
              {presets.map((preset) => (
                <div key={preset.id} className="vector-export__preset">
                  <DropdownMenu.Item asChild onSelect={() => onExport({ target: preset.target, format: preset.format, scale: preset.scale, transparent: preset.transparent })}>
                    <button type="button" className="vector-export__apply">
                      <span className="vector-export__name">{preset.name}</span>
                      <span className="vector-export__meta">{preset.format.toUpperCase()}{preset.format === 'png' ? ` ${preset.scale}×` : ''}</span>
                    </button>
                  </DropdownMenu.Item>
                  <Tooltip content="Delete preset">
                    <IconButton label={`Delete ${preset.name}`} onClick={() => onDeletePreset(preset.id)}><IconTrash /></IconButton>
                  </Tooltip>
                </div>
              ))}
            </>
          ) : null}
          <div className="vector-export__save">
            <input
              className="vector-export__input"
              value={presetName}
              placeholder="Preset name"
              aria-label="Preset name"
              spellCheck={false}
              onChange={(event) => setPresetName(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key !== 'Enter' || !presetName.trim()) return
                onSavePreset(presetName, settings)
                setPresetName('')
              }}
            />
            <Button variant="quiet" size="sm" disabled={!presetName.trim()} onClick={() => { onSavePreset(presetName, settings); setPresetName('') }}>Save</Button>
          </div>
          <div className="vector-export__actions">
            <DropdownMenu.Item asChild disabled={!ready} onSelect={() => onExport(settings)}>
              <Button variant="solid" size="sm" disabled={!ready} data-action="export">Export</Button>
            </DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
