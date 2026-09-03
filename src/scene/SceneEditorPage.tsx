import { useEffect, useState } from 'react'
import { listRigs } from '@/rigs/registry'
import { WorkspaceShell } from '@/shell/WorkspaceShell'
import { StatusMessage } from '@/ui/StatusMessage'
import { getSceneDocument } from '@/scene/document'
import type { SceneMode } from '@/scene/prefs'
import type { SceneDocument } from '@/scene/types'

/**
 * The scene editor. The viewport, the outliner, the properties and the operators arrive with the
 * chantiers that follow; what is here is the page the router lands on and the document it opens.
 */
export function SceneEditorPage({ documentId, mode, onMode }: {
  documentId: string
  mode: SceneMode
  onMode: (mode: SceneMode) => void
}) {
  const [document, setDocument] = useState<SceneDocument | null>(() => getSceneDocument(documentId))
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'main' | 'inspector'>('main')

  useEffect(() => {
    setDocument(getSceneDocument(documentId))
  }, [documentId])

  void mode
  void onMode

  if (!document) {
    return (
      <main id="main" className="library-main scroll-area">
        <StatusMessage tone="error">That scene is not in this browser.</StatusMessage>
      </main>
    )
  }

  return (
    <WorkspaceShell
      rigs={listRigs()}
      activeId={document.id}
      mainLabel="Viewport"
      navLabel="Objects"
      mobilePanel={mobilePanel}
      onMobilePanel={setMobilePanel}
      inspector={<div className="scene-properties" />}
    >
      <h1 className="visually-hidden">{document.name}</h1>
      <div className="scene-stage" id="main" tabIndex={-1} />
    </WorkspaceShell>
  )
}
