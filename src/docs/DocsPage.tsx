import { DocsChrome } from '@/docs/DocsChrome'
import { Link } from 'react-router-dom'

export function DocsPage() {
  return (
    <DocsChrome>
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
        <Link className="text-link" to="/docs/controls">
          Live controller catalog
        </Link>
      </p>
      <p>
        <Link className="text-link" to="/docs/vector-rigs">
          Vector rigs: a drawing that carries its own controls
        </Link>
      </p>
      <p>
        <Link className="text-link" to="/docs/scene-rigs">
          Scene rigs: a 3D scene that carries its own controls
        </Link>
      </p>
      <p>
        <Link className="text-link" to="/docs/audio-rigs">
          Audio rigs: a sound that carries its own controls
        </Link>
      </p>
      <p>
        <Link className="text-link" to="/">
          Back to the library
        </Link>
      </p>
    </DocsChrome>
  )
}
