import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { EdgeReveal, ResizeCol, ResizeRow, ShellNavResize } from '@/shell/ResizeHandle'
import { RigNavigation } from '@/shell/RigNavigation'
import type { RigManifest } from '@/rigs/types'
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
}: WorkspaceShellProps) {
  const { prefs } = useWorkspace()
  const navW = prefs.navCollapsed ? 0 : prefs.navWidth
  const inspectorW = prefs.inspectorCollapsed ? 0 : prefs.inspectorWidth
  const view = useViewport()
  const timelineCap = view.width < 64 * 16 ? Math.max(148, Math.round((view.height - 200) * 0.28)) : 360
  const timelineH = showTimeline
    ? prefs.timelineCollapsed
      ? 36
      : Math.min(prefs.timelineHeight, timelineCap)
    : 0

  return (
    <div
      className="shell"
      data-header="off"
      data-nav={prefs.navCollapsed ? 'collapsed' : 'open'}
      data-inspector={prefs.inspectorCollapsed ? 'collapsed' : 'open'}
      data-timeline={showTimeline ? 'on' : 'off'}
      data-mobile-panel={mobilePanel}
      style={{
        '--nav-w': `${navW}px`,
        '--inspector-w': `${inspectorW}px`,
        '--timeline-height': `${timelineH}px`,
      } as CSSProperties}
    >
      <RigNavigation rigs={rigs} activeId={activeId} />
      <div className="workspace-main">{children}</div>
      {inspector}
      {showTimeline ? timeline : null}
      <div className="mobile-dock">
        <button type="button" aria-pressed={mobilePanel === 'nav'} onClick={() => onMobilePanel?.('nav')}>
          Library
        </button>
        <button type="button" aria-pressed={mobilePanel === 'main'} onClick={() => onMobilePanel?.('main')}>
          Preview
        </button>
        <button type="button" aria-pressed={mobilePanel === 'inspector'} onClick={() => onMobilePanel?.('inspector')}>
          Inspector
        </button>
      </div>
      <ShellNavResize />
      {prefs.inspectorCollapsed ? (
        <EdgeReveal label="Show inspector" side="end" onClick={() => updatePrefs({ inspectorCollapsed: false })} />
      ) : (
        <ResizeCol
          ariaLabel="Resize inspector"
          value={prefs.inspectorWidth}
          min={260}
          max={400}
          invert
          onChange={(inspectorWidth) => updatePrefs({ inspectorWidth })}
          onCollapse={() => updatePrefs({ inspectorCollapsed: true })}
          style={{ right: inspectorW - 4 }}
        />
      )}
      {showTimeline && !prefs.timelineCollapsed ? (
        <ResizeRow
          ariaLabel="Resize timeline"
          value={prefs.timelineHeight}
          min={148}
          max={360}
          onChange={(timelineHeight) => updatePrefs({ timelineHeight })}
          onCollapse={() => updatePrefs({ timelineCollapsed: true })}
        />
      ) : null}
    </div>
  )
}

function useViewport() {
  const read = () => ({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  })
  const [view, setView] = useState(read)
  useEffect(() => {
    const onResize = () => setView(read())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return view
}
