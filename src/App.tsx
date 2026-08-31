import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { DocsPage } from '@/docs/DocsPage'
import { LibraryPage } from '@/library/LibraryPage'
import { WorkspacePage } from '@/workspace/WorkspacePage'

export function App() {
  return (
    <BrowserRouter>
      <a className="skip-link" href="#main">
        Skip to preview
      </a>
      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/r/:rigId" element={<WorkspacePage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
