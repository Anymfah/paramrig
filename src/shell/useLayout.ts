import { useEffect, useState, type CSSProperties } from 'react'
import { isNavCompact, navColumnWidth } from '@/state/nav-layout'
import { useWorkspace } from '@/state/workspace'

export function useViewport() {
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

export function useNavColumn() {
  const { prefs } = useWorkspace()
  const view = useViewport()
  const compact = isNavCompact(prefs, view.width)
  const navW = navColumnWidth(prefs, view.width)
  return {
    compact,
    dataNav: (prefs.navCollapsed ? 'collapsed' : compact ? 'compact' : 'open') as 'collapsed' | 'compact' | 'open',
    style: { '--nav-w': `${navW}px` } as CSSProperties,
  }
}

