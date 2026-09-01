import type { ReactNode } from 'react'
import { useNavColumn } from '@/shell/useLayout'
import { RigNavigation } from '@/shell/RigNavigation'
import { ShellNavResize } from '@/shell/ResizeHandle'
import { listExampleRigs } from '@/rigs/registry'

export function DocsChrome({ children }: { children: ReactNode }) {
  const { dataNav, style, compact } = useNavColumn()
  return (
    <div
      className="shell"
      data-header="off"
      data-timeline="off"
      data-nav={dataNav}
      data-inspector="collapsed"
      style={style}
    >
      <RigNavigation rigs={listExampleRigs()} compact={compact} />
      <main id="main" className="library-main scroll-area">
        {children}
      </main>
      <ShellNavResize />
    </div>
  )
}
