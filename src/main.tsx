import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import { initTheme } from '@/state/theme'
import '@/styles/tokens.css'
import '@/styles/components.css'
import '@/styles/shell.css'
import '@/styles/editor.css'
import '@/styles/vector.css'
import '@/styles/scene.css'
import '@/styles/audio.css'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
