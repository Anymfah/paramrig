import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LibraryPage } from '@/library/LibraryPage'
import { WorkspacePage } from '@/workspace/WorkspacePage'

/*
 * The documentation reads a table of strings, and it was costing a browser the whole editor to get
 * there: every route reaches the rig registry, which reads both document stores at module scope, so
 * a hard load of `/docs` parsed three.js and paper.js before it could print a heading. Deferring
 * these four takes that load from 260 modules to 93.
 *
 * The library and the workspace stay eager on purpose. They are the two ends of the one journey the
 * QA campaign measures — open the library, click New scene — so deferring them would not remove a
 * module from that path, only split it into another round of requests: Vite serves each module of a
 * development build as its own request, and a chunk cannot begin until the chunk that imports it has
 * arrived. Measured, that turns eighteen serial rounds into nineteen.
 */
const DocsPage = lazy(async () => ({ default: (await import('@/docs/DocsPage')).DocsPage }))
const ControlsPage = lazy(async () => ({ default: (await import('@/docs/ControlsPage')).ControlsPage }))
const SceneRigsPage = lazy(async () => ({ default: (await import('@/docs/SceneRigsPage')).SceneRigsPage }))
const VectorRigsPage = lazy(async () => ({ default: (await import('@/docs/VectorRigsPage')).VectorRigsPage }))
const WebConnectPage = lazy(async () => ({ default: (await import('@/web/WebConnectPage')).WebConnectPage }))

export function App() {
  return (
    <BrowserRouter>
      <a className="skip-link" href="#main">
        Skip to preview
      </a>
      {/*
        * One boundary, outside `Routes` and always mounted. A boundary mounted by the route change
        * itself would show its fallback on every navigation; this one lets React hold the page that
        * is on screen until the next one has arrived, so the message below is only ever seen on a
        * hard load of a lazy route.
        */}
      <Suspense fallback={<p className="status-msg" role="status">Opening ParamRig</p>}>
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/r/:rigId" element={<WorkspacePage />} />
          <Route path="/web" element={<WebConnectPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/controls" element={<ControlsPage />} />
          <Route path="/docs/vector-rigs" element={<VectorRigsPage />} />
          <Route path="/docs/scene-rigs" element={<SceneRigsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
