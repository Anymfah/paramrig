import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useNavColumn } from '@/shell/useLayout'
import { RigNavigation } from '@/shell/RigNavigation'
import { ShellNavResize } from '@/shell/ResizeHandle'
import { listExampleRigs } from '@/rigs/registry'

export function DocsChrome({ children }: { children: ReactNode }) {
  const { dataNav, style, compact } = useNavColumn()
  const [params] = useSearchParams()
  /*
   * paramrig.com puts these pages in an iframe so a reader can work a real
   * controller without leaving the page. The site already carries a header and a
   * navigation around that frame, so a second set inside it is furniture: it
   * repeats what is on screen and takes a quarter of the width the controllers
   * were embedded for. `?embed=1` leaves the page and drops the shell.
   */
  const embedded = params.get('embed') === '1'
  return (
    <div
      className="shell"
      data-header="off"
      data-timeline="off"
      data-nav={embedded ? 'off' : dataNav}
      data-inspector="collapsed"
      style={embedded ? undefined : style}
    >
      {!embedded && <RigNavigation rigs={listExampleRigs()} compact={compact} />}
      <main id="main" className="library-main scroll-area">
        {children}
      </main>
      {!embedded && <ShellNavResize />}
    </div>
  )
}
