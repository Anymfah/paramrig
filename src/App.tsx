import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LibraryPage } from '@/library/LibraryPage'
import { ModuleRoute } from '@/modules/ModuleRoute'
const DocsPage = lazy(async () => ({ default: (await import('@/docs/DocsPage')).DocsPage }))
const ControlsPage = lazy(async () => ({ default: (await import('@/docs/ControlsPage')).ControlsPage }))
export function App() {
  return <BrowserRouter>
    <a className="skip-link" href="#main">Skip to preview</a>
    <Suspense fallback={<p className="status-msg" role="status">Opening ParamRig</p>}>
      <Routes>
        <Route path="/" element={<LibraryPage/>}/>
        <Route path="/audio" element={<LibraryPage module="audio"/>}/>
        <Route path="/vector" element={<LibraryPage module="vector"/>}/>
        <Route path="/3d" element={<LibraryPage module="scene"/>}/>
        <Route path="/r/:rigId" element={<ModuleRoute/>}/>
        <Route path="/web" element={<ModuleRoute module="web" page="landing"/>}/>
        <Route path="/docs" element={<DocsPage/>}/>
        <Route path="/docs/controls" element={<ControlsPage/>}/>
        <Route path="/docs/vector-rigs" element={<ModuleRoute module="vector" page="documentation"/>}/>
        <Route path="/docs/scene-rigs" element={<ModuleRoute module="scene" page="documentation"/>}/>
        <Route path="/docs/audio-rigs" element={<ModuleRoute module="audio" page="documentation"/>}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes>
    </Suspense>
  </BrowserRouter>
}
