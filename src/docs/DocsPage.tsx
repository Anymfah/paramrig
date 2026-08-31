import { Link } from 'react-router-dom'
import { RigNavigation } from '@/shell/RigNavigation'
import { ShellNavResize, useNavColumn } from '@/shell/ResizeHandle'
import { listExampleRigs } from '@/rigs/registry'

export function DocsPage() {
  const { dataNav, style } = useNavColumn()
  return (
    <div
      className="shell"
      data-header="off"
      data-timeline="off"
      data-nav={dataNav}
      data-inspector="collapsed"
      style={style}
    >
      <RigNavigation rigs={listExampleRigs()} />
      <main id="main" className="library-main scroll-area">
        <h1>Add a rig</h1>
        <p className="lede">
          Example rigs are modules in <code>src/rigs/examples/</code>. Register them in <code>src/rigs/registry.ts</code>.
          The shell never branches on a rig name.
        </p>
        <ol className="docs-steps">
          <li>Describe parameters in a <code>RigManifest</code>. Keep ids stable; they are the export keys.</li>
          <li>Render from <code>values</code> only. SVG, HTML or a lazy 3D adapter all work.</li>
          <li>
            For a custom instrument, read the same <code>value</code> and call <code>session.setValue</code>.
            Gestures use <code>beginGesture</code> / <code>endGesture</code> so a drag is one undo step.
          </li>
        </ol>
        <p>
          The local contract for this milestone is a bundled registry, not <code>.rig.tsx</code> discovery on disk.
        </p>
        <p>
          <Link className="text-link" to="/">
            Back to the library
          </Link>
        </p>
      </main>
      <ShellNavResize />
    </div>
  )
}
