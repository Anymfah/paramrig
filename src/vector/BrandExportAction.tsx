import { useState } from 'react'
import type { RigSession } from '@/state/session'
import { getVectorDocument } from './document'
import { downloadBrandKit, isBrandDocument } from './brandKit'
import { resolveRigValues } from './rig'
import { Button } from '@/ui/Button'
import { StatusMessage } from '@/ui/StatusMessage'
export function BrandExport({ session }: { session: RigSession }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const document = getVectorDocument(session.rigId)
  if (!document || !isBrandDocument(document)) return null
  const download = async () => {
    setBusy(true); setError('')
    try { await downloadBrandKit(resolveRigValues(document, session.previewValues())) }
    catch (error) { setError(error instanceof Error ? error.message : 'The brand kit could not be exported.') }
    finally { setBusy(false) }
  }
  return <><Button variant="ghost" size="sm" disabled={busy} onClick={() => void download()}>{busy ? 'Preparing brand kit…' : 'Download brand kit · ZIP'}</Button>{error ? <StatusMessage tone="error">{error}</StatusMessage> : null}</>
}
