import { createRoot } from 'react-dom/client'
import { parseManifest } from '../contracts'
import { Demo } from './Demo'

void fetch('/api/web/state').then(r => r.json()).then(s => {
  const manifest = parseManifest(s.manifest)
  createRoot(document.getElementById('root')!).render(<Demo manifest={manifest} />)
}).catch(() => { document.getElementById('root')!.textContent = 'Start the ParamRig Web profile to open this connected example.' })
