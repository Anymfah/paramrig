import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { WorkspaceShell } from '../shell/WorkspaceShell'
import { listRigs } from '../rigs/registry'
import { Button } from '../ui/Button'
import { StatusMessage } from '../ui/StatusMessage'
import { NoManifest, readWebState } from './client'
import { listWebProjects, rememberWebProject, webRigId } from './projects'
import type { WebProjectManifest } from './contracts'
import './web.css'

export function WebConnectPage() {
  const navigate = useNavigate()
  const [project, setProject] = useState<WebProjectManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A service that answered with a project that has no manifest is not a service that is missing:
  // the command to run is already running, and what is wanted is a file, at a path only it knows.
  const [expected, setExpected] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState(true)
  const [mobile, setMobile] = useState<'nav' | 'main' | 'inspector'>('main')
  const recent = listWebProjects().filter(item => item.id !== project?.id)
  useEffect(() => {
    let cancelled = false
    setPending(true)
    void readWebState()
      .then(s => { if (!cancelled) { setProject(s.manifest); setError(null); setExpected(null) } })
      .catch(e => { if (!cancelled) { setError(String(e.message)); setExpected(e instanceof NoManifest ? e.path : null) } })
      .finally(() => { if (!cancelled) setPending(false) })
    return () => { cancelled = true }
  }, [attempt])
  return <WorkspaceShell rigs={listRigs()} mobilePanel={mobile} onMobilePanel={setMobile} mainLabel="Web" hideInspector>
    <main id="main" className="web-connect scroll-area">
      <h1>Web</h1>
      <p>Open a running development page beside its controls. Tune what the project's agent exposed, select elements, comment on what you see, then approve the batch for the agent to read.</p>
      {project ? <section className="web-connect__project"><span className="web-status-dot" /><div><h2>{project.name}</h2><p>{project.origin} · {project.pages.length} {project.pages.length === 1 ? 'page' : 'pages'}</p></div><Button onClick={() => { rememberWebProject(project); navigate(`/r/${webRigId(project.id)}`) }}>Open project</Button></section>
        : pending ? <StatusMessage>Looking for the local web service…</StatusMessage>
        : <div className="web-connect__offline">
          <StatusMessage tone="error">{error ?? 'The local web service did not answer.'}</StatusMessage>
          {expected
            ? <><p>The service is connected to a project that has no manifest yet. Write it here, then reconnect.</p><code>{expected}</code></>
            : <><p>Start it from the ParamRig repository, then reconnect.</p><code>docker compose --profile web up -d</code></>}
        </div>}
      {!project ? <Button variant="ghost" disabled={pending} onClick={() => setAttempt(n => n + 1)}>Reconnect</Button> : null}
      <details className="web-setup"><summary>Connect another project</summary><code>PARAMRIG_PROJECT_DIR=/absolute/project docker compose --profile web up -d</code><p>Example project</p><code>docker compose --profile web up -d</code></details>
      {recent.length ? <section className="web-recent"><h2>Recent projects</h2>{recent.map(p => <Link key={p.id} to={`/r/${webRigId(p.id)}`}>{p.name}<span>{new URL(p.origin).host}</span></Link>)}</section> : null}
    </main>
  </WorkspaceShell>
}
