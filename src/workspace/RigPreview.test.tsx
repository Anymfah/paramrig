import { act, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { RigSession } from '@/state/session'
import { contourBloomManifest } from '@/rigs/examples/contour-bloom'
import { RigPreview } from '@/workspace/RigPreview'

it('updates an SVG preview on clock ticks without needing a workspace edit', () => {
  const session = new RigSession(contourBloomManifest)
  session.addKeyframe('amplitude', 0, 0.1)
  session.addKeyframe('amplitude', 4, 0.5)
  render(<RigPreview rigId="contour-bloom" name="Contour bloom" renderer="svg" values={session.previewValues()} session={session} />)
  const path = screen.getByRole('img', { name: 'Contour bloom preview' }).querySelector('path')!
  const before = path.getAttribute('d')
  const revision = session.getRevision()
  act(() => session.setPlayhead(2, true))
  expect(session.getRevision()).toBe(revision)
  expect(path.getAttribute('d')).not.toBe(before)
})
