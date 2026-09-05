import { useViewport } from '@/shell/useLayout'
import { type CSSProperties, type ReactNode } from 'react'
import { EdgeReveal, ResizeCol, ShellNavResize } from '@/shell/ResizeHandle'
import { RigNavigation } from '@/shell/RigNavigation'
import type { RigManifest } from '@/rigs/types'
import { isNavCompact, navColumnWidth } from '@/state/nav-layout'
import { CANVAS_MIN_WIDTH, INSPECTOR_WIDTH_MAX, INSPECTOR_WIDTH_MIN } from '@/state/persistence'
import { updatePrefs, useWorkspace } from '@/state/workspace'

type WorkspaceShellProps = {
  rigs: RigManifest[]
  activeId?: string
  showTimeline?: boolean
  inspector?: ReactNode
  timeline?: ReactNode
  children: ReactNode
  mobilePanel?: 'nav' | 'main' | 'inspector'
  onMobilePanel?: (panel: 'nav' | 'main' | 'inspector') => void
  mainLabel?: string
  navLabel?: string
  hideInspector?: boolean
  hideNavigation?: boolean
  renderNavigation?: (options: { compact: boolean; inert: boolean; onNavigate: () => void }) => ReactNode
}

export function WorkspaceShell({
  rigs,
  activeId,
  showTimeline,
  inspector,
  timeline,
  children,
  mobilePanel = 'main',
  onMobilePanel,
  mainLabel = 'Preview',
  navLabel = 'Library',
  hideInspector = false,
  hideNavigation = false,
  renderNavigation,
}: WorkspaceShellProps) {
  const { prefs } = useWorkspace()
  const view = useViewport()
  const compact = isNavCompact(prefs, view.width)
  const navW = hideNavigation ? 0 : navColumnWidth(prefs, view.width)
  const inspectorMax = Math.min(
    INSPECTOR_WIDTH_MAX,
    Math.max(INSPECTOR_WIDTH_MIN, view.width - navW - CANVAS_MIN_WIDTH),
  )
  const inspectorW = prefs.inspectorCollapsed || hideInspector ? 0 : Math.min(prefs.inspectorWidth, inspectorMax)
  const timelineH = showTimeline
    ? prefs.timelineCollapsed
      ? 36
      : prefs.timelineHeight
    : 0

  return (
    <div
      className="shell"
      data-header="off"
      data-nav={hideNavigation ? 'hidden' : prefs.navCollapsed ? 'collapsed' : compact ? 'compact' : 'open'}
      data-inspector={prefs.inspectorCollapsed || hideInspector ? 'collapsed' : 'open'}
      data-timeline={showTimeline ? 'on' : 'off'}
      data-mobile-panel={mobilePanel}
      style={{
        '--nav-w': `${navW}px`,
        '--inspector-w': `${inspectorW}px`,
        '--timeline-height': `${timelineH}px`,
      } as CSSProperties}
    >
      {hideNavigation ? null : renderNavigation ? renderNavigation({
        compact,
        inert: view.width < 1024 && mobilePanel !== 'nav',
        onNavigate: () => onMobilePanel?.('main'),
      }) : (
        <RigNavigation rigs={rigs} activeId={activeId} compact={compact} inert={view.width < 1024 && mobilePanel !== 'nav'} onNavigate={() => onMobilePanel?.('main')} />
      )}
      <div className="workspace-main" inert={view.width < 1024 && mobilePanel !== 'main'}>{children}</div>
      <div className="inspector-slot" inert={view.width < 1024 && mobilePanel !== 'inspector'}>{inspector}</div>
      <div className="timeline-slot" inert={view.width < 1024 && mobilePanel !== 'main'}>{showTimeline ? timeline : null}</div>
      <div className="mobile-dock">
        {!hideNavigation ? <button type="button" aria-pressed={mobilePanel === 'nav'} onClick={() => onMobilePanel?.('nav')}>
          {navLabel}
        </button> : null}
        <button type="button" aria-pressed={mobilePanel === 'main'} onClick={() => onMobilePanel?.('main')}>
          {mainLabel}
        </button>
        {!hideInspector ? <button type="button" aria-pressed={mobilePanel === 'inspector'} onClick={() => onMobilePanel?.('inspector')}>
          Inspector
        </button> : null}
      </div>
      {hideNavigation ? null : <ShellNavResize />}
      {hideInspector ? null : prefs.inspectorCollapsed ? (
        <EdgeReveal label="Show inspector" side="end" onClick={() => updatePrefs({ inspectorCollapsed: false })} />
      ) : (
        <ResizeCol
          ariaLabel="Resize inspector"
          value={prefs.inspectorWidth}
          min={INSPECTOR_WIDTH_MIN}
          max={inspectorMax}
          invert
          onChange={(inspectorWidth) => updatePrefs({ inspectorWidth })}
          onCollapse={() => updatePrefs({ inspectorCollapsed: true })}
          style={{ right: inspectorW - 4 }}
        />
      )}
    </div>
  )
}
