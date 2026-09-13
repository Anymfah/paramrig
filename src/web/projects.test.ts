import { beforeAll } from 'vitest'
import { resetProjectIndexCache } from '@/library/projectIndex'
import { loadModule } from '@/modules/registry'
beforeAll(async () => { await loadModule('web') })
import { beforeEach, describe, expect, it } from 'vitest'
import { getRig, listRigs } from '../rigs/registry'
import example from '../../examples/web/manifest.json'
import { parseManifest } from './contracts'
import { listWebProjects, pendingWebManifest, rememberWebProject, webProjectId, webRigId } from './projects'

beforeEach(() => { localStorage.clear(); resetProjectIndexCache() })

describe('a web link on a browser that has never opened the project', () => {
  it('resolves to a web rig the workspace can ask about', () => {
    expect(listWebProjects()).toEqual([])
    const rig = getRig(webRigId('fieldnotes'))
    expect(rig?.renderer).toBe('web')
    expect(rig?.id).toBe('web-fieldnotes')
  })

  it('does not invent a rig for anything else', () => {
    expect(getRig('not-a-rig')).toBeUndefined()
    expect(getRig('web-')).toBeUndefined()
    expect(pendingWebManifest('web-../etc')).toBeUndefined()
    expect(pendingWebManifest('fieldnotes')).toBeUndefined()
    expect(webProjectId('web-fieldnotes')).toBe('fieldnotes')
    expect(webProjectId('scene-1')).toBe('')
  })

  it('keeps the library to the projects this browser has opened', () => {
    expect(listRigs().some(rig => rig.renderer === 'web')).toBe(false)
    rememberWebProject(parseManifest(example))
    expect(listRigs().filter(rig => rig.renderer === 'web').map(rig => rig.id)).toEqual(['web-fieldnotes'])
    // A remembered project answers with its real name rather than the placeholder.
    expect(getRig('web-fieldnotes')?.name).toBe('Fieldnotes')
  })
})
