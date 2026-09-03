/**
 * Every modifier this build has.
 *
 * Registration is a side effect of importing a module, so something has to import them all; this
 * file is that something, and it is imported once by the editor's entry point. Keeping the list
 * here rather than in the panel means the registry is complete before anything asks it a question —
 * a document loaded with a subdivision modifier on it draws subdivided on the first frame rather
 * than after the panel has been opened.
 */

import '@/scene/modifiers/array'
import '@/scene/modifiers/bevel'
import '@/scene/modifiers/boolean'
import '@/scene/modifiers/cast'
import '@/scene/modifiers/decimate'
import '@/scene/modifiers/displace'
import '@/scene/modifiers/edgeSplit'
import '@/scene/modifiers/mirror'
import '@/scene/modifiers/screw'
import '@/scene/modifiers/simpleDeform'
import '@/scene/modifiers/smooth'
import '@/scene/modifiers/solidify'
import '@/scene/modifiers/subsurf'
import '@/scene/modifiers/triangulate'
import '@/scene/modifiers/weld'
import '@/scene/modifiers/wireframe'

export { getModifier, listModifiers, modifierCount, type ModifierCategory, type ModifierModule } from '@/scene/modifiers/types'
